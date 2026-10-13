use std::cell::RefCell;
use git2::{build::RepoBuilder, AutotagOption, BranchType, FetchOptions, FetchPrune, PushOptions, Repository};
use serde::Serialize;
use super::auth::{remote_callbacks, Credentials};
use super::error::GitError;
use super::merge::{merge_annotated, MergeResult};
use super::ops::rebase_onto;

/// Fournit les identifiants à utiliser pour une URL de remote donnée.
pub type CredsLookup<'a> = &'a dyn Fn(&str) -> Option<Credentials>;

#[derive(Debug, Serialize, Clone)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

pub fn init_repo(path: &str) -> Result<(), GitError> {
    Repository::init(path)?;
    Ok(())
}

pub fn clone_repo(url: &str, path: &str, creds: CredsLookup) -> Result<(), GitError> {
    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(remote_callbacks(creds(url)));

    RepoBuilder::new()
        .fetch_options(fetch_opts)
        .clone(url, std::path::Path::new(path))?;
    Ok(())
}

pub fn list_remotes(repo: &Repository) -> Result<Vec<RemoteInfo>, GitError> {
    let names = repo.remotes()?;
    Ok(names
        .iter()
        .filter_map(|r| r.ok().flatten())
        .filter_map(|name| {
            let remote = repo.find_remote(name).ok()?;
            Some(RemoteInfo { name: name.to_string(), url: remote.url().unwrap_or("").to_string() })
        })
        .collect())
}

pub fn add_remote(repo: &Repository, name: &str, url: &str) -> Result<(), GitError> {
    repo.remote(name, url)?;
    Ok(())
}

pub fn remove_remote(repo: &Repository, name: &str) -> Result<(), GitError> {
    repo.remote_delete(name)?;
    Ok(())
}

pub fn fetch(repo: &Repository, remote_name: &str, creds: CredsLookup) -> Result<(), GitError> {
    let mut remote = repo.find_remote(remote_name)?;
    let url = remote.url().unwrap_or("").to_string();
    let mut fetch_opts = FetchOptions::new();
    fetch_opts
        .remote_callbacks(remote_callbacks(creds(&url)))
        .prune(FetchPrune::On)
        .download_tags(AutotagOption::All);
    remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
    Ok(())
}

pub fn fetch_all(repo: &Repository, creds: CredsLookup) -> Result<(), GitError> {
    for name in repo.remotes()?.iter().filter_map(|r| r.ok().flatten()) {
        fetch(repo, name, creds)?;
    }
    Ok(())
}

fn push_refspecs(repo: &Repository, remote_name: &str, refspecs: &[String], creds: CredsLookup) -> Result<(), GitError> {
    let mut remote = repo.find_remote(remote_name)?;
    let url = remote.url().unwrap_or("").to_string();

    let rejected: RefCell<Vec<String>> = RefCell::new(Vec::new());
    let mut callbacks = remote_callbacks(creds(&url));
    callbacks.push_update_reference(|refname, status| {
        if let Some(msg) = status {
            rejected.borrow_mut().push(format!("{refname} : {msg}"));
        }
        Ok(())
    });

    let mut opts = PushOptions::new();
    opts.remote_callbacks(callbacks);
    remote.push(refspecs, Some(&mut opts))?;
    drop(opts);

    let rejected = rejected.into_inner();
    if !rejected.is_empty() {
        return Err(GitError::Other(format!(
            "Push refusé ({}). Fais un pull avant de pousser, ou force le push.",
            rejected.join(", ")
        )));
    }
    Ok(())
}

pub fn push_branch(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    force: bool,
    creds: CredsLookup,
) -> Result<(), GitError> {
    let prefix = if force { "+" } else { "" };
    let refspec = format!("{prefix}refs/heads/{branch}:refs/heads/{branch}");
    push_refspecs(repo, remote_name, &[refspec], creds)?;

    let mut local = repo.find_branch(branch, BranchType::Local)?;
    if local.upstream().is_err() {
        // La branche de suivi peut ne pas encore exister localement juste après le premier push.
        let tracking = format!("refs/remotes/{remote_name}/{branch}");
        if repo.find_reference(&tracking).is_err() {
            let tip = local.get().target().ok_or_else(|| GitError::Other("branche sans commit".into()))?;
            repo.reference(&tracking, tip, true, "push: création de la branche de suivi")?;
        }
        local.set_upstream(Some(&format!("{remote_name}/{branch}")))?;
    }
    Ok(())
}

pub fn delete_remote_branch(repo: &Repository, remote_branch: &str, creds: CredsLookup) -> Result<(), GitError> {
    let (remote_name, branch) = remote_branch
        .split_once('/')
        .ok_or_else(|| GitError::Other(format!("nom de branche distante invalide : {remote_branch}")))?;
    push_refspecs(repo, remote_name, &[format!(":refs/heads/{branch}")], creds)?;
    if let Ok(mut r) = repo.find_reference(&format!("refs/remotes/{remote_branch}")) {
        r.delete()?;
    }
    Ok(())
}

pub fn push_tag(repo: &Repository, remote_name: &str, tag: &str, creds: CredsLookup) -> Result<(), GitError> {
    push_refspecs(repo, remote_name, &[format!("refs/tags/{tag}:refs/tags/{tag}")], creds)
}

pub fn delete_remote_tag(repo: &Repository, remote_name: &str, tag: &str, creds: CredsLookup) -> Result<(), GitError> {
    push_refspecs(repo, remote_name, &[format!(":refs/tags/{tag}")], creds)
}

