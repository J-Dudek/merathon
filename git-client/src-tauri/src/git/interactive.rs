//! Rebase interactif : réordonner, renommer, fusionner (squash / fixup), modifier (edit) ou
//! supprimer des commits, y compris dans un historique contenant des merges.
//!
//! Deux modes, comme git :
//! - `Linear` (`git rebase -i`) : les commits de merge sont ignorés et les commits des branches
//!   fusionnées sont rejoués à la suite, dans l'ordre choisi ;
//! - `Preserve` (`git rebase -i --rebase-merges`) : la forme de l'historique est conservée (ordre
//!   fixe) ; chaque commit est rejoué sur ses parents réécrits et les merges sont recréés.
//!
//! Les étapes sans conflit sont calculées en mémoire : la copie de travail n'est touchée qu'à la
//! fin. Le rebase s'arrête sur un conflit (à résoudre puis `continue_interactive`) ou sur une étape
//! `edit` (commit à modifier). La branche ne bouge qu'à la fin ; `abort_interactive` revient
//! exactement à l'état initial. L'état d'un rebase arrêté est dans `.git/gitclient-rebase.json`.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use git2::{
    build::CheckoutBuilder, CherrypickOptions, Commit, Index, Oid, Repository, RepositoryState, ResetType, Sort,
    Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use super::error::GitError;
use super::merge::conflicted_paths;
use super::repository::signature;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RebaseMode {
    /// Historique aplati : les merges disparaissent, l'ordre est libre.
    #[default]
    Linear,
    /// Merges conservés : ordre fixe, chaque commit garde ses parents (réécrits).
    Preserve,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RebaseStep {
    pub hash: String,
    pub action: RebaseAction,
    /// Nouveau message pour `reword` (obligatoire) et `squash` (optionnel).
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TodoCommit {
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub is_merge: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StopReason {
    Conflict,
    Edit,
}

/// Rebase interactif arrêté, tel qu'affiché à l'utilisateur.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct InteractiveStop {
    pub reason: StopReason,
    pub hash: String,
    pub short_hash: String,
    pub summary: String,
    /// Numéro de l'étape (à partir de 1) parmi les commits conservés.
    pub step: usize,
    pub total: usize,
    pub conflicted_files: Vec<String>,
}

/// Résultat d'un lancement ou d'une reprise : `stopped` est rempli si le rebase s'est arrêté.
#[derive(Debug, Serialize, Clone)]
pub struct InteractiveOutcome {
    pub done: bool,
    pub stopped: Option<InteractiveStop>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SavedRebase {
    base: String,
    orig_head: String,
    /// Branche réécrite ; None si HEAD était détaché.
    branch_ref: Option<String>,
    #[serde(default)]
    mode: RebaseMode,
    steps: Vec<RebaseStep>,
    /// Prochaine étape à exécuter.
    next: usize,
    /// Dernier commit produit (ou la base) : point d'appui du mode linéaire.
    tip: String,
    /// Ancien commit → commit qui le remplace (réécrit, fusionné, ou parent s'il est supprimé).
    #[serde(default)]
    mapping: HashMap<String, String>,
    stopped: Option<(usize, StopReason)>,
}

impl SavedRebase {
    fn mapped(&self, oid: Oid) -> Result<Oid, GitError> {
        match self.mapping.get(&oid.to_string()) {
            Some(new) => Ok(Oid::from_str(new)?),
            None => Ok(oid),
        }
    }
}

/// Comment l'arbre d'une étape est obtenu.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Replay {
    /// Commit ordinaire : ses changements appliqués sur le nouveau parent.
    Pick,
    /// Merge dont les branches fusionnées n'ont pas changé : on rejoue le merge comme un diff par
    /// rapport à son premier parent, ce qui conserve les résolutions de conflits d'origine.
    MergeAsDiff,
    /// Merge dont une branche fusionnée a changé : le merge est refait.
    Remerge,
}

/// Ce qu'une étape va produire : parents du nouveau commit et base d'application.
struct Planned<'r> {
    parents: Vec<Commit<'r>>,
    /// Commit sur lequel les changements sont appliqués (copie de travail en cas de conflit).
    onto: Commit<'r>,
    /// Pour squash / fixup : le commit dans lequel on fusionne.
    squash_target: Option<Commit<'r>>,
    replay: Replay,
}

fn state_path(repo: &Repository) -> PathBuf {
    repo.path().join("gitclient-rebase.json")
}

fn load_state(repo: &Repository) -> Option<SavedRebase> {
    let raw = std::fs::read_to_string(state_path(repo)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_state(repo: &Repository, state: &SavedRebase) -> Result<(), GitError> {
    let raw = serde_json::to_string_pretty(state).map_err(|e| GitError::Other(e.to_string()))?;
    std::fs::write(state_path(repo), raw)?;
    Ok(())
}

fn clear_state(repo: &Repository) {
    let _ = std::fs::remove_file(state_path(repo));
}

fn short(hash: &str) -> &str {
    &hash[..hash.len().min(7)]
}

/// Commits de `base` (exclu) à HEAD, parents avant enfants, merges compris.
pub fn rebase_todo(repo: &Repository, base: &str) -> Result<Vec<TodoCommit>, GitError> {
    let head = repo.head()?.peel_to_commit()?;
    let base = repo.revparse_single(base)?.peel_to_commit()?;
    if head.id() != base.id() && !repo.graph_descendant_of(head.id(), base.id())? {
        return Err(GitError::Other("Le commit choisi n'est pas un ancêtre de HEAD".into()));
    }

    let mut walk = repo.revwalk()?;
    walk.push(head.id())?;
    walk.hide(base.id())?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)?;

    let mut todo = Vec::new();
    for oid in walk {
        let commit = repo.find_commit(oid?)?;
        let hash = commit.id().to_string();
        todo.push(TodoCommit {
            short_hash: short(&hash).to_string(),
            summary: commit.summary().ok().flatten().unwrap_or("").to_string(),
            message: commit.message().unwrap_or("").trim_end().to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parents: commit.parent_ids().map(|p| p.to_string()).collect(),
            is_merge: commit.parent_count() > 1,
            hash,
        });
    }
    Ok(todo)
}

/// Aucune modification des fichiers suivis (les fichiers non suivis sont tolérés).
fn workdir_is_clean(repo: &Repository) -> Result<bool, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false);
    Ok(!repo
        .statuses(Some(&mut opts))?
        .iter()
        .any(|e| !e.status().is_empty() && e.status() != Status::IGNORED))
}

fn ensure_can_start(repo: &Repository) -> Result<(), GitError> {
    if load_state(repo).is_some() {
        return Err(GitError::Other("Un rebase interactif est déjà en cours : continue-le ou annule-le".into()));
    }
    if repo.state() != RepositoryState::Clean {
        return Err(GitError::Other("Une opération (merge, rebase…) est déjà en cours".into()));
    }
    if !workdir_is_clean(repo)? {
        return Err(GitError::Other(
            "Des modifications ne sont pas commitées : commite-les ou mets-les de côté (stash) avant le rebase interactif".into(),
        ));
    }
    Ok(())
}

fn err(msg: String) -> GitError {
    GitError::Other(msg)
}

