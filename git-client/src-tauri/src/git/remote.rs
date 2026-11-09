use std::cell::RefCell;
use git2::{build::RepoBuilder, AutotagOption, BranchType, ErrorCode, FetchOptions, FetchPrune, PushOptions, Repository, RepositoryState};
use serde::Serialize;
use super::auth::{proxy_options, remote_callbacks, Credentials};
use super::error::GitError;
use super::merge::{advance_head, merge_annotated, MergeResult};
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
    fetch_opts.remote_callbacks(remote_callbacks(creds(url), std::path::Path::new(path))).proxy_options(proxy_options());

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
        .remote_callbacks(remote_callbacks(creds(&url), repo.path()))
        .proxy_options(proxy_options())
        .prune(FetchPrune::On)
        .download_tags(AutotagOption::All);
    crate::debug_log::timed(format!("fetch {remote_name} ({url})"), || remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None))?;
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
    let mut callbacks = remote_callbacks(creds(&url), repo.path());
    callbacks.push_update_reference(|refname, status| {
        if let Some(msg) = status {
            rejected.borrow_mut().push(tr!("{refname} : {msg}", "{refname}: {msg}"));
        }
        Ok(())
    });

    let mut opts = PushOptions::new();
    opts.remote_callbacks(callbacks).proxy_options(proxy_options());
    crate::debug_log::timed(format!("push {remote_name} ({url})"), || remote.push(refspecs, Some(&mut opts)))?;
    drop(opts);

    let rejected = rejected.into_inner();
    if !rejected.is_empty() {
        return Err(GitError::Other(tr!("Push refusé ({}). Fais un pull avant de pousser, ou force le push.", "Push refused ({}). Pull before pushing, or force the push.",
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

    // libgit2 ne met à jour la branche de suivi que si le refspec de fetch la couvre :
    // on l'aligne nous-mêmes sur le commit poussé.
    let mut local = repo.find_branch(branch, BranchType::Local)?;
    let tip = local.get().target().ok_or_else(|| GitError::Other(tr!("branche sans commit", "branch without commits")))?;
    let tracking = format!("{remote_name}/{branch}");
    repo.reference(&format!("refs/remotes/{tracking}"), tip, true, "push: mise à jour de la branche de suivi")?;

    // Une branche renommée ou créée depuis une autre branche distante suit encore celle-ci :
    // le push est allé ailleurs, et l'avance resterait affichée tant qu'on ne la rebranche pas.
    let upstream = local.upstream().ok().and_then(|u| u.name().ok().flatten().map(str::to_string));
    if upstream.as_deref() != Some(tracking.as_str()) {
        local.set_upstream(Some(&tracking))?;
    }
    Ok(())
}

pub fn delete_remote_branch(repo: &Repository, remote_branch: &str, creds: CredsLookup) -> Result<(), GitError> {
    let (remote_name, branch) = remote_branch
        .split_once('/')
        .ok_or_else(|| GitError::Other(tr!("nom de branche distante invalide : {remote_branch}", "invalid remote branch name: {remote_branch}")))?;
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
        return Err(GitError::Other(tr!("HEAD détaché : bascule sur une branche pour faire un pull/push", "Detached HEAD: switch to a branch to pull/push")));
    }
    let head = repo.head()?;
    let refname = head.name().map_err(|_| GitError::Other(tr!("HEAD invalide", "invalid HEAD")))?.to_string();
    let branch_name = head.shorthand().unwrap_or("").to_string();
    let local = repo.find_branch(&branch_name, BranchType::Local)?;
    let upstream = local.upstream().map_err(|_| match repo.branch_upstream_name(&refname) {
        // Suivi configuré, mais la branche de suivi a disparu : supprimée sur le serveur puis retirée par un fetch.
        Ok(name) => upstream_gone(&branch_name, name.as_str().unwrap_or_default()),
        Err(_) => GitError::Other(tr!("La branche « {branch_name} » ne suit aucune branche distante : pousse-la d'abord", "Branch \"{branch_name}\" does not track any remote branch: push it first")),
    })?;
    let upstream_name = upstream.name()?.unwrap_or("").to_string();
    let remote_buf = repo.branch_upstream_remote(&refname)?;
    let remote_name = remote_buf.as_str().unwrap_or("origin").to_string();
    Ok((branch_name, remote_name, upstream_name))
}

/// Branche suivie supprimée sur le serveur (souvent après le merge de sa PR / MR).
fn upstream_gone(branch: &str, upstream: &str) -> GitError {
    let upstream = upstream.strip_prefix("refs/remotes/").unwrap_or(upstream);
    GitError::Other(format!(
        "La branche distante {upstream} n'existe plus : elle a été supprimée sur le serveur, souvent après le merge \
         de sa PR / MR. Bascule sur une autre branche, ou pousse « {branch} » pour la recréer"
    ))
}

/// Fetch puis intègre la branche suivie : fast-forward si possible, sinon merge ou rebase.
pub fn pull(repo: &Repository, rebase: bool, creds: CredsLookup) -> Result<MergeResult, GitError> {
    let (branch_name, remote_name, upstream_name) = head_upstream(repo)?;
    fetch(repo, &remote_name, creds)?;

    // Le fetch (avec prune) vient de retirer la branche suivie : elle n'existe plus sur le serveur.
    let upstream = repo
        .find_branch(&upstream_name, BranchType::Remote)
        .map_err(|_| upstream_gone(&branch_name, &upstream_name))?;
    let annotated = repo.reference_to_annotated_commit(upstream.get())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;

    crate::debug_log::timed(format!("pull: integrate {upstream_name}"), || {
        if rebase && !analysis.is_up_to_date() && !analysis.is_fast_forward() {
            let result = rebase_onto(repo, &upstream_name)?;
            return Ok(MergeResult { conflicted_files: result.conflicted_files, success: result.success });
        }
        merge_annotated(repo, &annotated, &upstream_name)
    })
}

/// Résultat d'un pull automatique ([`pull_fast_forward`]) : ce qui a été fait, ou pourquoi rien ne l'a été.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FastForwardPull {
    /// Déjà à jour (après le fetch).
    UpToDate,
    /// Branche avancée de `commits` commits.
    Updated { commits: usize, branch: String },
    /// Commits locaux et distants : un merge ou un rebase est nécessaire, laissé à l'utilisateur.
    Diverged { branch: String },
    /// Des modifications locales seraient écrasées : rien n'a été touché.
    LocalChanges { branch: String },
    /// Rien à tirer : HEAD détaché, branche sans suivi, ou merge / rebase en cours.
    Skipped,
}

/// Pull sans risque, pour une synchronisation automatique : fetch du remote suivi puis fast-forward seulement.
/// Jamais de commit de merge, de rebase ni de conflit ; la copie de travail n'est modifiée que si le checkout
/// « safe » le permet. Seul le fetch peut échouer (réseau, authentification).
pub fn pull_fast_forward(repo: &Repository, creds: CredsLookup) -> Result<FastForwardPull, GitError> {
    if repo.state() != RepositoryState::Clean {
        return Ok(FastForwardPull::Skipped);
    }
    let Ok((branch, remote_name, upstream_name)) = head_upstream(repo) else { return Ok(FastForwardPull::Skipped) };
    fetch(repo, &remote_name, creds)?;
    // Branche suivie supprimée sur le serveur (retirée par le prune du fetch) : rien à tirer.
    let Ok(upstream) = repo.find_branch(&upstream_name, BranchType::Remote) else { return Ok(FastForwardPull::Skipped) };
    let annotated = repo.reference_to_annotated_commit(upstream.get())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated])?;
    if analysis.is_up_to_date() {
        return Ok(FastForwardPull::UpToDate);
    }
    if !analysis.is_fast_forward() {
        return Ok(FastForwardPull::Diverged { branch });
    }
    let head = repo.head()?.peel_to_commit()?.id();
    let (_, commits) = repo.graph_ahead_behind(head, annotated.id())?;
    match advance_head(repo, &annotated, &upstream_name) {
        Ok(()) => Ok(FastForwardPull::Updated { commits, branch }),
        // Le checkout « safe » vérifie tous les fichiers avant d'en écrire un : la copie de travail est intacte.
        Err(GitError::Git(e)) if e.code() == ErrorCode::Conflict => Ok(FastForwardPull::LocalChanges { branch }),
        Err(e) => Err(e),
    }
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
    fn push_repoints_upstream_with_other_name() {
        let (_root, work, _url) = setup_remote();
        let head = work.head().unwrap().peel_to_commit().unwrap();
        work.branch("feat", &head, false).unwrap();
        work.set_head("refs/heads/feat").unwrap();
        // Branche renommée localement : elle suit encore origin/old-feat.
        work.reference("refs/remotes/origin/old-feat", head.id(), true, "").unwrap();
        work.find_branch("feat", BranchType::Local).unwrap().set_upstream(Some("origin/old-feat")).unwrap();
        commit_file(&work, "b.txt", "b\n", "second");

        push_branch(&work, "origin", "feat", false, &no_creds).unwrap();

        let branch = work.find_branch("feat", BranchType::Local).unwrap();
        let upstream = branch.upstream().unwrap();
        assert_eq!(upstream.name().unwrap(), Some("origin/feat"));
        let (ahead, _) = work.graph_ahead_behind(branch.get().target().unwrap(), upstream.get().target().unwrap()).unwrap();
        assert_eq!(ahead, 0);
    }

    /// Clone de `url` (dans `root/name`) qui suit `master`.
    fn clone_of(root: &TempDir, url: &str, name: &str) -> Repository {
        let path = root.path().join(name);
        clone_repo(url, path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&path).unwrap();
        configure(&clone);
        clone
    }

    #[test]
    fn automatic_pull_fast_forwards() {
        let (root, work, url) = setup_remote();
        let clone = clone_of(&root, &url, "work2");
        assert_eq!(pull_fast_forward(&clone, &no_creds).unwrap(), FastForwardPull::UpToDate);

        commit_file(&work, "b.txt", "b\n", "second");
        commit_file(&work, "c.txt", "c\n", "third");
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();
        // Une modification locale sans rapport ne bloque pas le fast-forward.
        fs::write(clone.workdir().unwrap().join("a.txt"), "local\n").unwrap();

        assert_eq!(
            pull_fast_forward(&clone, &no_creds).unwrap(),
            FastForwardPull::Updated { commits: 2, branch: "master".into() },
        );
        assert!(clone.workdir().unwrap().join("c.txt").exists());
        assert_eq!(fs::read_to_string(clone.workdir().unwrap().join("a.txt")).unwrap(), "local\n");
    }

    #[test]
    fn automatic_pull_never_merges() {
        let (root, work, url) = setup_remote();
        let clone = clone_of(&root, &url, "work2");
        commit_file(&work, "b.txt", "b\n", "distant");
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();
        commit_file(&clone, "c.txt", "c\n", "local");
        let head = clone.head().unwrap().target();

        assert_eq!(pull_fast_forward(&clone, &no_creds).unwrap(), FastForwardPull::Diverged { branch: "master".into() });
        assert_eq!(clone.head().unwrap().target(), head, "branche inchangée");
    }

    #[test]
    fn automatic_pull_keeps_conflicting_local_changes() {
        let (root, work, url) = setup_remote();
        let clone = clone_of(&root, &url, "work2");
        commit_file(&work, "a.txt", "distant\n", "second");
        push_branch(&work, "origin", "master", false, &no_creds).unwrap();
        let a = clone.workdir().unwrap().join("a.txt");
        fs::write(&a, "local\n").unwrap();
        let head = clone.head().unwrap().target();

        assert_eq!(pull_fast_forward(&clone, &no_creds).unwrap(), FastForwardPull::LocalChanges { branch: "master".into() });
        assert_eq!(fs::read_to_string(&a).unwrap(), "local\n");
        assert_eq!(clone.head().unwrap().target(), head);
    }

    #[test]
    fn automatic_pull_skips_detached_head() {
        let (root, _work, url) = setup_remote();
        let clone = clone_of(&root, &url, "work2");
        clone.set_head_detached(clone.head().unwrap().target().unwrap()).unwrap();
        assert_eq!(pull_fast_forward(&clone, &no_creds).unwrap(), FastForwardPull::Skipped);
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
    fn pull_explains_a_branch_deleted_on_the_remote() {
        let (root, work, url) = setup_remote();
        let head = work.head().unwrap().peel_to_commit().unwrap();
        work.branch("feat", &head, false).unwrap();
        push_branch(&work, "origin", "feat", false, &no_creds).unwrap();

        let clone_path = root.path().join("work2");
        clone_repo(&url, clone_path.to_str().unwrap(), &no_creds).unwrap();
        let clone = Repository::open(&clone_path).unwrap();
        let remote_feat = clone.find_branch("origin/feat", BranchType::Remote).unwrap().get().peel_to_commit().unwrap();
        clone.branch("feat", &remote_feat, false).unwrap().set_upstream(Some("origin/feat")).unwrap();
        clone.set_head("refs/heads/feat").unwrap();

        delete_remote_branch(&work, "origin/feat", &no_creds).unwrap();

        // Le fetch du pull retire origin/feat : le message le dit au lieu de « cannot locate remote-tracking branch ».
        let first = pull(&clone, false, &no_creds).unwrap_err().to_string();
        assert!(first.contains("origin/feat n'existe plus"), "{first}");
        // Ensuite la branche de suivi est absente dès le départ : même explication, pas « ne suit aucune branche ».
        let again = pull(&clone, false, &no_creds).unwrap_err().to_string();
        assert!(again.contains("origin/feat n'existe plus"), "{again}");
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

    /// Serveur qui accepte les connexions sans jamais répondre.
    fn silent_server() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let mut open = Vec::new();
            for stream in listener.incoming() {
                open.push(stream);
            }
        });
        port
    }

    #[test]
    fn silent_server_ends_in_an_error_instead_of_blocking() {
        crate::git::auth::set_network_timeouts(2_000, 2_000).unwrap();
        let port = silent_server();
        // Sous Windows, HTTP et HTTPS passent par WinHTTP, qui ignore les délais de libgit2
        // (lecture infinie, connexion 60 s en dur dans transports/winhttp.c) : seul SSH les respecte.
        let schemes: &[&str] = if cfg!(windows) { &["ssh"] } else { &["http", "https", "ssh"] };
        for &scheme in schemes {
            let (done, result) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let dir = TempDir::new().unwrap();
                let repo = Repository::init(dir.path()).unwrap();
                repo.remote("origin", &format!("{scheme}://git@127.0.0.1:{port}/x.git")).unwrap();
                done.send(fetch(&repo, "origin", &no_creds).map_err(|e| e.to_string())).unwrap();
            });
            let outcome = result.recv_timeout(std::time::Duration::from_secs(20));
            let outcome = outcome.unwrap_or_else(|_| panic!("{scheme} : fetch toujours bloqué après 20 s"));
            assert!(outcome.is_err(), "{scheme} : une erreur était attendue");
        }
    }

    #[test]
    fn fetch_goes_through_the_configured_proxy() {
        use std::io::{Read, Write};
        let proxy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = proxy.local_addr().unwrap().port();
        let (done, received) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = proxy.accept().unwrap();
            let mut buffer = [0u8; 1024];
            let n = stream.read(&mut buffer).unwrap();
            stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            done.send(String::from_utf8_lossy(&buffer[..n]).to_string()).unwrap();
        });

        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.config().unwrap().set_str("http.proxy", &format!("http://127.0.0.1:{port}")).unwrap();
        // L'hôte n'existe pas : seul le proxy peut recevoir la requête.
        repo.remote("origin", "https://merathon.invalid/x.git").unwrap();
        let outcome = fetch(&repo, "origin", &no_creds).map_err(|e| e.to_string());
        assert!(outcome.is_err());
        let request = received.recv_timeout(std::time::Duration::from_secs(5));
        let request = request.unwrap_or_else(|_| panic!("le proxy n'a reçu aucune requête : {outcome:?}"));
        assert!(request.contains("merathon.invalid"), "{request}");
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
