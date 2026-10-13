use std::collections::HashMap;
use git2::{BranchType, Delta, DiffFindOptions, Oid, Patch, Repository, Sort};
use serde::Serialize;
use super::error::GitError;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Head,
    Local,
    Remote,
    Tag,
}

#[derive(Debug, Serialize, Clone)]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Debug, Serialize, Clone)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefLabel>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub target_hash: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct TagInfo {
    pub name: String,
    pub target_hash: String,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Typechange,
}

#[derive(Debug, Serialize, Clone)]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangeKind,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct CommitDetails {
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub parents: Vec<String>,
    pub files: Vec<CommitFile>,
}

pub fn get_commits(repo: &Repository, limit: usize) -> Result<Vec<CommitInfo>, GitError> {
    let mut walk = repo.revwalk()?;
    walk.push_head().unwrap_or(());
    // Comme GitKraken : le graphe montre toutes les branches, pas seulement HEAD.
    for glob in ["refs/heads/*", "refs/remotes/*", "refs/tags/*"] {
        walk.push_glob(glob).unwrap_or(());
    }
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    let refs = collect_refs(repo);

    let commits = walk
        .take(limit)
        .filter_map(|oid| oid.ok())
        .filter_map(|oid| repo.find_commit(oid).ok())
        .map(|commit| {
            let hash = commit.id().to_string();
            let commit_refs = refs.get(&commit.id()).cloned().unwrap_or_default();
            CommitInfo {
                short_hash: hash[..7].to_string(),
                message: commit.summary().ok().flatten().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                parents: commit.parent_ids().map(|id| id.to_string()).collect(),
                refs: commit_refs,
                hash,
            }
        })
        .collect();

    Ok(commits)
}

pub fn get_branches(repo: &Repository) -> Result<Vec<BranchInfo>, GitError> {
    let branches = repo
        .branches(None)?
        .filter_map(|b| b.ok())
        .filter_map(|(branch, branch_type)| {
            let name = branch.name().ok()??.to_string();
            let target = branch.get().target()?;
            let upstream = branch.upstream().ok();
            let (ahead, behind) = upstream
                .as_ref()
                .and_then(|u| u.get().target())
                .and_then(|u| repo.graph_ahead_behind(target, u).ok())
                .unwrap_or((0, 0));
            Some(BranchInfo {
                name,
                is_remote: branch_type == BranchType::Remote,
                target_hash: target.to_string(),
                is_head: branch.is_head(),
                upstream: upstream.and_then(|u| u.name().ok().flatten().map(str::to_string)),
                ahead,
                behind,
            })
        })
        .collect();

    Ok(branches)
}

pub fn get_tags(repo: &Repository) -> Result<Vec<TagInfo>, GitError> {
    let mut tags = Vec::new();
    for name in repo.tag_names(None)?.iter().filter_map(|r| r.ok().flatten()) {
        let Ok(reference) = repo.find_reference(&format!("refs/tags/{name}")) else { continue };
        let Ok(commit) = reference.peel_to_commit() else { continue };
        let message = reference
            .peel_to_tag()
            .ok()
            .and_then(|t| t.message().ok().flatten().map(|m| m.trim().to_string()));
        tags.push(TagInfo { name: name.to_string(), target_hash: commit.id().to_string(), message });
    }
    Ok(tags)
}

pub fn get_commit_details(repo: &Repository, hash: &str) -> Result<CommitDetails, GitError> {
    let commit = repo.revparse_single(hash)?.peel_to_commit()?;
    let tree = commit.tree()?;
    let parent_tree = commit.parent(0).ok().map(|p| p.tree()).transpose()?;

    let files = tree_diff_files(repo, parent_tree.as_ref(), &tree)?;

    let hash = commit.id().to_string();
    let author = commit.author();
    let committer = commit.committer();
    Ok(CommitDetails {
        short_hash: hash[..7].to_string(),
        summary: commit.summary().ok().flatten().unwrap_or("").to_string(),
        message: commit.message().unwrap_or("").trim_end().to_string(),
        author: author.name().unwrap_or("").to_string(),
        email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer: committer.name().unwrap_or("").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        commit_time: commit.time().seconds(),
        parents: commit.parent_ids().map(|id| id.to_string()).collect(),
        files,
        hash,
    })
}