/// Vérifie le plan avant de toucher à quoi que ce soit.
fn validate(todo: &[TodoCommit], steps: &[RebaseStep], mode: RebaseMode) -> Result<(), GitError> {
    let by_hash: HashMap<&str, &TodoCommit> = todo.iter().map(|c| (c.hash.as_str(), c)).collect();
    let mut seen = HashSet::new();
    for step in steps {
        let Some(commit) = by_hash.get(step.hash.as_str()) else {
            return Err(err(format!("Étape invalide pour le commit {}", short(&step.hash))));
        };
        if !seen.insert(step.hash.as_str()) {
            return Err(err(format!("Le commit {} apparaît deux fois", short(&step.hash))));
        }
        if commit.is_merge && mode == RebaseMode::Linear {
            return Err(err(format!(
                "{} est un merge : en mode linéaire les merges sont aplatis, choisis « Préserver les merges » pour le garder",
                short(&step.hash)
            )));
        }
        if commit.is_merge && matches!(step.action, RebaseAction::Squash | RebaseAction::Fixup) {
            return Err(err(format!("{} : un merge ne peut pas être fusionné dans un autre commit", short(&step.hash))));
        }
        if step.action == RebaseAction::Reword && step.message.as_deref().is_none_or(|m| m.trim().is_empty()) {
            return Err(err(format!("{} : nouveau message manquant", short(&step.hash))));
        }
    }

    let kept: Vec<&RebaseStep> = steps.iter().filter(|s| s.action != RebaseAction::Drop).collect();
    match mode {
        RebaseMode::Linear => {
            if let Some(first) = kept.first() {
                if matches!(first.action, RebaseAction::Squash | RebaseAction::Fixup) {
                    return Err(err(format!(
                        "{} : squash / fixup impossible sur le premier commit (il n'y a pas de commit précédent)",
                        short(&first.hash)
                    )));
                }
            }
        }
        RebaseMode::Preserve => {
            // L'ordre est celui de l'historique : on ne peut que choisir les actions.
            let position: HashMap<&str, usize> = todo.iter().enumerate().map(|(i, c)| (c.hash.as_str(), i)).collect();
            if steps.windows(2).any(|w| position[w[0].hash.as_str()] > position[w[1].hash.as_str()]) {
                return Err(err("En préservant les merges, l'ordre des commits ne peut pas changer".into()));
            }
            let dropped: HashSet<&str> = steps
                .iter()
                .filter(|s| s.action == RebaseAction::Drop)
                .map(|s| s.hash.as_str())
                .chain(todo.iter().map(|c| c.hash.as_str()).filter(|h| !seen.contains(h)))
                .collect();
            for step in steps.iter().filter(|s| matches!(s.action, RebaseAction::Squash | RebaseAction::Fixup)) {
                let commit = by_hash[step.hash.as_str()];
                let parent = commit.parents.first().and_then(|p| by_hash.get(p.as_str()));
                let ok = parent.is_some_and(|p| {
                    !p.is_merge
                        && !dropped.contains(p.hash.as_str())
                        // Le parent ne doit pas être aussi le point de départ d'une autre branche.
                        && todo.iter().filter(|c| c.parents.contains(&p.hash)).count() == 1
                });
                if !ok {
                    return Err(err(format!(
                        "{} : en préservant les merges, un squash / fixup doit suivre directement un commit ordinaire conservé de la même branche",
                        short(&step.hash)
                    )));
                }
            }
        }
    }
    Ok(())
}

/// Démarre un rebase interactif sur `base` selon `steps` (les commits absents sont supprimés).
pub fn interactive_rebase(
    repo: &Repository,
    base: &str,
    steps: &[RebaseStep],
    mode: RebaseMode,
) -> Result<InteractiveOutcome, GitError> {
    ensure_can_start(repo)?;
    let todo = rebase_todo(repo, base)?;
    validate(&todo, steps, mode)?;

    // En mode linéaire, les merges ne sont pas rejoués : seuls les commits ordinaires comptent.
    let mut steps = steps.to_vec();
    if mode == RebaseMode::Preserve {
        // Les commits absents du plan sont supprimés explicitement, à leur place dans l'historique.
        let listed: HashSet<String> = steps.iter().map(|s| s.hash.clone()).collect();
        let mut full = Vec::new();
        let mut it = steps.into_iter().peekable();
        for c in &todo {
            if listed.contains(&c.hash) {
                full.push(it.next().expect("ordre vérifié"));
            } else {
                full.push(RebaseStep { hash: c.hash.clone(), action: RebaseAction::Drop, message: None });
            }
        }
        steps = full;
    }

    let head = repo.head()?;
    let base_id = repo.revparse_single(base)?.peel_to_commit()?.id().to_string();
    let state = SavedRebase {
        base: base_id.clone(),
        orig_head: head.peel_to_commit()?.id().to_string(),
        branch_ref: if repo.head_detached()? { None } else { head.name().ok().map(str::to_string) },
        mode,
        steps,
        next: 0,
        tip: base_id,
        mapping: HashMap::new(),
        stopped: None,
    };
    run(repo, state)
}

/// Détermine les parents et la manière de rejouer une étape (sans rien écrire).
fn plan_step<'r>(repo: &'r Repository, state: &SavedRebase, step: &RebaseStep, original: &Commit) -> Result<Planned<'r>, GitError> {
    if matches!(step.action, RebaseAction::Squash | RebaseAction::Fixup) {
        let target_id = match state.mode {
            RebaseMode::Linear => Oid::from_str(&state.tip)?,
            RebaseMode::Preserve => state.mapped(original.parent_id(0)?)?,
        };
        let target = repo.find_commit(target_id)?;
        return Ok(Planned {
            parents: vec![target.parent(0)?],
            onto: target.clone(),
            squash_target: Some(target),
            replay: Replay::Pick,
        });
    }

    if state.mode == RebaseMode::Linear {
        let tip = repo.find_commit(Oid::from_str(&state.tip)?)?;
        return Ok(Planned { parents: vec![tip.clone()], onto: tip, squash_target: None, replay: Replay::Pick });
    }

    // Mode préservé : chaque parent est remplacé par sa version réécrite.
    let mut parents: Vec<Commit> = Vec::new();
    for pid in original.parent_ids() {
        let mapped = repo.find_commit(state.mapped(pid)?)?;
        // Un parent devenu ancêtre d'un autre (branche supprimée) est redondant.
        let redundant = parents
            .iter()
            .any(|p| p.id() == mapped.id() || repo.graph_descendant_of(p.id(), mapped.id()).unwrap_or(false));
        if !redundant {
            parents.retain(|p| !repo.graph_descendant_of(mapped.id(), p.id()).unwrap_or(false));
            parents.push(mapped);
        }
    }
    let onto = parents[0].clone();
    let replay = if original.parent_count() < 2 || parents.len() < 2 {
        Replay::Pick
    } else {
        // Les branches fusionnées ont-elles le même contenu qu'avant ?
        let sides_unchanged = original
            .parent_ids()
            .skip(1)
            .zip(parents.iter().skip(1))
            .all(|(old, new)| {
                repo.find_commit(old).and_then(|c| c.tree()).map(|t| t.id()).ok() == new.tree().map(|t| t.id()).ok()
            });
        if sides_unchanged && original.parent_count() == parents.len() {
            Replay::MergeAsDiff
        } else {
            Replay::Remerge
        }
    };
    Ok(Planned { parents, onto, squash_target: None, replay })
}

