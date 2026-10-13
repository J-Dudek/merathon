//! Mise à jour d'une branche de pull request sur sa branche cible, depuis le panneau de revue.
//!
//! Le rebase se fait en mémoire : ni la copie de travail, ni l'index, ni HEAD ne bougent, et un conflit
//! est détecté sans rien laisser derrière lui. Le résultat est gardé sous `refs/merathon/rebased/<branche>`
//! (invisible dans les listes de branches) jusqu'au force push, protégé comme `git push --force-with-lease`.

use std::cell::{Cell, RefCell};
use git2::{build::CheckoutBuilder, BranchType, ErrorCode, Oid, PushOptions, RebaseOptions, Repository};
use serde::Serialize;
use super::auth::remote_callbacks;
use super::error::GitError;
use super::remote::CredsLookup;
use super::repository::signature;

/// Position d'une branche par rapport à sa cible.
#[derive(Debug, Serialize, Clone)]
pub struct BranchDivergence {
    /// Commit de tête de la branche, tel que connu localement.
    pub head: String,
    /// Commits de la branche absents de la cible.
    pub ahead: usize,
    /// Commits de la cible absents de la branche : la branche est en retard s'il y en a.
    pub behind: usize,
}

pub fn branch_divergence(repo: &Repository, base: &str, head: &str) -> Result<BranchDivergence, GitError> {
    let base = repo.revparse_single(base)?.peel_to_commit()?.id();
    let head = repo.revparse_single(head)?.peel_to_commit()?.id();
    let (ahead, behind) = repo.graph_ahead_behind(head, base)?;
    Ok(BranchDivergence { head: head.to_string(), ahead, behind })
}

/// Résultat d'un rebase de branche de PR.
#[derive(Debug, Serialize, Clone)]
pub struct PrRebase {
    pub success: bool,
    /// Fichiers en conflit : le rebase automatique est impossible, rien n'a été modifié.
    pub conflicted_files: Vec<String>,
    /// Nouvelle tête de la branche, prête à être poussée.
    pub new_head: Option<String>,
    /// Commits réappliqués sur la cible.
    pub commits: usize,
    /// Commits sautés : leurs changements étaient déjà dans la cible (ou commits de merge, retirés comme par `git rebase`).
    pub skipped: usize,
}

fn rebased_ref(branch: &str) -> String {
    format!("refs/merathon/rebased/{branch}")
}

/// Rejoue les commits de `head` absents de `onto` par-dessus `onto`, comme `git rebase <onto>` :
/// historique linéaire, commits de merge retirés, auteurs et dates d'origine conservés.
pub fn rebase_pull_request(repo: &Repository, onto: &str, head: &str, branch: &str) -> Result<PrRebase, GitError> {
    let onto = repo.revparse_single(onto)?.peel_to_commit()?;
    let head = repo.revparse_single(head)?.peel_to_commit()?;
    let upstream = repo.find_annotated_commit(onto.id())?;
    let tip = repo.find_annotated_commit(head.id())?;
    let merges = count_merges(repo, head.id(), onto.id())?;

    let mut opts = RebaseOptions::new();
    opts.inmemory(true);
    let mut rebase = repo.rebase(Some(&tip), Some(&upstream), None, Some(&mut opts))?;
    let committer = signature(repo)?;
    let mut new_head = onto.id();
    let (mut commits, mut skipped) = (0, merges);

    while let Some(op) = rebase.next() {
        if let Err(e) = op {
            let _ = rebase.abort();
            return Err(e.into());
        }
        let index = rebase.inmemory_index()?;
        if index.has_conflicts() {
            let mut files: Vec<String> = index
                .conflicts()?
                .filter_map(Result::ok)
                .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                .map(|entry| String::from_utf8_lossy(&entry.path).into_owned())
                .collect();
            files.dedup();
            let _ = rebase.abort();
            return Ok(PrRebase { success: false, conflicted_files: files, new_head: None, commits: 0, skipped: 0 });
        }
        match rebase.commit(None, &committer, None) {
            Ok(id) => {
                new_head = id;
                commits += 1;
            }
            // Le patch est déjà présent dans la cible : le commit deviendrait vide, on le saute.
            Err(e) if e.code() == ErrorCode::Applied => skipped += 1,
            Err(e) => {
                let _ = rebase.abort();
                return Err(e.into());
            }
        }
    }
    rebase.finish(None)?;
    repo.reference(&rebased_ref(branch), new_head, true, "merathon: rebase de la branche de PR")?;
    Ok(PrRebase { success: true, conflicted_files: vec![], new_head: Some(new_head.to_string()), commits, skipped })
}