/// Fichiers modifiés entre deux arbres, avec détection des renommages et nombre de lignes ajoutées / supprimées.
fn tree_diff_files(repo: &Repository, old: Option<&git2::Tree>, new: &git2::Tree) -> Result<Vec<CommitFile>, GitError> {
    let mut diff = repo.diff_tree_to_tree(old, Some(new), None)?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))?;

    let mut files = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        let status = match delta.status() {
            Delta::Added => ChangeKind::Added,
            Delta::Deleted => ChangeKind::Deleted,
            Delta::Renamed => ChangeKind::Renamed,
            Delta::Copied => ChangeKind::Copied,
            Delta::Typechange => ChangeKind::Typechange,
            _ => ChangeKind::Modified,
        };
        let new_path = delta.new_file().path().map(|p| p.to_string_lossy().to_string());
        let old_path = delta.old_file().path().map(|p| p.to_string_lossy().to_string());
        let path = new_path.clone().or(old_path.clone()).unwrap_or_default();
        let (additions, deletions) = Patch::from_diff(&diff, idx)?
            .map(|p| p.line_stats().map(|(_, a, d)| (a, d)))
            .transpose()?
            .unwrap_or((0, 0));
        files.push(CommitFile {
            old_path: if status == ChangeKind::Renamed { old_path } else { None },
            path,
            status,
            additions,
            deletions,
        });
    }

    Ok(files)
}

/// Changements d'une branche par rapport à une autre, comme dans une pull request :
/// diff entre leur ancêtre commun et la tête, donc sans les commits arrivés depuis sur la base.
#[derive(Debug, Serialize, Clone)]
pub struct RefComparison {
    pub merge_base: String,
    pub head: String,
    /// Commits de la tête absents de la base.
    pub commits: usize,
    pub files: Vec<CommitFile>,
}

pub fn compare_refs(repo: &Repository, base: &str, head: &str) -> Result<RefComparison, GitError> {
    let base_commit = repo.revparse_single(base)?.peel_to_commit()?;
    let head_commit = repo.revparse_single(head)?.peel_to_commit()?;
    let merge_base = repo.merge_base(base_commit.id(), head_commit.id())?;
    let base_tree = repo.find_commit(merge_base)?.tree()?;
    let files = tree_diff_files(repo, Some(&base_tree), &head_commit.tree()?)?;
    let (commits, _) = repo.graph_ahead_behind(head_commit.id(), merge_base)?;
    Ok(RefComparison { merge_base: merge_base.to_string(), head: head_commit.id().to_string(), commits, files })
}

fn collect_refs(repo: &Repository) -> HashMap<Oid, Vec<RefLabel>> {
    let mut map: HashMap<Oid, Vec<RefLabel>> = HashMap::new();

    if let Ok(head) = repo.head() {
        if repo.head_detached().unwrap_or(false) {
            if let Some(oid) = head.target() {
                map.entry(oid).or_default().push(RefLabel { name: "HEAD".into(), kind: RefKind::Head });
            }
        }
    }

    if let Ok(refs) = repo.references() {
        for r in refs.filter_map(|r| r.ok()) {
            let kind = if r.is_branch() {
                RefKind::Local
            } else if r.is_remote() {
                RefKind::Remote
            } else if r.is_tag() {
                RefKind::Tag
            } else {
                continue;
            };
            // Les tags annotés pointent vers un objet tag : on remonte jusqu'au commit.
            let (Some(name), Ok(commit)) = (r.shorthand().ok(), r.peel_to_commit()) else { continue };
            if kind == RefKind::Remote && name.ends_with("/HEAD") {
                continue;
            }
            let kind = if kind == RefKind::Local && r.name().is_ok_and(|n| is_head_ref(repo, n)) {
                RefKind::Head
            } else {
                kind
            };
            map.entry(commit.id()).or_default().push(RefLabel { name: name.to_string(), kind });
        }
    }

    map
}

