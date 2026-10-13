//! Indexation partielle : bloc (hunk) ou lignes choisies d'un fichier.
//!
//! On reconstruit un patch ne contenant que les lignes sélectionnées, puis libgit2
//! l'applique à l'index (indexer / désindexer) ou à la copie de travail (annuler).

use std::collections::HashSet;
use git2::{ApplyLocation, Delta, Diff, Patch, Repository};
use serde::Deserialize;
use super::diff::workdir_file_diff;
use super::error::GitError;

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LineAction {
    /// Copie de travail → index
    Stage,
    /// Index → retour à HEAD
    Unstage,
    /// Copie de travail → retour à l'index (modifications perdues)
    Discard,
}

#[derive(Debug, Clone, PartialEq)]
struct RawLine {
    origin: char,
    content: Vec<u8>,
}

struct RawHunk {
    old_start: u32,
    new_start: u32,
    lines: Vec<RawLine>,
}

/// Construit le texte d'un patch à un seul bloc ne contenant que les lignes sélectionnées.
///
/// - sens direct (`reverse = false`) : appliqué sur l'ancien côté du diff. Une suppression non
///   sélectionnée devient du contexte ; un ajout non sélectionné disparaît.
/// - sens inverse (`reverse = true`) : appliqué sur le nouveau côté pour défaire les lignes
///   sélectionnées. Un ajout non sélectionné devient du contexte ; une suppression non
///   sélectionnée disparaît.
fn build_patch(path: &str, hunk: &RawHunk, selected: &HashSet<usize>, reverse: bool) -> Option<Vec<u8>> {
    let mut body: Vec<u8> = Vec::new();
    let (mut old_count, mut new_count, mut changes) = (0u32, 0u32, 0usize);

    for (i, line) in hunk.lines.iter().enumerate() {
        let is_selected = selected.contains(&i);
        let origin = match (line.origin, is_selected, reverse) {
            (' ', _, _) => ' ',
            ('-', true, false) | ('+', true, true) => '-',
            ('+', true, false) | ('-', true, true) => '+',
            ('-', false, false) | ('+', false, true) => ' ',
            _ => continue, // ligne absente du côté auquel le patch s'applique
        };
        match origin {
            ' ' => {
                old_count += 1;
                new_count += 1;
            }
            '-' => {
                old_count += 1;
                changes += 1;
            }
            _ => {
                new_count += 1;
                changes += 1;
            }
        }
        body.push(origin as u8);
        body.extend_from_slice(&line.content);
        if !line.content.ends_with(b"\n") {
            body.extend_from_slice(b"\n\\ No newline at end of file\n");
        }
    }

    if changes == 0 {
        return None;
    }
    let start = if reverse { hunk.new_start } else { hunk.old_start };
    let mut patch = format!(
        "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -{start},{old_count} +{start},{new_count} @@\n"
    )
    .into_bytes();
    patch.extend(body);
    Some(patch)
}

fn raw_hunks(diff: &Diff) -> Result<Vec<RawHunk>, GitError> {
    let Some(delta) = diff.deltas().next() else {
        return Ok(Vec::new());
    };
    if delta.status() != Delta::Modified {
        return Err(GitError::Other(
            "L'indexation partielle ne s'applique qu'aux fichiers modifiés (pas aux fichiers nouveaux, supprimés ou renommés)".into(),
        ));
    }
    let patch = Patch::from_diff(diff, 0)?
        .ok_or_else(|| GitError::Other("Fichier binaire : indexation partielle impossible".into()))?;

    let mut hunks = Vec::new();
    for h in 0..patch.num_hunks() {
        let (hunk, line_count) = patch.hunk(h)?;
        let mut lines = Vec::new();
        for l in 0..line_count {
            let line = patch.line_in_hunk(h, l)?;
            // Mêmes lignes que celles affichées dans le diff (voir diff::collect_file_diff).
            if matches!(line.origin(), ' ' | '+' | '-') {
                lines.push(RawLine { origin: line.origin(), content: line.content().to_vec() });
            }
        }
        hunks.push(RawHunk { old_start: hunk.old_start(), new_start: hunk.new_start(), lines });
    }
    Ok(hunks)
}