/// Commits de merge de la branche : `git rebase` (et libgit2) ne les rejoue pas.
fn count_merges(repo: &Repository, head: Oid, onto: Oid) -> Result<usize, GitError> {
    let mut walk = repo.revwalk()?;
    walk.push(head)?;
    walk.hide(onto)?;
    let mut merges = 0;
    for id in walk {
        if repo.find_commit(id?)?.parent_count() > 1 {
            merges += 1;
        }
    }
    Ok(merges)
}

/// Oublie un rebase préparé mais pas poussé.
pub fn discard_pull_request_rebase(repo: &Repository, branch: &str) -> Result<(), GitError> {
    match repo.find_reference(&rebased_ref(branch)) {
        Ok(mut r) => Ok(r.delete()?),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Effet du force push sur la branche locale du même nom.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalBranchUpdate {
    /// Pas de branche locale de ce nom.
    Absent,
    /// Elle pointait sur l'ancienne tête : elle suit la nouvelle (et la copie de travail si elle est extraite).
    Updated,
    /// Elle contient d'autres commits : laissée telle quelle.
    Diverged,
    /// Extraite, avec des modifications locales qui empêchent de la mettre à jour.
    Dirty,
}

#[derive(Debug, Serialize, Clone)]
pub struct PrPush {
    pub new_head: String,
    pub local_branch: LocalBranchUpdate,
}

/// Pousse la branche rebasée à la place de la branche distante, seulement si celle-ci est toujours à
/// `expected` (comme `git push --force-with-lease=<branche>:<expected>`) : un push arrivé entre-temps
/// n'est jamais écrasé.
pub fn force_push_pull_request(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    expected: &str,
    creds: CredsLookup,
) -> Result<PrPush, GitError> {
    let source = rebased_ref(branch);
    let new_head = repo
        .refname_to_id(&source)
        .map_err(|_| GitError::Other("Aucun rebase préparé pour cette branche : relance le rebase".into()))?;
    let expected = Oid::from_str(expected)?;
    let target = format!("refs/heads/{branch}");

    let mut remote = repo.find_remote(remote_name)?;
    let url = remote.url().unwrap_or("").to_string();
    let stale: Cell<Option<Oid>> = Cell::new(None);
    let rejected: RefCell<Vec<String>> = RefCell::new(Vec::new());
    let mut callbacks = remote_callbacks(creds(&url));
    callbacks.push_negotiation(|updates| {
        for update in updates {
            if update.dst_refname().ok() == Some(target.as_str()) && update.src() != expected {
                stale.set(Some(update.src()));
                return Err(git2::Error::from_str("la branche distante a changé"));
            }
        }
        Ok(())
    });
    callbacks.push_update_reference(|refname, status| {
        if let Some(msg) = status {
            rejected.borrow_mut().push(format!("{refname} : {msg}"));
        }
        Ok(())
    });
    let mut opts = PushOptions::new();
    opts.remote_callbacks(callbacks);
    let pushed = remote.push(&[format!("+{source}:{target}")], Some(&mut opts));
    drop(opts);

    if let Some(current) = stale.get() {
        let current = if current.is_zero() { "supprimée".to_string() } else { format!("à {}", &current.to_string()[..7]) };
        return Err(GitError::Other(format!(
            "Push annulé : la branche distante {branch} a changé depuis le rebase (elle est maintenant {current}). \
             Actualise la PR puis relance le rebase."
        )));
    }
    pushed?;
    let rejected = rejected.into_inner();
    if !rejected.is_empty() {
        return Err(GitError::Other(format!("Push refusé par le serveur ({})", rejected.join(", "))));
    }

    repo.reference(&format!("refs/remotes/{remote_name}/{branch}"), new_head, true, "merathon: force push de la PR")?;
    discard_pull_request_rebase(repo, branch)?;
    let local_branch = update_local_branch(repo, branch, expected, new_head)?;
    Ok(PrPush { new_head: new_head.to_string(), local_branch })
}

/// Fait suivre la branche locale si elle était exactement à l'ancienne tête.
fn update_local_branch(repo: &Repository, branch: &str, old: Oid, new: Oid) -> Result<LocalBranchUpdate, GitError> {
    let Ok(local) = repo.find_branch(branch, BranchType::Local) else {
        return Ok(LocalBranchUpdate::Absent);
    };
    if local.get().target() != Some(old) {
        return Ok(LocalBranchUpdate::Diverged);
    }
    let mut reference = local.into_reference();
    if repo.head().ok().and_then(|h| h.name().ok().map(str::to_string)).as_deref() == reference.name().ok() {
        // Extraction « safe » : refusée si elle écraserait une modification locale.
        let tree = repo.find_commit(new)?.into_object();
        if repo.checkout_tree(&tree, Some(CheckoutBuilder::new().safe())).is_err() {
            return Ok(LocalBranchUpdate::Dirty);
        }
    }
    reference.set_target(new, "merathon: branche de PR rebasée")?;
    Ok(LocalBranchUpdate::Updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sig() -> git2::Signature<'static> {
        git2::Signature::now("Test", "test@test.com").unwrap()
    }

    fn init() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        {
            let tree = repo.find_tree(repo.index().unwrap().write_tree().unwrap()).unwrap();
            repo.commit(Some("refs/heads/main"), &sig(), &sig(), "initial", &tree, &[]).unwrap();
        }
        repo.set_head("refs/heads/main").unwrap();
        (dir, repo)
    }

    /// Commit de `files` sur `branch` sans passer par la copie de travail.
    fn commit_on(repo: &Repository, branch: &str, files: &[(&str, &str)], msg: &str) -> Oid {
        let refname = format!("refs/heads/{branch}");
        let parent = repo.find_reference(&refname).unwrap().peel_to_commit().unwrap();
        let mut builder = repo.treebuilder(Some(&parent.tree().unwrap())).unwrap();
        for (name, content) in files {
            builder.insert(name, repo.blob(content.as_bytes()).unwrap(), 0o100644).unwrap();
        }
        let tree = repo.find_tree(builder.write().unwrap()).unwrap();
        repo.commit(Some(&refname), &sig(), &sig(), msg, &tree, &[&parent]).unwrap()
    }

    fn branch(repo: &Repository, name: &str, from: &str) {
        let commit = repo.revparse_single(from).unwrap().peel_to_commit().unwrap();
        repo.branch(name, &commit, false).unwrap();
    }

    fn tip(repo: &Repository, name: &str) -> Oid {
        repo.revparse_single(name).unwrap().peel_to_commit().unwrap().id()
    }

    /// Premiers parents depuis `from` jusqu'à `to` : l'historique est linéaire si aucun n'a deux parents.
    fn first_parents(repo: &Repository, from: Oid, to: Oid) -> Vec<git2::Commit<'_>> {
        let mut out = vec![];
        let mut current = repo.find_commit(from).unwrap();
        while current.id() != to {
            let parent = current.parent(0).unwrap();
            out.push(current);
            current = parent;
        }
        out
    }

    #[test]
    fn divergence_counts_commits_on_each_side() {
        let (_dir, repo) = init();
        branch(&repo, "feature", "main");
        commit_on(&repo, "feature", &[("f.txt", "f")], "feature");
        commit_on(&repo, "main", &[("a.txt", "1")], "main 1");
        commit_on(&repo, "main", &[("b.txt", "2")], "main 2");
        let d = branch_divergence(&repo, "main", "feature").unwrap();
        assert_eq!((d.ahead, d.behind), (1, 2));
        assert_eq!(d.head, tip(&repo, "feature").to_string());
    }

    #[test]
    fn rebase_is_linear_and_leaves_workdir_and_branches_alone() {
        let (dir, repo) = init();
        branch(&repo, "feature", "main");
        commit_on(&repo, "feature", &[("f1.txt", "1")], "feature 1");
        let old_head = commit_on(&repo, "feature", &[("f2.txt", "2")], "feature 2");
        let main_tip = commit_on(&repo, "main", &[("m.txt", "m")], "main");
        std::fs::write(dir.path().join("wip.txt"), "en cours").unwrap();

        let result = rebase_pull_request(&repo, "main", "feature", "feature").unwrap();
        assert!(result.success);
        assert_eq!((result.commits, result.skipped), (2, 0));

        let new_head = Oid::from_str(result.new_head.as_ref().unwrap()).unwrap();
        let rebased = first_parents(&repo, new_head, main_tip);
        assert_eq!(rebased.iter().map(|c| c.summary().unwrap().unwrap().to_string()).collect::<Vec<_>>(), ["feature 2", "feature 1"]);
        assert!(rebased.iter().all(|c| c.parent_count() == 1));
        assert_eq!(repo.refname_to_id("refs/merathon/rebased/feature").unwrap(), new_head);

        // Rien d'autre n'a bougé : branche, HEAD, fichier non suivi, état du dépôt.
        assert_eq!(tip(&repo, "feature"), old_head);
        assert_eq!(repo.head().unwrap().name().unwrap(), "refs/heads/main");
        assert!(dir.path().join("wip.txt").exists());
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn rebase_conflict_reports_files_and_changes_nothing() {
        let (_dir, repo) = init();
        commit_on(&repo, "main", &[("a.txt", "base")], "base");
        branch(&repo, "feature", "main");
        commit_on(&repo, "feature", &[("a.txt", "version de la branche")], "feature");
        commit_on(&repo, "main", &[("a.txt", "version de main")], "main");

        let result = rebase_pull_request(&repo, "main", "feature", "feature").unwrap();
        assert!(!result.success);
        assert_eq!(result.conflicted_files, ["a.txt"]);
        assert!(repo.find_reference("refs/merathon/rebased/feature").is_err());
        assert_eq!(repo.state(), git2::RepositoryState::Clean);
    }

    #[test]
    fn rebase_drops_merge_commits_and_already_applied_changes() {
        let (_dir, repo) = init();
        branch(&repo, "feature", "main");
        commit_on(&repo, "feature", &[("f.txt", "f")], "feature");
        // La cible a reçu, en plus, le même changement que la branche (cherry-pick) et un autre commit.
        commit_on(&repo, "main", &[("f.txt", "f")], "même changement");
        let m = commit_on(&repo, "main", &[("m.txt", "m")], "main");
        // Merge de main dans la branche, comme le bouton « Mettre à jour la branche » de GitHub.
        let ours = repo.find_commit(tip(&repo, "feature")).unwrap();
        let theirs = repo.find_commit(m).unwrap();
        let mut index = repo.merge_commits(&ours, &theirs, None).unwrap();
        let tree = repo.find_tree(index.write_tree_to(&repo).unwrap()).unwrap();
        repo.commit(Some("refs/heads/feature"), &sig(), &sig(), "Merge main", &tree, &[&ours, &theirs]).unwrap();
        commit_on(&repo, "feature", &[("g.txt", "g")], "après le merge");

        let result = rebase_pull_request(&repo, "main", "feature", "feature").unwrap();
        assert!(result.success);
        assert_eq!((result.commits, result.skipped), (1, 2));
        let new_head = Oid::from_str(result.new_head.as_ref().unwrap()).unwrap();
        let rebased = first_parents(&repo, new_head, m);
        assert_eq!(rebased.len(), 1);
        assert_eq!(rebased[0].summary().unwrap(), Some("après le merge"));
        // Le contenu final est le même que celui de la branche d'origine.
        assert_eq!(repo.find_commit(new_head).unwrap().tree_id(), repo.find_commit(tip(&repo, "feature")).unwrap().tree_id());
    }

    /// Dépôt local + « serveur » bare, avec main et feature poussées.
    fn with_remote() -> (TempDir, Repository, TempDir, Repository) {
        let (dir, repo) = init();
        let server_dir = TempDir::new().unwrap();
        let server = Repository::init_bare(server_dir.path()).unwrap();
        repo.remote("origin", server_dir.path().to_str().unwrap()).unwrap();
        branch(&repo, "feature", "main");
        commit_on(&repo, "feature", &[("f.txt", "f")], "feature");
        commit_on(&repo, "main", &[("m.txt", "m")], "main");
        repo.find_remote("origin")
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main", "refs/heads/feature:refs/heads/feature"], None)
            .unwrap();
        for b in ["main", "feature"] {
            repo.reference(&format!("refs/remotes/origin/{b}"), tip(&repo, b), true, "test").unwrap();
        }
        (dir, repo, server_dir, server)
    }

    #[test]
    fn force_push_replaces_the_remote_branch_and_follows_locally() {
        let (_dir, repo, _server_dir, server) = with_remote();
        let old = tip(&repo, "origin/feature");
        let rebased = rebase_pull_request(&repo, "origin/main", "origin/feature", "feature").unwrap();
        let new_head = Oid::from_str(rebased.new_head.as_ref().unwrap()).unwrap();

        let pushed = force_push_pull_request(&repo, "origin", "feature", &old.to_string(), &|_: &str| None).unwrap();
        assert_eq!(pushed.new_head, new_head.to_string());
        assert_eq!(server.refname_to_id("refs/heads/feature").unwrap(), new_head);
        assert_eq!(tip(&repo, "origin/feature"), new_head);
        // La branche locale (non extraite) était à l'ancienne tête : elle suit.
        assert_eq!(pushed.local_branch, LocalBranchUpdate::Updated);
        assert_eq!(tip(&repo, "refs/heads/feature"), new_head);
        assert!(repo.find_reference("refs/merathon/rebased/feature").is_err());
        assert_eq!(branch_divergence(&repo, "origin/main", "origin/feature").unwrap().behind, 0);
    }

    #[test]
    fn force_push_is_refused_when_the_remote_branch_moved() {
        let (_dir, repo, _server_dir, server) = with_remote();
        let old = tip(&repo, "origin/feature");
        rebase_pull_request(&repo, "origin/main", "origin/feature", "feature").unwrap();

        // Quelqu'un pousse sur la branche entre le rebase et le force push.
        let other = commit_on(&repo, "feature", &[("autre.txt", "x")], "push d'un collègue");
        repo.find_remote("origin").unwrap().push(&["refs/heads/feature:refs/heads/feature"], None).unwrap();

        let err = force_push_pull_request(&repo, "origin", "feature", &old.to_string(), &|_: &str| None).unwrap_err();
        assert!(err.to_string().contains("a changé depuis le rebase"), "{err}");
        assert_eq!(server.refname_to_id("refs/heads/feature").unwrap(), other);
    }

    #[test]
    fn force_push_leaves_a_diverged_local_branch_alone() {
        let (_dir, repo, _server_dir, _server) = with_remote();
        let old = tip(&repo, "origin/feature");
        rebase_pull_request(&repo, "origin/main", "origin/feature", "feature").unwrap();
        let local = commit_on(&repo, "feature", &[("local.txt", "pas encore poussé")], "local");

        let pushed = force_push_pull_request(&repo, "origin", "feature", &old.to_string(), &|_: &str| None).unwrap();
        assert_eq!(pushed.local_branch, LocalBranchUpdate::Diverged);
        assert_eq!(tip(&repo, "refs/heads/feature"), local);
    }

    /// Extrait la branche feature dans la copie de travail.
    fn checkout_feature(repo: &Repository) {
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force())).unwrap();
    }

    #[test]
    fn force_push_updates_the_checked_out_branch_and_its_files() {
        let (dir, repo, _server_dir, _server) = with_remote();
        checkout_feature(&repo);
        let old = tip(&repo, "origin/feature");
        rebase_pull_request(&repo, "origin/main", "origin/feature", "feature").unwrap();

        let pushed = force_push_pull_request(&repo, "origin", "feature", &old.to_string(), &|_: &str| None).unwrap();
        assert_eq!(pushed.local_branch, LocalBranchUpdate::Updated);
        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), pushed.new_head);
        // Le fichier arrivé de main est là, et rien n'apparaît comme modifié.
        assert!(dir.path().join("m.txt").exists());
        assert!(repo.statuses(None).unwrap().is_empty());
    }

    #[test]
    fn force_push_keeps_a_checked_out_branch_whose_files_would_be_overwritten() {
        let (dir, repo, server_dir, _server) = with_remote();
        checkout_feature(&repo);
        // Fichier non suivi qui porte le nom d'un fichier apporté par main.
        std::fs::write(dir.path().join("m.txt"), "brouillon local").unwrap();
        let old = tip(&repo, "origin/feature");
        rebase_pull_request(&repo, "origin/main", "origin/feature", "feature").unwrap();

        let pushed = force_push_pull_request(&repo, "origin", "feature", &old.to_string(), &|_: &str| None).unwrap();
        assert_eq!(pushed.local_branch, LocalBranchUpdate::Dirty);
        assert_eq!(tip(&repo, "refs/heads/feature"), old);
        assert_eq!(std::fs::read_to_string(dir.path().join("m.txt")).unwrap(), "brouillon local");
        // Le push, lui, a bien eu lieu.
        let server = Repository::open_bare(server_dir.path()).unwrap();
        assert_eq!(server.refname_to_id("refs/heads/feature").unwrap().to_string(), pushed.new_head);
    }
}