/// Remote et branche distante suivies par la branche courante.
pub fn head_upstream(repo: &Repository) -> Result<(String, String, String), GitError> {
    if repo.head_detached().unwrap_or(false) {
        return Err(GitError::Other("HEAD détaché : bascule sur une branche pour faire un pull/push".into()));
    }
    let head = repo.head()?;
    let refname = head.name().map_err(|_| GitError::Other("HEAD invalide".into()))?.to_string();
    let branch_name = head.shorthand().unwrap_or("").to_string();
    let local = repo.find_branch(&branch_name, BranchType::Local)?;
    let upstream = local.upstream().map_err(|_| {
        GitError::Other(format!("La branche « {branch_name} » ne suit aucune branche distante : pousse-la d'abord"))
    })?;
    let upstream_name = upstream.name()?.unwrap_or("").to_string();
    let remote_buf = repo.branch_upstream_remote(&refname)?;
    let remote_name = remote_buf.as_str().unwrap_or("origin").to_string();
    Ok((branch_name, remote_name, upstream_name))
}

/// Fetch puis intègre la branche suivie : fast-forward si possible, sinon merge ou rebase.
pub fn pull(repo: &Repository, rebase: bool, creds: CredsLookup) -> Result<MergeResult, GitError> {
    let (_, remote_name, upstream_name) = head_upstream(repo)?;
    fetch(repo, &remote_name, creds)?;

    let upstream = repo.find_branch(&upstream_name, BranchType::Remote)?;
    let annotated = repo.reference_to_annotated_commit(upstream.get())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;

    if rebase && !analysis.is_up_to_date() && !analysis.is_fast_forward() {
        let result = rebase_onto(repo, &upstream_name)?;
        return Ok(MergeResult { conflicted_files: result.conflicted_files, success: result.success });
    }
    merge_annotated(repo, &annotated, &upstream_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn no_creds(_: &str) -> Option<Credentials> {
        None
    }

    #[test]
    fn init_creates_repository() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        init_repo(path).unwrap();
        assert!(Repository::open(path).is_ok());
    }

    #[test]
    fn init_on_existing_path_is_ok() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();
        init_repo(path).unwrap();
        // Re-init is idempotent
        assert!(init_repo(path).is_ok());
    }

    #[test]
    fn fetch_missing_remote_returns_error() {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let result = fetch(&repo, "origin", &no_creds);
        assert!(result.is_err());
    }

    fn configure(repo: &Repository) {
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();
    }

    fn commit_file(repo: &Repository, file: &str, content: &str, msg: &str) {
        let workdir = repo.workdir().unwrap().to_path_buf();
        fs::write(workdir.join(file), content).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap();
    }

    /// Dépôt bare servant de remote + un premier clone qui y a poussé `master`.
    fn setup_remote() -> (TempDir, Repository, String) {
        let root = TempDir::new().unwrap();
        let bare_path = root.path().join("remote.git");
        Repository::init_bare(&bare_path).unwrap();
        let url = bare_path.to_str().unwrap().to_string();

        let work = Repository::init(root.path().join("work1")).unwrap();
        configure(&work);
        commit_file(&work, "a.txt", "a\n", "first");
        work.remote("origin", &url).unwrap();
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();
        (root, work, url)
    }

    #[test]
    fn push_sets_upstream() {
        let (_root, work, _url) = setup_remote();
        let branch = work.find_branch("master", BranchType::Local).unwrap();
        assert_eq!(branch.upstream().unwrap().name().unwrap(), Some("origin/master"));
    }

    #[test]
    fn clone_then_pull_fast_forward() {
        let (root, work, url) = setup_remote();
        let clone_path = root.path().join("work2");
        clone_repo(&url, clone_path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&clone_path).unwrap();
        configure(&clone);

        commit_file(&work, "b.txt", "b\n", "second");
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();

        let result = pull(&clone, false, &no_creds).unwrap();
        assert!(result.success);
        assert!(clone_path.join("b.txt").exists());
    }

    #[test]
    fn push_rejected_when_behind() {
        let (root, work, url) = setup_remote();
        let clone_path = root.path().join("work2");
        clone_repo(&url, clone_path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&clone_path).unwrap();
        configure(&clone);

        commit_file(&work, "b.txt", "b\n", "from work1");
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();
        commit_file(&clone, "c.txt", "c\n", "from work2");

        assert!(push_branch(&clone, "origin", "master", false, &no_creds).is_err());

        // pull --rebase puis push passe
        let result = pull(&clone, true, &no_creds).unwrap();
        assert!(result.success);
        push_branch(&clone, "origin", "master", false, &no_creds).unwrap();
    }

    #[test]
    fn list_and_remove_remotes() {
        let (_root, work, url) = setup_remote();
        let remotes = list_remotes(&work).unwrap();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].url, url);
        add_remote(&work, "upstream", "https://example.com/x.git").unwrap();
        remove_remote(&work, "upstream").unwrap();
        assert_eq!(list_remotes(&work).unwrap().len(), 1);
    }

    /// Vérifie que le transport HTTPS est bien compilé (réseau requis : `cargo test -- --ignored`).
    #[test]
    #[ignore]
    fn https_transport_available() {
        let mut remote = git2::Remote::create_detached("https://github.com/git/git.git").unwrap();
        remote.connect(git2::Direction::Fetch).unwrap();
        assert!(!remote.list().unwrap().is_empty());
    }
}
