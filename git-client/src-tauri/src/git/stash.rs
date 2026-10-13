use git2::{Repository, StashApplyOptions, StashFlags};
use serde::Serialize;
use super::error::GitError;
use super::repository::signature;

#[derive(Debug, Serialize, Clone)]
pub struct StashInfo {
    pub index: usize,
    pub message: String,
    pub hash: String,
}

pub fn list_stashes(repo: &mut Repository) -> Result<Vec<StashInfo>, GitError> {
    let mut stashes = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        stashes.push(StashInfo { index, message: message.to_string(), hash: oid.to_string() });
        true
    })?;
    Ok(stashes)
}

pub fn stash_save(repo: &mut Repository, message: Option<&str>, include_untracked: bool) -> Result<(), GitError> {
    let sig = signature(repo)?;
    let flags = if include_untracked { StashFlags::INCLUDE_UNTRACKED } else { StashFlags::DEFAULT };
    repo.stash_save2(&sig, message.filter(|m| !m.trim().is_empty()), Some(flags))
        .map_err(|e| match e.code() {
            git2::ErrorCode::NotFound => GitError::Other("Aucune modification à mettre de côté".into()),
            _ => e.into(),
        })?;
    Ok(())
}

pub fn stash_apply(repo: &mut Repository, index: usize, pop: bool) -> Result<(), GitError> {
    let mut opts = StashApplyOptions::new();
    opts.reinstantiate_index();
    if pop {
        repo.stash_pop(index, Some(&mut opts))?;
    } else {
        repo.stash_apply(index, Some(&mut opts))?;
    }
    Ok(())
}

pub fn stash_drop(repo: &mut Repository, index: usize) -> Result<(), GitError> {
    repo.stash_drop(index)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn base_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();
        // Fins de ligne LF même si le git du système a core.autocrlf=true (runners Windows)
        cfg.set_bool("core.autocrlf", false).unwrap();
        fs::write(dir.path().join("file.txt"), "v1\n").unwrap();
        {
            let sig = git2::Signature::now("Test", "test@test.com").unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("file.txt")).unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        }
        (dir, repo)
    }

    #[test]
    fn save_list_pop() {
        let (dir, mut repo) = base_repo();
        fs::write(dir.path().join("file.txt"), "wip\n").unwrap();

        stash_save(&mut repo, Some("my wip"), false).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("file.txt")).unwrap(), "v1\n");

        let stashes = list_stashes(&mut repo).unwrap();
        assert_eq!(stashes.len(), 1);
        assert!(stashes[0].message.contains("my wip"));

        stash_apply(&mut repo, 0, true).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("file.txt")).unwrap(), "wip\n");
        assert!(list_stashes(&mut repo).unwrap().is_empty());
    }

    #[test]
    fn untracked_files_are_stashed_on_request() {
        let (dir, mut repo) = base_repo();
        fs::write(dir.path().join("new.txt"), "new").unwrap();
        stash_save(&mut repo, None, true).unwrap();
        assert!(!dir.path().join("new.txt").exists());
        stash_drop(&mut repo, 0).unwrap();
        assert!(list_stashes(&mut repo).unwrap().is_empty());
    }

    #[test]
    fn nothing_to_stash_gives_clear_error() {
        let (_dir, mut repo) = base_repo();
        let err = stash_save(&mut repo, None, false).unwrap_err();
        assert!(err.to_string().contains("Aucune modification"));
    }
}