/// Applique `action` à un bloc entier (`lines = None`) ou à certaines de ses lignes
/// (index dans les lignes du bloc tel qu'affiché).
pub fn apply_lines(
    repo: &Repository,
    file_path: &str,
    hunk_index: usize,
    lines: Option<Vec<usize>>,
    action: LineAction,
) -> Result<(), GitError> {
    super::paths::validate_rel(file_path)?;
    let staged_side = action == LineAction::Unstage;
    let diff = workdir_file_diff(repo, file_path, staged_side)?;
    let hunks = raw_hunks(&diff)?;
    let hunk = hunks
        .get(hunk_index)
        .ok_or_else(|| GitError::Other("Le fichier a changé : rafraîchis le diff".into()))?;

    let selected: HashSet<usize> = match lines {
        Some(l) => l.into_iter().collect(),
        None => (0..hunk.lines.len()).collect(),
    };
    let reverse = action != LineAction::Stage;
    let patch = build_patch(file_path, hunk, &selected, reverse)
        .ok_or_else(|| GitError::Other("Aucune ligne modifiée sélectionnée".into()))?;

    let location = if action == LineAction::Discard { ApplyLocation::WorkDir } else { ApplyLocation::Index };
    repo.apply(&Diff::from_buffer(&patch)?, location, None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn numbered(n: usize) -> String {
        (1..=n).map(|i| format!("line {i}\n")).collect()
    }

    fn repo_with(content: &str) -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        // Fins de ligne LF même si le git du système a core.autocrlf=true (runners Windows)
        repo.config().unwrap().set_bool("core.autocrlf", false).unwrap();
        fs::write(dir.path().join("f.txt"), content).unwrap();
        {
            let sig = git2::Signature::now("T", "t@t").unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("f.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        (dir, repo)
    }

    fn index_content(repo: &Repository) -> String {
        let index = repo.index().unwrap();
        let entry = index.get_path(std::path::Path::new("f.txt"), 0).unwrap();
        String::from_utf8(repo.find_blob(entry.id).unwrap().content().to_vec()).unwrap()
    }

    /// Deux blocs : ligne 2 et ligne 15 modifiées.
    fn two_hunks() -> (TempDir, Repository, String) {
        let original = numbered(20);
        let (dir, repo) = repo_with(&original);
        let modified = original.replace("line 2\n", "line 2 changed\n").replace("line 15\n", "line 15 changed\n");
        fs::write(dir.path().join("f.txt"), &modified).unwrap();
        (dir, repo, modified)
    }

    #[test]
    fn stage_single_hunk() {
        let (_dir, repo, _) = two_hunks();
        apply_lines(&repo, "f.txt", 0, None, LineAction::Stage).unwrap();
        let staged = index_content(&repo);
        assert!(staged.contains("line 2 changed"));
        assert!(!staged.contains("line 15 changed"));
    }

    #[test]
    fn unstage_single_hunk() {
        let (dir, repo, modified) = two_hunks();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();

        apply_lines(&repo, "f.txt", 1, None, LineAction::Unstage).unwrap();
        let staged = index_content(&repo);
        assert!(staged.contains("line 2 changed"));
        assert!(!staged.contains("line 15 changed"));
        // La copie de travail n'est pas touchée.
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), modified);
    }

    #[test]
    fn discard_single_hunk() {
        let (dir, repo, _) = two_hunks();
        apply_lines(&repo, "f.txt", 1, None, LineAction::Discard).unwrap();
        let content = fs::read_to_string(dir.path().join("f.txt")).unwrap();
        assert!(content.contains("line 2 changed"));
        assert!(!content.contains("line 15 changed"));
        assert!(content.contains("line 15\n"));
    }

    #[test]
    fn stage_selected_lines_only() {
        let (dir, repo) = repo_with("a\nb\nc\n");
        fs::write(dir.path().join("f.txt"), "a\nb\nnew 1\nnew 2\nc\n").unwrap();
        // Lignes du bloc : [ a, b, +new 1, +new 2, c ] → on n'indexe que "new 2" (index 3).
        apply_lines(&repo, "f.txt", 0, Some(vec![3]), LineAction::Stage).unwrap();
        assert_eq!(index_content(&repo), "a\nb\nnew 2\nc\n");
    }

    #[test]
    fn unselected_removal_is_kept_when_staging() {
        let (dir, repo) = repo_with("a\nb\nc\n");
        fs::write(dir.path().join("f.txt"), "a\nB\nc\n").unwrap();
        // Lignes : [ a, -b, +B, c ] → indexer seulement l'ajout de "B" garde aussi "b".
        apply_lines(&repo, "f.txt", 0, Some(vec![2]), LineAction::Stage).unwrap();
        assert_eq!(index_content(&repo), "a\nb\nB\nc\n");
    }

    #[test]
    fn missing_final_newline_is_preserved() {
        let (dir, repo) = repo_with("a\nb");
        fs::write(dir.path().join("f.txt"), "a\nb\nc").unwrap();
        apply_lines(&repo, "f.txt", 0, None, LineAction::Stage).unwrap();
        assert_eq!(index_content(&repo), "a\nb\nc");
    }

    #[test]
    fn untracked_file_is_rejected() {
        let (dir, repo) = repo_with("a\n");
        fs::write(dir.path().join("new.txt"), "x\n").unwrap();
        assert!(apply_lines(&repo, "new.txt", 0, None, LineAction::Stage).is_err());
    }

    #[test]
    fn build_patch_skips_when_nothing_selected() {
        let hunk = RawHunk {
            old_start: 1,
            new_start: 1,
            lines: vec![RawLine { origin: ' ', content: b"a\n".to_vec() }, RawLine { origin: '+', content: b"b\n".to_vec() }],
        };
        assert!(build_patch("f", &hunk, &HashSet::new(), false).is_none());
    }
}
