//! `git blame` : pour chaque ligne d'un fichier, le commit qui l'a introduite dans son état actuel.
//!
//! Le fichier est lu dans le commit demandé (`rev`), ou dans la copie de travail quand `rev` est absent : les lignes
//! non commitées n'ont alors pas d'auteur (hash nul), comme `git blame` les attribue à « Not Committed Yet ».

use std::fs;

use git2::{BlameOptions, Repository};
use serde::Serialize;

use super::error::GitError;
use super::files::MAX_EDITABLE_BYTES;
use super::paths::checked_path;

/// Plage de lignes consécutives issues d'un même commit.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct BlameHunk {
    /// Première ligne de la plage (à partir de 1) et nombre de lignes.
    pub start_line: u32,
    pub line_count: u32,
    /// Commit qui a introduit ces lignes ; vide pour des lignes pas encore commitées.
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    /// Première ligne du message du commit.
    pub summary: String,
    /// Chemin du fichier à l'époque de ce commit (différent de l'actuel après un renommage).
    pub orig_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct FileBlame {
    pub path: String,
    pub hunks: Vec<BlameHunk>,
    /// Contenu du fichier, ligne par ligne (sans fin de ligne).
    pub lines: Vec<String>,
}

/// Blame de `file_path` à la révision `rev` (HEAD si `None` et que le fichier est commité ; copie de travail sinon).
/// `rev: None` correspond à ce que montre l'éditeur : les modifications non commitées sont attribuées à personne.
pub fn blame_file(repo: &Repository, file_path: &str, rev: Option<&str>) -> Result<FileBlame, GitError> {
    let mut opts = BlameOptions::new();
    opts.use_mailmap(true);
    let bytes = match rev {
        Some(rev) => {
            let commit = repo.revparse_single(rev)?.peel_to_commit()?;
            opts.newest_commit(commit.id());
            let entry = commit
                .tree()?
                .get_path(std::path::Path::new(file_path))
                .map_err(|_| GitError::NotFound(tr!("{file_path} n'existe pas dans ce commit", "{file_path} does not exist in this commit")))?;
            let blob = repo.find_blob(entry.id()).map_err(|_| GitError::Other(tr!("{file_path} n'est pas un fichier", "{file_path} is not a file")))?;
            blob.content().to_vec()
        }
        None => {
            let root = repo.workdir().ok_or_else(|| GitError::NotFound("bare repository".into()))?;
            let full = checked_path(root, file_path)?;
            let meta = fs::metadata(&full).map_err(|e| GitError::NotFound(e.to_string()))?;
            if !meta.is_file() {
                return Err(GitError::Other(tr!("{file_path} n'est pas un fichier", "{file_path} is not a file")));
            }
            fs::read(&full).map_err(|e| GitError::NotFound(e.to_string()))?
        }
    };
    if bytes.len() as u64 > MAX_EDITABLE_BYTES * 4 {
        return Err(GitError::Other(tr!("{file_path} est trop gros pour afficher son blame", "{file_path} is too large to show its blame")));
    }
    if bytes.contains(&0) {
        return Err(GitError::Other(tr!("{file_path} est un fichier binaire : pas de blame", "{file_path} is a binary file: no blame")));
    }
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<String> = text.lines().map(str::to_string).collect();

    let base = repo.blame_file(std::path::Path::new(file_path), Some(&mut opts))?;
    // Copie de travail : blame de HEAD, puis les lignes modifiées sont recalées sur le contenu du disque.
    let blame = if rev.is_some() { base } else { base.blame_buffer(&bytes)? };

    let mut hunks = Vec::new();
    for h in blame.iter() {
        let id = h.final_commit_id();
        let (hash, short_hash, author, email, timestamp, summary) = if id.is_zero() {
            (String::new(), String::new(), String::new(), String::new(), 0, String::new())
        } else {
            let commit = repo.find_commit(id)?;
            let sig = h.final_signature();
            let hash = id.to_string();
            (
                hash.clone(),
                hash[..7].to_string(),
                sig.as_ref().and_then(|s| s.name().ok()).unwrap_or("").to_string(),
                sig.as_ref().and_then(|s| s.email().ok()).unwrap_or("").to_string(),
                sig.as_ref().map_or(0, |s| s.when().seconds()),
                commit.summary().ok().flatten().unwrap_or("").to_string(),
            )
        };
        hunks.push(BlameHunk {
            start_line: h.final_start_line() as u32,
            line_count: h.lines_in_hunk() as u32,
            hash,
            short_hash,
            author,
            email,
            timestamp,
            summary,
            orig_path: h.path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| file_path.to_string()),
        });
    }
    Ok(FileBlame { path: file_path.to_string(), hunks, lines })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;

    fn commit(repo: &Repository, file: &str, content: &str, msg: &str, name: &str) -> git2::Oid {
        fs::write(repo.workdir().unwrap().join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now(name, &format!("{name}@x.io")).unwrap();
        let parents: Vec<_> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap()
    }

    #[test]
    fn attributes_lines_to_their_commit_and_marks_uncommitted_ones() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let first = commit(&repo, "a.txt", "un\ndeux\n", "premier", "alice");
        let second = commit(&repo, "a.txt", "un\ndeux\ntrois\n", "second", "bob");

        let at_head = blame_file(&repo, "a.txt", Some("HEAD")).unwrap();
        assert_eq!(at_head.lines, vec!["un", "deux", "trois"]);
        assert_eq!(at_head.hunks.len(), 2);
        assert_eq!((at_head.hunks[0].start_line, at_head.hunks[0].line_count), (1, 2));
        assert_eq!(at_head.hunks[0].hash, first.to_string());
        assert_eq!(at_head.hunks[0].author, "alice");
        assert_eq!(at_head.hunks[1].hash, second.to_string());
        assert_eq!(at_head.hunks[1].summary, "second");

        let old = blame_file(&repo, "a.txt", Some(&first.to_string())).unwrap();
        assert_eq!(old.lines.len(), 2);
        assert_eq!(old.hunks.len(), 1);

        fs::write(dir.path().join("a.txt"), "un\ndeux\ntrois\nquatre\n").unwrap();
        let wd = blame_file(&repo, "a.txt", None).unwrap();
        assert_eq!(wd.lines.len(), 4);
        let last = wd.hunks.last().unwrap();
        assert_eq!((last.start_line, last.hash.as_str()), (4, ""));
    }

    #[test]
    fn rejects_unknown_files_and_paths_outside_the_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        commit(&repo, "a.txt", "x\n", "c", "alice");
        assert!(blame_file(&repo, "nope.txt", Some("HEAD")).is_err());
        assert!(blame_file(&repo, "../etc/passwd", None).is_err());
    }
}