/// Calcule en mémoire l'index résultant d'une étape.
fn replay_in_memory(repo: &Repository, original: &Commit, planned: &Planned) -> Result<Index, GitError> {
    match planned.replay {
        Replay::Pick => Ok(repo.cherrypick_commit(original, &planned.onto, 0, None)?),
        Replay::MergeAsDiff => Ok(repo.cherrypick_commit(original, &planned.onto, 1, None)?),
        Replay::Remerge => {
            if planned.parents.len() != 2 {
                return Err(err(format!("{} : les merges à plus de deux parents ne sont pas pris en charge", short(&original.id().to_string()))));
            }
            Ok(repo.merge_commits(&planned.parents[0], &planned.parents[1], None)?)
        }
    }
}

/// Rejoue l'étape dans la copie de travail (pour présenter les conflits à l'utilisateur).
fn replay_in_workdir(repo: &Repository, original: &Commit, planned: &Planned) -> Result<(), GitError> {
    materialize(repo, &planned.onto)?;
    match planned.replay {
        Replay::Remerge => {
            let other = repo.find_annotated_commit(planned.parents[1].id())?;
            repo.merge(&[&other], None, None)?;
        }
        _ => {
            let mut opts = CherrypickOptions::new();
            if original.parent_count() > 1 {
                opts.mainline(1);
            }
            repo.cherrypick(original, Some(&mut opts))?;
        }
    }
    Ok(())
}

/// Crée le commit d'une étape à partir de l'arbre `tree`.
fn commit_step<'r>(
    repo: &'r Repository,
    step: &RebaseStep,
    original: &Commit,
    planned: &Planned,
    tree: &git2::Tree,
) -> Result<Commit<'r>, GitError> {
    let sig = signature(repo)?;
    let parent_refs: Vec<&Commit> = planned.parents.iter().collect();
    let id = match &planned.squash_target {
        Some(target) => {
            let message = match (step.action, step.message.as_deref().map(str::trim)) {
                (RebaseAction::Squash, Some(m)) if !m.is_empty() => m.to_string(),
                (RebaseAction::Squash, _) => format!(
                    "{}\n\n{}",
                    target.message().unwrap_or("").trim_end(),
                    original.message().unwrap_or("").trim_end()
                ),
                _ => target.message().unwrap_or("").to_string(),
            };
            repo.commit(None, &target.author(), &sig, &message, tree, &parent_refs)?
        }
        None => {
            let message = match step.action {
                RebaseAction::Reword => step.message.clone().unwrap_or_default().trim().to_string(),
                _ => original.message().unwrap_or("").to_string(),
            };
            repo.commit(None, &original.author(), &sig, &message, tree, &parent_refs)?
        }
    };
    Ok(repo.find_commit(id)?)
}

/// Enregistre le commit produit par une étape.
fn record(state: &mut SavedRebase, original: &Commit, planned: &Planned, produced: &Commit) -> Result<(), GitError> {
    let new = produced.id().to_string();
    if planned.squash_target.is_some() && state.mode == RebaseMode::Preserve {
        // Le commit fusionné remplace aussi celui dans lequel on a fusionné.
        state.mapping.insert(original.parent_id(0)?.to_string(), new.clone());
    }
    state.mapping.insert(original.id().to_string(), new.clone());
    state.tip = new;
    Ok(())
}

/// Commit ordinaire devenu vide une fois rejoué (ses changements sont déjà présents) : comme git,
/// on le saute. Un commit vide dès l'origine est conservé.
fn becomes_empty(original: &Commit, planned: &Planned, tree: &git2::Tree) -> Result<bool, GitError> {
    Ok(planned.squash_target.is_none()
        && planned.replay == Replay::Pick
        && original.parent_count() == 1
        && tree.id() == planned.onto.tree_id()
        && original.tree_id() != original.parent(0)?.tree_id())
}

/// Saute une étape : le commit est remplacé par celui sur lequel il aurait été appliqué.
fn skip(state: &mut SavedRebase, original: &Commit, planned: &Planned) {
    let onto = planned.onto.id().to_string();
    state.mapping.insert(original.id().to_string(), onto.clone());
    state.tip = onto;
}

/// Place la copie de travail et HEAD (détaché) sur `commit`.
fn materialize(repo: &Repository, commit: &Commit) -> Result<(), GitError> {
    repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::default().safe()))?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}

fn stop_info(repo: &Repository, state: &SavedRebase) -> Result<Option<InteractiveStop>, GitError> {
    let Some((index, reason)) = state.stopped else { return Ok(None) };
    let kept: Vec<&RebaseStep> = state.steps.iter().filter(|s| s.action != RebaseAction::Drop).collect();
    let step = &state.steps[index];
    let commit = repo.find_commit(Oid::from_str(&step.hash)?)?;
    Ok(Some(InteractiveStop {
        reason,
        short_hash: short(&step.hash).to_string(),
        hash: step.hash.clone(),
        summary: commit.summary().ok().flatten().unwrap_or("").to_string(),
        step: kept.iter().position(|s| s.hash == step.hash).map(|p| p + 1).unwrap_or(0),
        total: kept.len(),
        conflicted_files: if reason == StopReason::Conflict { conflicted_paths(repo)? } else { Vec::new() },
    }))
}

/// Rebase interactif arrêté en attente de l'utilisateur, s'il y en a un.
pub fn interactive_status(repo: &Repository) -> Option<InteractiveStop> {
    load_state(repo).and_then(|s| stop_info(repo, &s).ok().flatten())
}

fn stop(repo: &Repository, state: &mut SavedRebase, index: usize, reason: StopReason) -> Result<InteractiveOutcome, GitError> {
    state.stopped = Some((index, reason));
    save_state(repo, state)?;
    Ok(InteractiveOutcome { done: false, stopped: stop_info(repo, state)? })
}

fn run(repo: &Repository, mut state: SavedRebase) -> Result<InteractiveOutcome, GitError> {
    while state.next < state.steps.len() {
        let index = state.next;
        let step = state.steps[index].clone();
        let original = repo.find_commit(Oid::from_str(&step.hash)?)?;

        if step.action == RebaseAction::Drop {
            if state.mode == RebaseMode::Preserve {
                // Les enfants d'un commit supprimé se rattachent à son premier parent.
                let parent = state.mapped(original.parent_id(0)?)?;
                state.mapping.insert(step.hash.clone(), parent.to_string());
            }
            state.next += 1;
            continue;
        }

        let planned = plan_step(repo, &state, &step, &original)?;
        let parents_unchanged = planned.squash_target.is_none()
            && planned.parents.iter().map(|p| p.id()).eq(original.parent_ids());

        let produced = if matches!(step.action, RebaseAction::Pick | RebaseAction::Edit) && parents_unchanged {
            // Commit inchangé et déjà à sa place : on le garde tel quel (même hash).
            original.clone()
        } else if original.parent_count() > 1 && planned.parents.len() < 2 {
            // Merge dont la branche fusionnée a été supprimée : il n'a plus de raison d'être
            // (le rejouer réintroduirait le contenu des commits supprimés).
            state.mapping.insert(step.hash.clone(), planned.onto.id().to_string());
            state.tip = planned.onto.id().to_string();
            state.next = index + 1;
            continue;
        } else {
            let mut index_mem = replay_in_memory(repo, &original, &planned)?;
            if index_mem.has_conflicts() {
                replay_in_workdir(repo, &original, &planned)?;
                return stop(repo, &mut state, index, StopReason::Conflict);
            }
            let tree = repo.find_tree(index_mem.write_tree_to(repo)?)?;
            if becomes_empty(&original, &planned, &tree)? {
                skip(&mut state, &original, &planned);
                state.next = index + 1;
                continue;
            }
            commit_step(repo, &step, &original, &planned, &tree)?
        };

        record(&mut state, &original, &planned, &produced)?;
        state.next = index + 1;

        if step.action == RebaseAction::Edit {
            materialize(repo, &produced)?;
            return stop(repo, &mut state, index, StopReason::Edit);
        }
    }
    finish(repo, &state)?;
    Ok(InteractiveOutcome { done: true, stopped: None })
}

