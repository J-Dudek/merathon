use git2::{FetchOptions, Repository, SubmoduleIgnore, SubmoduleStatus, SubmoduleUpdateOptions};
use serde::Serialize;
use super::auth::remote_callbacks;
use super::error::GitError;
use super::remote::CredsLookup;

#[derive(Debug, Serialize, Clone)]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub branch: Option<String>,
    /// Commit enregistré dans le dépôt parent.
    pub recorded_hash: Option<String>,
    /// Commit actuellement extrait dans le sous-module.
    pub checked_out_hash: Option<String>,
    /// uninitialized | commit_changed | dirty | ok
    pub state: String,
}

pub fn list_submodules(repo: &Repository) -> Result<Vec<SubmoduleInfo>, GitError> {
    let mut list = Vec::new();
    for sm in repo.submodules()? {
        let name = sm.name().unwrap_or("").to_string();
        let status = repo.submodule_status(&name, SubmoduleIgnore::None)?;
        let state = if status.contains(SubmoduleStatus::WD_UNINITIALIZED) {
            "uninitialized"
        } else if status.contains(SubmoduleStatus::WD_MODIFIED) {
            "commit_changed"
        } else if status.intersects(
            SubmoduleStatus::WD_INDEX_MODIFIED | SubmoduleStatus::WD_WD_MODIFIED | SubmoduleStatus::WD_UNTRACKED,
        ) {
            "dirty"
        } else {
            "ok"
        };
        list.push(SubmoduleInfo {
            path: sm.path().to_string_lossy().to_string(),
            url: sm.url().ok().flatten().map(str::to_string),
            branch: sm.branch().ok().flatten().map(str::to_string),
            recorded_hash: sm.index_id().or(sm.head_id()).map(|o| o.to_string()),
            checked_out_hash: sm.workdir_id().map(|o| o.to_string()),
            state: state.to_string(),
            name,
        });
    }
    Ok(list)
}

/// Initialise et met à jour les sous-modules (tous si `names` est vide), récursivement.
pub fn update_submodules(repo: &Repository, names: &[String], creds: CredsLookup) -> Result<(), GitError> {
    for mut sm in repo.submodules()? {
        let name = sm.name().unwrap_or("").to_string();
        if !names.is_empty() && !names.contains(&name) {
            continue;
        }
        // init résout les URL relatives (../autre.git) dans la config du dépôt parent.
        sm.init(false)?;
        let url = repo
            .config()?
            .get_string(&format!("submodule.{name}.url"))
            .ok()
            .or_else(|| sm.url().ok().flatten().map(str::to_string))
            .unwrap_or_default();

        let mut fetch = FetchOptions::new();
        fetch.remote_callbacks(remote_callbacks(creds(&url)));
        let mut opts = SubmoduleUpdateOptions::new();
        opts.fetch(fetch);
        sm.update(true, Some(&mut opts))
            .map_err(|e| GitError::Other(format!("Sous-module « {name} » : {}", e.message())))?;

        if let Ok(sub_repo) = sm.open() {
            update_submodules(&sub_repo, &[], creds)?;
        }
    }
    Ok(())
}

/// Vrai si `path` est un sous-module du dépôt.
pub(crate) fn is_submodule(repo: &Repository, path: &str) -> bool {
    repo.find_submodule(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{clone_repo, Credentials};
    use std::fs;
    use tempfile::TempDir;

    fn no_creds(_: &str) -> Option<Credentials> {
        None
    }

    fn commit_all(repo: &Repository, msg: &str) {
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let mut index = repo.index().unwrap();
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parents: Vec<git2::Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap();
    }

    /// Dépôt "lib" + dépôt "app" qui l'inclut dans vendor/lib.
    fn setup() -> (TempDir, String) {
        let root = TempDir::new().unwrap();
        let lib_path = root.path().join("lib");
        let lib = Repository::init(&lib_path).unwrap();
        fs::write(lib_path.join("lib.txt"), "lib\n").unwrap();
        commit_all(&lib, "lib init");

        let app_path = root.path().join("app");
        let app = Repository::init(&app_path).unwrap();
        fs::write(app_path.join("app.txt"), "app\n").unwrap();
        commit_all(&app, "app init");
        let mut sm = app.submodule(lib_path.to_str().unwrap(), std::path::Path::new("vendor/lib"), true).unwrap();
        sm.clone(None).unwrap();
        sm.add_finalize().unwrap();
        let sig = git2::Signature::now("T", "t@t").unwrap();
        let mut index = app.index().unwrap();
        let tree = app.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = app.head().unwrap().peel_to_commit().unwrap();
        app.commit(Some("HEAD"), &sig, &sig, "add submodule", &tree, &[&parent]).unwrap();
        (root, app_path.to_str().unwrap().to_string())
    }

    #[test]
    fn listed_and_ok_in_original_repo() {
        let (_root, app_path) = setup();
        let app = Repository::open(&app_path).unwrap();
        let subs = list_submodules(&app).unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].path, "vendor/lib");
        assert_eq!(subs[0].state, "ok");
    }

    #[test]
    fn fresh_clone_is_uninitialized_until_updated() {
        let (root, app_path) = setup();
        let clone_path = root.path().join("clone");
        clone_repo(&app_path, clone_path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&clone_path).unwrap();

        assert_eq!(list_submodules(&clone).unwrap()[0].state, "uninitialized");
        update_submodules(&clone, &[], &no_creds).unwrap();
        assert_eq!(list_submodules(&clone).unwrap()[0].state, "ok");
        assert!(clone_path.join("vendor/lib/lib.txt").exists());
    }

    #[test]
    fn detects_submodule_paths() {
        let (_root, app_path) = setup();
        let app = Repository::open(&app_path).unwrap();
        assert!(is_submodule(&app, "vendor/lib"));
        assert!(!is_submodule(&app, "app.txt"));
    }
}