fn is_head_ref(repo: &Repository, refname: &str) -> bool {
    repo.head().ok().and_then(|h| h.name().ok().map(|n| n == refname)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_repo_with_commits() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        {
            let tree_id = {
                let mut index = repo.index().unwrap();
                index.write_tree().unwrap()
            };
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial commit", &tree, &[])
                .unwrap();
        }

        (dir, repo)
    }

    fn commit_file(repo: &Repository, dir: &TempDir, name: &str, content: &str, msg: &str) -> Oid {
        std::fs::write(dir.path().join(name), content).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(name)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&parent]).unwrap()
    }

    #[test]
    fn get_commits_empty_repo() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let result = get_commits(&repo, 100);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn get_commits_returns_commits() {
        let (_dir, repo) = make_repo_with_commits();
        let commits = get_commits(&repo, 100).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "initial commit");
        assert_eq!(commits[0].short_hash.len(), 7);
    }

    #[test]
    fn get_commits_respects_limit() {
        let (_dir, repo) = make_repo_with_commits();
        let commits = get_commits(&repo, 0).unwrap();
        assert!(commits.is_empty());
    }

    #[test]
    fn get_commits_includes_other_branches() {
        let (dir, repo) = make_repo_with_commits();
        let base = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("side", &base, false).unwrap();
        repo.set_head("refs/heads/side").unwrap();
        commit_file(&repo, &dir, "side.txt", "x", "on side");
        repo.set_head("refs/heads/master").unwrap();

        let commits = get_commits(&repo, 100).unwrap();
        assert!(commits.iter().any(|c| c.message == "on side"));
    }

    #[test]
    fn head_branch_ref_is_marked_head() {
        let (_dir, repo) = make_repo_with_commits();
        let commits = get_commits(&repo, 10).unwrap();
        let head_ref = commits[0].refs.iter().find(|r| r.name == "master").unwrap();
        assert_eq!(head_ref.kind, RefKind::Head);
    }

    #[test]
    fn get_branches_returns_head_branch() {
        let (_dir, repo) = make_repo_with_commits();
        let branches = get_branches(&repo).unwrap();
        assert!(!branches.is_empty());
        let head = branches.iter().find(|b| b.is_head);
        assert!(head.is_some());
    }

    #[test]
    fn only_checked_out_branch_is_head() {
        let (_dir, repo) = make_repo_with_commits();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("other", &head, false).unwrap();
        let branches = get_branches(&repo).unwrap();
        assert_eq!(branches.iter().filter(|b| b.is_head).count(), 1);
    }

    #[test]
    fn annotated_tag_is_listed_on_commit() {
        let (_dir, repo) = make_repo_with_commits();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        repo.tag("v1.0", head.as_object(), &sig, "release", false).unwrap();

        let tags = get_tags(&repo).unwrap();
        assert_eq!(tags[0].name, "v1.0");
        assert_eq!(tags[0].message.as_deref(), Some("release"));

        let commits = get_commits(&repo, 10).unwrap();
        assert!(commits[0].refs.iter().any(|r| r.name == "v1.0" && r.kind == RefKind::Tag));
    }

    #[test]
    fn commit_details_lists_changed_files() {
        let (dir, repo) = make_repo_with_commits();
        let oid = commit_file(&repo, &dir, "a.txt", "one\ntwo\n", "add a\n\nbody text");

        let details = get_commit_details(&repo, &oid.to_string()).unwrap();
        assert_eq!(details.summary, "add a");
        assert!(details.message.contains("body text"));
        assert_eq!(details.files.len(), 1);
        assert_eq!(details.files[0].path, "a.txt");
        assert_eq!(details.files[0].status, ChangeKind::Added);
        assert_eq!(details.files[0].additions, 2);
    }

    #[test]
    fn compare_refs_ignores_commits_added_to_the_base() {
        let (dir, repo) = make_repo_with_commits();
        let base = repo.head().unwrap().shorthand().unwrap().to_string();
        let root = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feature", &root, false).unwrap();
        commit_file(&repo, &dir, "base.txt", "on base\n", "base work");

        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force().remove_untracked(true))).unwrap();
        let head = commit_file(&repo, &dir, "a.txt", "one\n", "feature work");

        let cmp = compare_refs(&repo, &base, "feature").unwrap();
        assert_eq!(cmp.merge_base, root.id().to_string());
        assert_eq!(cmp.head, head.to_string());
        assert_eq!(cmp.commits, 1);
        assert_eq!(cmp.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["a.txt"]);

        let diff = crate::git::get_compare_file_diff(&repo, &cmp.merge_base, &cmp.head, "a.txt").unwrap();
        assert_eq!(diff.hunks[0].lines[0].content, "one");
    }
}