fn finish(repo: &Repository, state: &SavedRebase) -> Result<(), GitError> {
    let final_id = match state.mode {
        RebaseMode::Linear => Oid::from_str(&state.tip)?,
        RebaseMode::Preserve => state.mapped(Oid::from_str(&state.orig_head)?)?,
    };
    let tip = repo.find_commit(final_id)?;
    repo.checkout_tree(tip.as_object(), Some(CheckoutBuilder::default().safe()))?;
    match &state.branch_ref {
        Some(name) => {
            repo.find_reference(name)?.set_target(tip.id(), "rebase interactif")?;
            repo.set_head(name)?;
        }
        None => repo.set_head_detached(tip.id())?,
    }
    // Permet de revenir en arrière avec `git reset --hard ORIG_HEAD`.
    repo.reference("ORIG_HEAD", Oid::from_str(&state.orig_head)?, true, "rebase interactif")?;
    clear_state(repo);
    Ok(())
}

/// Reprend un rebase interactif arrêté (conflits résolus, ou commit modifié).
pub fn continue_interactive(repo: &Repository) -> Result<InteractiveOutcome, GitError> {
    let mut state = load_state(repo).ok_or_else(|| err("Aucun rebase interactif en cours".into()))?;
    let (index, reason) = state.stopped.ok_or_else(|| err("Le rebase n'est pas arrêté".into()))?;
    let step = state.steps[index].clone();
    let original = repo.find_commit(Oid::from_str(&step.hash)?)?;

    match reason {
        StopReason::Conflict => {
            if !conflicted_paths(repo)?.is_empty() {
                return Err(GitError::Conflict("Résous tous les conflits avant de continuer".into()));
            }
            let planned = plan_step(repo, &state, &step, &original)?;
            let in_progress = matches!(
                repo.state(),
                RepositoryState::CherryPick | RepositoryState::CherryPickSequence | RepositoryState::Merge
            );
            if in_progress {
                // Les conflits résolus sont dans l'index : on crée le commit de l'étape.
                let tree = repo.find_tree(repo.index()?.write_tree()?)?;
                if becomes_empty(&original, &planned, &tree)? {
                    // Conflit résolu en gardant la version existante : plus rien à appliquer.
                    repo.cleanup_state()?;
                    skip(&mut state, &original, &planned);
                    state.next = index + 1;
                } else {
                    let produced = commit_step(repo, &step, &original, &planned, &tree)?;
                    repo.cleanup_state()?;
                    repo.set_head_detached(produced.id())?;
                    record(&mut state, &original, &planned, &produced)?;
                    state.next = index + 1;
                    if step.action == RebaseAction::Edit {
                        return stop(repo, &mut state, index, StopReason::Edit);
                    }
                }
            } else {
                // L'utilisateur a commité lui-même : on repart de HEAD.
                let head = repo.head()?.peel_to_commit()?;
                let produced = match &planned.squash_target {
                    // Squash : son commit, créé au-dessus du commit cible, est fusionné dedans.
                    Some(target) if head.parent_count() == 1 && head.parent_id(0)? == target.id() => {
                        let produced = commit_step(repo, &step, &original, &planned, &head.tree()?)?;
                        repo.set_head_detached(produced.id())?;
                        produced
                    }
                    _ => head,
                };
                record(&mut state, &original, &planned, &produced)?;
                state.next = index + 1;
            }
        }
        StopReason::Edit => {
            if !workdir_is_clean(repo)? {
                return Err(err(
                    "Des modifications ne sont pas commitées : commite-les (ou amend) avant de continuer".into(),
                ));
            }
            // Le commit a pu être modifié (amend) ou complété : on repart de HEAD.
            let head = repo.head()?.peel_to_commit()?.id().to_string();
            state.mapping.insert(step.hash.clone(), head.clone());
            state.tip = head;
        }
    }
    state.stopped = None;
    // Pas de sauvegarde ici : en cas d'erreur, l'arrêt précédent reste enregistré
    // (on peut réessayer ou annuler). `run` sauvegarde au prochain arrêt ou nettoie à la fin.
    run(repo, state)
}

/// Abandonne le rebase interactif et restaure la branche et la copie de travail d'origine.
pub fn abort_interactive(repo: &Repository) -> Result<(), GitError> {
    let state = load_state(repo).ok_or_else(|| err("Aucun rebase interactif en cours".into()))?;
    let orig = repo.find_commit(Oid::from_str(&state.orig_head)?)?;
    repo.cleanup_state()?;
    match &state.branch_ref {
        // La branche n'a pas bougé pendant le rebase : elle pointe toujours sur orig_head.
        Some(name) => repo.set_head(name)?,
        None => repo.set_head_detached(orig.id())?,
    }
    repo.reset(orig.as_object(), ResetType::Hard, None)?;
    clear_state(repo);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    struct Fixture {
        dir: TempDir,
        repo: Repository,
        base: String,
        c: Vec<String>,
    }

    fn commit_file(repo: &Repository, dir: &TempDir, file: &str, content: &str, msg: &str) -> String {
        fs::write(dir.path().join(file), content).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parents: Vec<Commit> = repo.head().ok().and_then(|h| h.peel_to_commit().ok()).into_iter().collect();
        let refs: Vec<&Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &refs).unwrap().to_string()
    }

    fn new_repo() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "test@test.com").unwrap();
        // Fins de ligne LF même si le git du système a core.autocrlf=true (runners Windows)
        cfg.set_bool("core.autocrlf", false).unwrap();
        (dir, repo)
    }

    /// base → c1 (a.txt) → c2 (b.txt) → c3 (c.txt)
    fn fixture() -> Fixture {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "base.txt", "base\n", "base");
        let c = vec![
            commit_file(&repo, &dir, "a.txt", "a\n", "c1"),
            commit_file(&repo, &dir, "b.txt", "b\n", "c2"),
            commit_file(&repo, &dir, "c.txt", "c\n", "c3"),
        ];
        Fixture { dir, repo, base, c }
    }

    /// base (f = v0) → c1 (f = v1) → c2 (f = v2) : inverser c1 et c2 provoque un conflit.
    fn conflicting() -> (TempDir, Repository, String, String, String) {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "f.txt", "v0\n", "base");
        let c1 = commit_file(&repo, &dir, "f.txt", "v1\n", "c1");
        let c2 = commit_file(&repo, &dir, "f.txt", "v2\n", "c2");
        (dir, repo, base, c1, c2)
    }

    fn step(hash: &str, action: RebaseAction, message: Option<&str>) -> RebaseStep {
        RebaseStep { hash: hash.into(), action, message: message.map(str::to_string) }
    }

    fn head(repo: &Repository) -> Commit<'_> {
        repo.head().unwrap().peel_to_commit().unwrap()
    }

    fn resolve(repo: &Repository, dir: &TempDir, file: &str, content: &str) {
        fs::write(dir.path().join(file), content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(file)).unwrap();
        index.write().unwrap();
    }

    #[test]
    fn todo_lists_commits_oldest_first() {
        let f = fixture();
        let todo = rebase_todo(&f.repo, &f.base).unwrap();
        let summaries: Vec<_> = todo.iter().map(|t| t.summary.as_str()).collect();
        assert_eq!(summaries, vec!["c1", "c2", "c3"]);
    }

    #[test]
    fn unchanged_plan_keeps_hashes() {
        let f = fixture();
        let steps: Vec<_> = f.c.iter().map(|h| step(h, RebaseAction::Pick, None)).collect();
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap().done);
        assert_eq!(head(&f.repo).id().to_string(), f.c[2]);
    }

    #[test]
    fn reorder_and_drop() {
        let f = fixture();
        let steps = vec![step(&f.c[2], RebaseAction::Pick, None), step(&f.c[0], RebaseAction::Pick, None)];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();

        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c1"));
        assert_eq!(tip.parent(0).unwrap().message().ok(), Some("c3"));
        assert!(!f.dir.path().join("b.txt").exists(), "c2 a été supprimé");
        assert!(f.dir.path().join("a.txt").exists());
        assert_eq!(f.repo.head().unwrap().shorthand().ok(), Some("master"));
    }

    #[test]
    fn squash_with_message_and_fixup() {
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Pick, None),
            step(&f.c[1], RebaseAction::Squash, Some("c1 + c2")),
            step(&f.c[2], RebaseAction::Fixup, None),
        ];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();

        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c1 + c2"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), f.base);
        let tree = tip.tree().unwrap();
        for file in ["a.txt", "b.txt", "c.txt"] {
            assert!(tree.get_name(file).is_some(), "{file} manquant");
        }
    }

    #[test]
    fn reword_changes_message_only() {
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Reword, Some("first commit")),
            step(&f.c[1], RebaseAction::Pick, None),
            step(&f.c[2], RebaseAction::Pick, None),
        ];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        let tip = head(&f.repo);
        assert_eq!(tip.parent(0).unwrap().parent(0).unwrap().message().ok(), Some("first commit"));
        assert_eq!(tip.message().ok(), Some("c3"));
    }

    #[test]
    fn squash_first_commit_is_rejected() {
        let f = fixture();
        let steps = vec![step(&f.c[0], RebaseAction::Squash, None)];
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).is_err());
        assert_eq!(head(&f.repo).id().to_string(), f.c[2]);
        assert!(interactive_status(&f.repo).is_none());
    }

    #[test]
    fn dirty_workdir_is_rejected() {
        let f = fixture();
        fs::write(f.dir.path().join("a.txt"), "dirty\n").unwrap();
        let steps = vec![step(&f.c[0], RebaseAction::Pick, None)];
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).is_err());
    }

    #[test]
    fn conflict_pauses_then_continue_finishes() {
        let (dir, repo, base, c1, c2) = conflicting();
        // c2 avant c1 : c2 (v1 → v2) ne s'applique pas proprement sur v0.
        let steps = vec![step(&c2, RebaseAction::Pick, None), step(&c1, RebaseAction::Pick, None)];
        let outcome = interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        assert!(!outcome.done);
        let stop = outcome.stopped.unwrap();
        assert_eq!(stop.reason, StopReason::Conflict);
        assert_eq!(stop.hash, c2);
        assert_eq!((stop.step, stop.total), (1, 2));
        assert_eq!(stop.conflicted_files, vec!["f.txt".to_string()]);
        assert_eq!(interactive_status(&repo).unwrap().hash, c2);
        // La branche n'a pas encore bougé.
        assert_eq!(repo.find_reference("refs/heads/master").unwrap().target().unwrap().to_string(), c2);

        assert!(continue_interactive(&repo).is_err(), "conflits non résolus");
        resolve(&repo, &dir, "f.txt", "v2\n");
        // Deuxième étape : c1 (v0 → v1) sur v2 entre aussi en conflit.
        let outcome = continue_interactive(&repo).unwrap();
        assert_eq!(outcome.stopped.as_ref().unwrap().hash, c1);
        resolve(&repo, &dir, "f.txt", "v1 after v2\n");
        let outcome = continue_interactive(&repo).unwrap();
        assert!(outcome.done);

        let tip = head(&repo);
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("master"));
        assert_eq!(tip.message().ok(), Some("c1"));
        assert_eq!(tip.parent(0).unwrap().message().ok(), Some("c2"));
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "v1 after v2\n");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(interactive_status(&repo).is_none());
    }

    #[test]
    fn conflict_then_abort_restores_everything() {
        let (dir, repo, base, c1, c2) = conflicting();
        let steps = vec![step(&c2, RebaseAction::Pick, None), step(&c1, RebaseAction::Pick, None)];
        interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();

        abort_interactive(&repo).unwrap();
        assert_eq!(head(&repo).id().to_string(), c2);
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("master"));
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "v2\n");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert!(interactive_status(&repo).is_none());
    }

    #[test]
    fn cannot_start_twice() {
        let (_dir, repo, base, c1, c2) = conflicting();
        let steps = vec![step(&c2, RebaseAction::Pick, None), step(&c1, RebaseAction::Pick, None)];
        interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        assert!(interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).is_err());
    }

    #[test]
    fn edit_stop_allows_amend_then_continue() {
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Edit, None),
            step(&f.c[1], RebaseAction::Pick, None),
            step(&f.c[2], RebaseAction::Pick, None),
        ];
        let outcome = interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        let stop = outcome.stopped.unwrap();
        assert_eq!(stop.reason, StopReason::Edit);
        assert_eq!(stop.hash, f.c[0]);
        assert_eq!(head(&f.repo).id().to_string(), f.c[0], "commit à sa place : même hash");

        // Modification du commit arrêté (amend) : contenu et message.
        fs::write(f.dir.path().join("a.txt"), "a amended\n").unwrap();
        let mut index = f.repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        crate::git::create_commit(&f.repo, "c1 amended", true).unwrap();

        let outcome = continue_interactive(&f.repo).unwrap();
        assert!(outcome.done);
        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c3"));
        let first = tip.parent(0).unwrap().parent(0).unwrap();
        assert_eq!(first.message().ok(), Some("c1 amended"));
        assert_eq!(fs::read_to_string(f.dir.path().join("a.txt")).unwrap(), "a amended\n");
        assert_eq!(f.repo.head().unwrap().shorthand().ok(), Some("master"));
    }

    #[test]
    fn edit_stop_allows_extra_commits() {
        let f = fixture();
        let steps = vec![step(&f.c[0], RebaseAction::Edit, None), step(&f.c[1], RebaseAction::Pick, None)];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        commit_file(&f.repo, &f.dir, "extra.txt", "x\n", "extra");

        assert!(continue_interactive(&f.repo).unwrap().done);
        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c2"));
        assert_eq!(tip.parent(0).unwrap().message().ok(), Some("extra"));
        assert!(!f.dir.path().join("c.txt").exists(), "c3 absent du plan : supprimé");
    }

    #[test]
    fn edit_stop_requires_committed_changes() {
        let f = fixture();
        let steps = vec![step(&f.c[0], RebaseAction::Edit, None)];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        fs::write(f.dir.path().join("a.txt"), "wip\n").unwrap();
        assert!(continue_interactive(&f.repo).is_err());
    }

    #[test]
    fn squash_conflict_resolves_into_previous_commit() {
        let (dir, repo, base, c1, c2) = conflicting();
        let c3 = commit_file(&repo, &dir, "g.txt", "g\n", "c3");
        // c1 supprimé : c2 (v1 → v2) en conflit sur v0, fusionné dans c3 déplacé avant.
        let steps = vec![step(&c3, RebaseAction::Pick, None), step(&c2, RebaseAction::Squash, None)];
        let _ = c1;
        let outcome = interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        assert_eq!(outcome.stopped.unwrap().reason, StopReason::Conflict);
        resolve(&repo, &dir, "f.txt", "v2\n");
        assert!(continue_interactive(&repo).unwrap().done);

        let tip = head(&repo);
        assert_eq!(tip.message().ok(), Some("c3\n\nc2"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), base);
        assert!(tip.tree().unwrap().get_name("g.txt").is_some());
    }

    #[test]
    fn commit_that_becomes_empty_is_skipped() {
        // c2 annule c1 : sans c1, c2 n'apporte plus rien et doit disparaître.
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "f.txt", "v0\n", "base");
        let c1 = commit_file(&repo, &dir, "f.txt", "v1\n", "c1");
        let c2 = commit_file(&repo, &dir, "f.txt", "v0\n", "revert c1");
        let c3 = commit_file(&repo, &dir, "g.txt", "g\n", "c3");
        let _ = c1;
        let steps = vec![step(&c2, RebaseAction::Pick, None), step(&c3, RebaseAction::Pick, None)];
        assert!(interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap().done);

        let tip = head(&repo);
        assert_eq!(tip.message().ok(), Some("c3"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), base, "le commit devenu vide est sauté");
        workdir_clean_and_on_master(&repo);
    }

    #[test]
    fn originally_empty_commit_is_kept() {
        let f = fixture();
        // Commit vide volontaire (même arbre que son parent).
        let parent = head(&f.repo);
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let empty = f.repo.commit(Some("HEAD"), &sig, &sig, "empty", &parent.tree().unwrap(), &[&parent]).unwrap().to_string();
        let steps = vec![
            step(&f.c[0], RebaseAction::Reword, Some("c1 reworded")),
            step(&f.c[1], RebaseAction::Pick, None),
            step(&f.c[2], RebaseAction::Pick, None),
            step(&empty, RebaseAction::Pick, None),
        ];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("empty"));
        assert_eq!(tip.tree_id(), tip.parent(0).unwrap().tree_id());
    }

    #[test]
    fn conflict_resolved_to_existing_content_skips_the_commit() {
        let (dir, repo, base, c1, c2) = conflicting();
        let steps = vec![step(&c2, RebaseAction::Pick, None), step(&c1, RebaseAction::Pick, None)];
        let outcome = interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        assert_eq!(outcome.stopped.unwrap().hash, c2);
        // Résolution en gardant la version de la base : c2 n'apporte plus rien.
        resolve(&repo, &dir, "f.txt", "v0\n");
        assert!(continue_interactive(&repo).unwrap().done);

        let tip = head(&repo);
        assert_eq!(tip.message().ok(), Some("c1"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), base);
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "v1\n");
        workdir_clean_and_on_master(&repo);
    }

    #[test]
    fn squash_conflict_committed_by_user_is_folded_into_target() {
        let (dir, repo, base, _c1, c2) = conflicting();
        let c3 = commit_file(&repo, &dir, "g.txt", "g\n", "c3");
        let steps = vec![step(&c3, RebaseAction::Pick, None), step(&c2, RebaseAction::Squash, Some("c3 + c2"))];
        let outcome = interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        assert_eq!(outcome.stopped.unwrap().reason, StopReason::Conflict);

        // L'utilisateur résout puis commite lui-même au lieu de cliquer sur Continuer.
        resolve(&repo, &dir, "f.txt", "v2\n");
        crate::git::create_commit(&repo, "my own commit", false).unwrap();
        assert!(continue_interactive(&repo).unwrap().done);

        let tip = head(&repo);
        assert_eq!(tip.message().ok(), Some("c3 + c2"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), base, "un seul commit au-dessus de la base");
        let tree = tip.tree().unwrap();
        assert!(tree.get_name("g.txt").is_some());
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "v2\n");
        workdir_clean_and_on_master(&repo);
    }

    // ------------------------------------------------------------ Historiques avec merges

    /// base → c1 (f = "main") → M ← c2 (g = "side"), puis c3 (h) au-dessus de M.
    /// Le merge M est un merge simple (pas de conflit).
    struct MergeFixture {
        dir: TempDir,
        repo: Repository,
        base: String,
        c1: String,
        c2: String,
        merge: String,
        c3: String,
    }

    fn merge_commit(repo: &Repository, dir: &TempDir, other: &str, msg: &str, resolve_to: Option<(&str, &str)>) -> String {
        let head = head(repo);
        let other = repo.find_commit(Oid::from_str(other).unwrap()).unwrap();
        let mut index = repo.merge_commits(&head, &other, None).unwrap();
        if let Some((file, content)) = resolve_to {
            // Résolution manuelle du conflit (« evil merge »).
            index.remove_path(std::path::Path::new(file)).unwrap();
            fs::write(dir.path().join(file), content).unwrap();
            let blob = repo.blob(content.as_bytes()).unwrap();
            let entry = git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0, ino: 0, mode: 0o100644, uid: 0, gid: 0,
                file_size: content.len() as u32,
                id: blob,
                flags: file.len() as u16,
                flags_extended: 0,
                path: file.as_bytes().to_vec(),
            };
            index.add(&entry).unwrap();
        }
        let tree = repo.find_tree(index.write_tree_to(repo).unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let id = repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &[&head, &other]).unwrap();
        let commit = repo.find_commit(id).unwrap();
        repo.reset(commit.as_object(), ResetType::Hard, None).unwrap();
        id.to_string()
    }

    fn merge_fixture() -> MergeFixture {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "base.txt", "base
", "base");
        let c1 = commit_file(&repo, &dir, "f.txt", "main
", "c1");
        // Branche latérale partant de base
        repo.set_head_detached(Oid::from_str(&base).unwrap()).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let c2 = commit_file(&repo, &dir, "g.txt", "side
", "c2");
        repo.set_head("refs/heads/master").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let merge = merge_commit(&repo, &dir, &c2, "Merge side", None);
        let c3 = commit_file(&repo, &dir, "h.txt", "top
", "c3");
        MergeFixture { dir, repo, base, c1, c2, merge, c3 }
    }

    #[test]
    fn todo_includes_merges_with_parents() {
        let f = merge_fixture();
        let todo = rebase_todo(&f.repo, &f.base).unwrap();
        let merge = todo.iter().find(|c| c.hash == f.merge).unwrap();
        assert!(merge.is_merge);
        assert_eq!(merge.parents, vec![f.c1.clone(), f.c2.clone()]);
        assert_eq!(todo.last().unwrap().hash, f.c3);
    }

    #[test]
    fn linear_mode_flattens_merges() {
        let f = merge_fixture();
        let steps = vec![
            step(&f.c2, RebaseAction::Pick, None),
            step(&f.c1, RebaseAction::Pick, None),
            step(&f.c3, RebaseAction::Pick, None),
        ];
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap().done);
        let tip = head(&f.repo);
        let messages: Vec<String> = [tip.clone(), tip.parent(0).unwrap(), tip.parent(0).unwrap().parent(0).unwrap()]
            .iter()
            .map(|c| c.message().unwrap().to_string())
            .collect();
        assert_eq!(messages, vec!["c3", "c1", "c2"]);
        assert_eq!(tip.parent(0).unwrap().parent(0).unwrap().parent(0).unwrap().id().to_string(), f.base);
        for file in ["f.txt", "g.txt", "h.txt"] {
            assert!(f.dir.path().join(file).exists());
        }
    }

    #[test]
    fn linear_mode_rejects_merge_steps() {
        let f = merge_fixture();
        let steps = vec![step(&f.merge, RebaseAction::Pick, None)];
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).is_err());
    }

    fn all_picks(f: &MergeFixture) -> Vec<RebaseStep> {
        [&f.c1, &f.c2, &f.merge, &f.c3]
            .iter()
            .map(|h| step(h, RebaseAction::Pick, None))
            .collect()
    }

    #[test]
    fn preserve_unchanged_plan_keeps_hashes() {
        let f = merge_fixture();
        let todo = rebase_todo(&f.repo, &f.base).unwrap();
        let steps: Vec<_> = todo.iter().map(|c| step(&c.hash, RebaseAction::Pick, None)).collect();
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap().done);
        assert_eq!(head(&f.repo).id().to_string(), f.c3);
    }

    #[test]
    fn preserve_reword_keeps_merge_shape() {
        let f = merge_fixture();
        let todo = rebase_todo(&f.repo, &f.base).unwrap();
        let steps: Vec<_> = todo
            .iter()
            .map(|c| {
                if c.hash == f.c1 {
                    step(&c.hash, RebaseAction::Reword, Some("c1 renamed"))
                } else {
                    step(&c.hash, RebaseAction::Pick, None)
                }
            })
            .collect();
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap().done);

        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c3"));
        let merge = tip.parent(0).unwrap();
        assert_eq!(merge.parent_count(), 2, "le merge est conservé");
        assert_eq!(merge.message().ok(), Some("Merge side"));
        assert_eq!(merge.parent(0).unwrap().message().ok(), Some("c1 renamed"));
        assert_eq!(merge.parent_id(1).unwrap().to_string(), f.c2, "la branche fusionnée est intacte");
        assert_eq!(f.repo.head().unwrap().shorthand().ok(), Some("master"));
    }

    #[test]
    fn preserve_reword_on_merged_branch_rebuilds_merge() {
        let f = merge_fixture();
        let mut steps = all_picks(&f);
        steps[1] = step(&f.c2, RebaseAction::Reword, Some("c2 renamed"));
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap();
        let merge = head(&f.repo).parent(0).unwrap();
        assert_eq!(merge.parent(1).unwrap().message().ok(), Some("c2 renamed"));
        assert_eq!(merge.parent_id(0).unwrap().to_string(), f.c1);
    }

    #[test]
    fn preserve_dropping_merged_branch_removes_merge() {
        let f = merge_fixture();
        let mut steps = all_picks(&f);
        steps[1] = step(&f.c2, RebaseAction::Drop, None);
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap();
        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c3"));
        assert_eq!(tip.parent(0).unwrap().id().to_string(), f.c1, "le merge devenu inutile disparaît");
        assert!(!f.dir.path().join("g.txt").exists());
    }

    #[test]
    fn preserve_dropping_merge_keeps_first_parent_line() {
        let f = merge_fixture();
        let mut steps = all_picks(&f);
        steps[2] = step(&f.merge, RebaseAction::Drop, None);
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap();
        let tip = head(&f.repo);
        assert_eq!(tip.parent(0).unwrap().id().to_string(), f.c1);
        assert!(!f.dir.path().join("g.txt").exists());
    }

    #[test]
    fn preserve_rejects_reordering() {
        let f = merge_fixture();
        let mut steps = all_picks(&f);
        steps.swap(0, 1);
        let e = interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).unwrap_err();
        assert!(e.to_string().contains("ordre"));
    }

    #[test]
    fn preserve_rejects_squash_into_merge() {
        let f = merge_fixture();
        let mut steps = all_picks(&f);
        steps[3] = step(&f.c3, RebaseAction::Fixup, None);
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Preserve).is_err());
    }

    #[test]
    fn preserve_squash_on_same_branch() {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "base.txt", "base
", "base");
        let a = commit_file(&repo, &dir, "a.txt", "a
", "a");
        let a2 = commit_file(&repo, &dir, "a2.txt", "a2
", "a fix");
        repo.set_head_detached(Oid::from_str(&base).unwrap()).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let side = commit_file(&repo, &dir, "s.txt", "s
", "side");
        repo.set_head("refs/heads/master").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let merge = merge_commit(&repo, &dir, &side, "Merge side", None);

        let steps = vec![
            step(&a, RebaseAction::Pick, None),
            step(&a2, RebaseAction::Fixup, None),
            step(&side, RebaseAction::Pick, None),
            step(&merge, RebaseAction::Pick, None),
        ];
        assert!(interactive_rebase(&repo, &base, &steps, RebaseMode::Preserve).unwrap().done);
        let tip = head(&repo);
        assert_eq!(tip.parent_count(), 2);
        let squashed = tip.parent(0).unwrap();
        assert_eq!(squashed.message().ok(), Some("a"));
        assert_eq!(squashed.parent_id(0).unwrap().to_string(), base);
        assert!(squashed.tree().unwrap().get_name("a2.txt").is_some());
    }

    /// Merge avec résolution manuelle d'un conflit : base(f=v0) → m(f=main) ; side(f=side) ; M(f=resolved).
    fn evil_merge() -> (TempDir, Repository, String, String, String, String) {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "f.txt", "v0
", "base");
        let m = commit_file(&repo, &dir, "f.txt", "main
", "main change");
        repo.set_head_detached(Oid::from_str(&base).unwrap()).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let side = commit_file(&repo, &dir, "f.txt", "side
", "side change");
        repo.set_head("refs/heads/master").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force())).unwrap();
        let merge = merge_commit(&repo, &dir, &side, "Merge side", Some(("f.txt", "resolved
")));
        (dir, repo, base, m, side, merge)
    }

    #[test]
    fn preserve_keeps_manual_merge_resolution() {
        let (dir, repo, base, m, side, merge) = evil_merge();
        let steps = vec![
            step(&m, RebaseAction::Reword, Some("main change (renamed)")),
            step(&side, RebaseAction::Pick, None),
            step(&merge, RebaseAction::Pick, None),
        ];
        assert!(interactive_rebase(&repo, &base, &steps, RebaseMode::Preserve).unwrap().done);
        let tip = head(&repo);
        assert_eq!(tip.parent_count(), 2);
        assert_eq!(tip.parent(0).unwrap().message().ok(), Some("main change (renamed)"));
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "resolved
");
    }

    #[test]
    fn preserve_remerge_conflict_pauses_and_continues() {
        let (dir, repo, base, m, side, merge) = evil_merge();
        // La branche fusionnée change (edit + amend) : le merge doit être refait et entre en conflit.
        let steps = vec![
            step(&m, RebaseAction::Pick, None),
            step(&side, RebaseAction::Edit, None),
            step(&merge, RebaseAction::Pick, None),
        ];
        let outcome = interactive_rebase(&repo, &base, &steps, RebaseMode::Preserve).unwrap();
        assert_eq!(outcome.stopped.unwrap().reason, StopReason::Edit);
        resolve(&repo, &dir, "f.txt", "side v2
");
        crate::git::create_commit(&repo, "side change v2", true).unwrap();

        let outcome = continue_interactive(&repo).unwrap();
        let stop = outcome.stopped.unwrap();
        assert_eq!(stop.reason, StopReason::Conflict);
        assert_eq!(stop.hash, merge);
        assert_eq!(repo.state(), RepositoryState::Merge);

        resolve(&repo, &dir, "f.txt", "resolved again
");
        assert!(continue_interactive(&repo).unwrap().done);
        let tip = head(&repo);
        assert_eq!(tip.parent_count(), 2);
        assert_eq!(tip.message().ok(), Some("Merge side"));
        assert_eq!(tip.parent(1).unwrap().message().ok(), Some("side change v2"));
        assert_eq!(tip.parent_id(0).unwrap().to_string(), m);
        assert_eq!(fs::read_to_string(dir.path().join("f.txt")).unwrap(), "resolved again
");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("master"));
    }

    fn workdir_clean_and_on_master(repo: &Repository) {
        assert!(workdir_is_clean(repo).unwrap(), "copie de travail ou index modifiés après le rebase");
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("master"));
        assert!(interactive_status(repo).is_none());
    }

    #[test]
    fn squash_non_adjacent_commits_groups_them_behind_the_oldest() {
        // Plan produit par la sélection multiple du graphe : c1 + c3, c2 reste à part.
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Pick, None),
            step(&f.c[2], RebaseAction::Squash, Some("c1 + c3")),
            step(&f.c[1], RebaseAction::Pick, None),
        ];
        assert!(interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap().done);

        let tip = head(&f.repo);
        assert_eq!(tip.message().ok(), Some("c2"));
        let squashed = tip.parent(0).unwrap();
        assert_eq!(squashed.message().ok(), Some("c1 + c3"));
        assert_eq!(squashed.parent(0).unwrap().id().to_string(), f.base);
        let tree = squashed.tree().unwrap();
        assert!(tree.get_name("a.txt").is_some() && tree.get_name("c.txt").is_some());
        assert!(tree.get_name("b.txt").is_none(), "c2 ne doit pas être dans le commit squashé");
        workdir_clean_and_on_master(&f.repo);
    }

    #[test]
    fn squash_without_message_concatenates_all_messages() {
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Pick, None),
            step(&f.c[1], RebaseAction::Squash, None),
            step(&f.c[2], RebaseAction::Squash, None),
        ];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        assert_eq!(head(&f.repo).message().ok(), Some("c1\n\nc2\n\nc3"));
        workdir_clean_and_on_master(&f.repo);
    }

    #[test]
    fn rewritten_commits_keep_their_author() {
        let (dir, repo) = new_repo();
        let base = commit_file(&repo, &dir, "base.txt", "base\n", "base");
        // Commit d'un autre auteur que l'utilisateur configuré (committer).
        fs::write(dir.path().join("a.txt"), "a\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let alice = git2::Signature::now("Alice", "alice@test.com").unwrap();
        let parent = head(&repo);
        let c1 = repo.commit(Some("HEAD"), &alice, &alice, "by alice", &tree, &[&parent]).unwrap().to_string();
        let c2 = commit_file(&repo, &dir, "b.txt", "b\n", "by test");

        let steps = vec![step(&c1, RebaseAction::Reword, Some("reworded")), step(&c2, RebaseAction::Fixup, None)];
        interactive_rebase(&repo, &base, &steps, RebaseMode::Linear).unwrap();
        let tip = head(&repo);
        assert_eq!(tip.message().ok(), Some("reworded"));
        assert_eq!(tip.author().name().ok(), Some("Alice"), "l'auteur du commit cible est conservé");
        assert_eq!(tip.committer().name().ok(), Some("Test"));
    }

    #[test]
    fn detached_head_stays_detached() {
        let f = fixture();
        f.repo.set_head_detached(Oid::from_str(&f.c[2]).unwrap()).unwrap();
        let steps = vec![step(&f.c[0], RebaseAction::Pick, None), step(&f.c[2], RebaseAction::Pick, None)];
        interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        assert!(f.repo.head_detached().unwrap());
        assert_eq!(head(&f.repo).message().ok(), Some("c3"));
        let master = f.repo.find_branch("master", git2::BranchType::Local).unwrap();
        assert_eq!(master.get().target().unwrap().to_string(), f.c[2], "la branche n'est pas touchée");
    }

    #[test]
    fn edit_stop_then_abort_restores_branch() {
        let f = fixture();
        let steps = vec![
            step(&f.c[0], RebaseAction::Pick, None),
            step(&f.c[1], RebaseAction::Reword, Some("c2 reworded")),
            step(&f.c[2], RebaseAction::Edit, None),
        ];
        let outcome = interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear).unwrap();
        assert_eq!(outcome.stopped.unwrap().reason, StopReason::Edit);
        abort_interactive(&f.repo).unwrap();

        assert_eq!(head(&f.repo).id().to_string(), f.c[2]);
        assert_eq!(head(&f.repo).parent(0).unwrap().message().ok(), Some("c2"));
        workdir_clean_and_on_master(&f.repo);
    }

    #[test]
    fn untracked_file_in_the_way_fails_without_changing_anything() {
        // c4 supprime b.txt, puis l'utilisateur crée un b.txt non suivi. Supprimer c4 du plan
        // ferait réapparaître b.txt et écraserait ce fichier : le rebase doit refuser sans rien casser.
        let f = fixture();
        fs::remove_file(f.dir.path().join("b.txt")).unwrap();
        let mut index = f.repo.index().unwrap();
        index.remove_path(std::path::Path::new("b.txt")).unwrap();
        index.write().unwrap();
        crate::git::create_commit(&f.repo, "c4", false).unwrap();
        let c4 = head(&f.repo).id();
        fs::write(f.dir.path().join("b.txt"), "untracked\n").unwrap();

        let steps: Vec<_> = f.c.iter().map(|h| step(h, RebaseAction::Pick, None)).collect();
        let result = interactive_rebase(&f.repo, &f.base, &steps, RebaseMode::Linear);

        assert!(result.is_err(), "le fichier non suivi aurait été écrasé");
        assert_eq!(fs::read_to_string(f.dir.path().join("b.txt")).unwrap(), "untracked\n");
        assert_eq!(head(&f.repo).id(), c4);
        assert_eq!(f.repo.head().unwrap().shorthand().ok(), Some("master"));
        assert!(interactive_status(&f.repo).is_none(), "aucun rebase ne doit rester en cours");
    }
}
