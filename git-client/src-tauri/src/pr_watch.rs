//! Android : activité des PR / MR vérifiée quand l'application est fermée (option des préférences, désactivée par
//! défaut).
//!
//! Fermée, l'application n'a plus de WebView : la vérification périodique du frontend (prNotifications.ts) ne tourne
//! plus. Une tâche WorkManager (MerathonPrWatch.kt) appelle alors [`check`] par JNI, toutes les 15 min à 3 h selon le
//! réglage, réseau disponible. [`check`] refait ici le strict nécessaire : liste « mes PR » de chaque compte, comparaison
//! avec la dernière liste connue, texte des notifications. Kotlin les affiche ; le lanceur en tire la pastille de l'icône.
//!
//! L'état commun (réglages, dernière liste de chaque compte, notifications affichées) est dans `pr-watch.json`, à côté
//! des comptes. Le frontend y recopie chaque liste qu'il charge, et y relit celle de la tâche avant de comparer : un
//! changement déjà notifié en arrière-plan ne l'est pas une deuxième fois à l'ouverture. Les notifications affichées
//! sont retirées quand toutes leurs PR ont été consultées dans l'application (comme les notifications de GNOME).
//!
//! La comparaison suit `pullRequestEvents` / `filterEvents` / `notificationText` de prNotifications.ts : les deux
//! doivent rester alignées (mêmes cas dans les tests).

// Hors d'Android, seule la tâche (JNI) appelle la vérification : elle n'est compilée ailleurs que pour les tests.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::accounts::{Account, AccountStore, Provider};
use crate::forge;

/// Intervalles proposés (minutes) ; WorkManager n'accepte pas moins de 15 minutes.
pub const INTERVALS: [u32; 4] = [15, 30, 60, 180];
/// Notifications retenues pour être retirées plus tard : au-delà, les plus anciennes sont oubliées.
const MAX_SHOWN: usize = 50;
/// Taille d'une page de résultats, comme `PR_PAGE_SIZE` côté frontend.
const PAGE_SIZE: u32 = 50;
const MAX_LINES: usize = 4;

/// Réglages recopiés depuis les préférences de l'application.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSettings {
    pub minutes: u32,
    pub opened: bool,
    pub commits: bool,
    pub comments: bool,
    pub ci: bool,
    pub review: bool,
    /// Langue des notifications, celle de l'interface.
    pub english: bool,
}

/// Ce que la comparaison lit d'une PR (sous-ensemble de `PrSummary`, mêmes noms de champs).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedPr {
    pub number: u64,
    #[serde(default)]
    pub title: String,
    pub project_path: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub head_sha: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_count: Option<u64>,
    #[serde(default)]
    pub pushed_by_me: bool,
    #[serde(default)]
    pub ci: Option<String>,
    #[serde(default)]
    pub review: String,
}

impl WatchedPr {
    fn key(&self) -> String {
        format!("{}#{}", self.project_path, self.number)
    }
}

/// « Mes PR » d'un compte : à traiter (assigné ou relecteur demandé) et ouvertes par moi.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PrLists {
    #[serde(default)]
    pub assigned: Vec<WatchedPr>,
    #[serde(default)]
    pub authored: Vec<WatchedPr>,
}

/// Dernière liste connue d'un compte (`at` : millisecondes), même forme que les instantanés du frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub at: u64,
    pub data: PrLists,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotifiedPr {
    /// Clé de consultation (`seenKey` du frontend).
    pub key: String,
    pub pr: WatchedPr,
}

/// Notification affichée par la tâche, retirée quand toutes ses PR ont été consultées.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shown {
    pub id: i32,
    pub prs: Vec<NotifiedPr>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    /// Absent : option désactivée.
    #[serde(default)]
    settings: Option<WatchSettings>,
    #[serde(default)]
    snapshots: HashMap<String, Snapshot>,
    #[serde(default)]
    shown: Vec<Shown>,
    #[serde(default)]
    next_id: i32,
}

/// Le frontend et la tâche partagent le fichier, dans le même processus : une seule lecture-écriture à la fois.
static LOCK: Mutex<()> = Mutex::new(());

fn state_file(dir: &Path) -> PathBuf {
    dir.join("pr-watch.json")
}

fn load(dir: &Path) -> State {
    std::fs::read_to_string(state_file(dir)).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn save(dir: &Path, state: &State) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(state).map_err(|e| e.to_string())?;
    // Écrit à côté puis renommé : une interruption ne laisse jamais un fichier tronqué.
    let tmp = dir.join("pr-watch.json.tmp");
    std::fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, state_file(dir)).map_err(|e| e.to_string())
}

/// Lecture-modification-écriture de l'état, sous verrou.
fn update<T>(dir: &Path, f: impl FnOnce(&mut State) -> T) -> Result<T, String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = load(dir);
    let value = f(&mut state);
    save(dir, &state)?;
    Ok(value)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// ---------------------------------------------------------------- État partagé avec le frontend

/// Enregistre les réglages (None : option désactivée).
pub fn configure(dir: &Path, settings: Option<WatchSettings>) -> Result<(), String> {
    if let Some(s) = &settings {
        if !INTERVALS.contains(&s.minutes) {
            return Err(format!("intervalle non proposé : {} min", s.minutes));
        }
    }
    update(dir, |state| {
        if settings.is_none() {
            // Désactivée : plus rien à comparer ; une réactivation repartira de la liste de l'application.
            state.snapshots.clear();
        }
        state.settings = settings;
    })
}

/// Liste que le frontend vient de charger : elle devient la référence de la prochaine vérification.
pub fn store_snapshot(dir: &Path, account_id: &str, snapshot: Snapshot) -> Result<(), String> {
    update(dir, |state| {
        // Rien à garder si l'option est coupée ; une liste plus récente de la tâche n'est pas écrasée.
        if state.settings.is_some() && state.snapshots.get(account_id).is_none_or(|s| s.at < snapshot.at) {
            state.snapshots.insert(account_id.to_string(), snapshot);
        }
    })
}

pub fn snapshots(dir: &Path) -> HashMap<String, Snapshot> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load(dir).snapshots
}

pub fn shown(dir: &Path) -> Vec<Shown> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load(dir).shown
}

/// Oublie une notification retirée ; vrai si elle venait de la tâche.
pub fn forget_shown(dir: &Path, id: i32) -> Result<bool, String> {
    update(dir, |state| {
        let before = state.shown.len();
        state.shown.retain(|n| n.id != id);
        state.shown.len() != before
    })
}

// ---------------------------------------------------------------- Comparaison (voir prNotifications.ts)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Opened,
    Commits,
    Comments,
    Activity,
    CiSuccess,
    CiFailure,
    Approved,
    ChangesRequested,
}

impl EventKind {
    fn enabled(self, s: &WatchSettings) -> bool {
        match self {
            Self::Opened => s.opened,
            Self::Commits => s.commits,
            Self::Comments | Self::Activity => s.comments,
            Self::CiSuccess | Self::CiFailure => s.ci,
            Self::Approved | Self::ChangesRequested => s.review,
        }
    }

    fn label(self, pr_label: &str) -> String {
        match self {
            Self::Opened => tr!("nouvelle {pr_label} à traiter", "new {pr_label} to handle"),
            Self::Commits => tr!("nouveaux commits", "new commits"),
            Self::Comments => tr!("nouveaux commentaires", "new comments"),
            Self::Activity => tr!("nouvelle activité", "new activity"),
            Self::CiSuccess => tr!("CI passée", "CI passed"),
            Self::CiFailure => tr!("CI en échec", "CI failed"),
            Self::Approved => tr!("approuvée", "approved"),
            Self::ChangesRequested => tr!("modifications demandées", "changes requested"),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub pr: WatchedPr,
    pub kinds: Vec<EventKind>,
}

/// Ce qui a changé sur une PR ; `authored` : ouverte par moi (mes propres commits ne sont pas signalés).
fn changes(prev: &WatchedPr, pr: &WatchedPr, authored: bool) -> Vec<EventKind> {
    let mut kinds = Vec::new();
    let commits = pr.head_sha != prev.head_sha;
    if commits && !authored && !pr.pushed_by_me {
        kinds.push(EventKind::Commits);
    }
    match (pr.comment_count, prev.comment_count) {
        (Some(now), Some(before)) => {
            if now > before {
                kinds.push(EventKind::Comments);
            }
        }
        _ => {
            if pr.updated_at > prev.updated_at && !commits && pr.ci == prev.ci && pr.review == prev.review {
                kinds.push(EventKind::Activity);
            }
        }
    }
    if pr.ci != prev.ci && pr.ci.as_deref() == Some("success") {
        kinds.push(EventKind::CiSuccess);
    }
    if pr.ci != prev.ci && pr.ci.as_deref() == Some("failure") {
        kinds.push(EventKind::CiFailure);
    }
    if pr.review != prev.review && pr.review == "approved" {
        kinds.push(EventKind::Approved);
    }
    if pr.review != prev.review && pr.review == "changes_requested" {
        kinds.push(EventKind::ChangesRequested);
    }
    kinds
}

/// Événements entre deux listes : PR à traiter apparues, commits, commentaires, CI, relecture.
pub fn events(before: &PrLists, after: &PrLists) -> Vec<Event> {
    let old: HashMap<String, &WatchedPr> = before.assigned.iter().chain(&before.authored).map(|pr| (pr.key(), pr)).collect();
    let authored: HashSet<String> = after.authored.iter().map(WatchedPr::key).collect();
    let mut done = HashSet::new();
    let mut out = Vec::new();
    for pr in after.assigned.iter().chain(&after.authored) {
        let key = pr.key();
        if !done.insert(key.clone()) {
            continue;
        }
        let kinds = match old.get(&key) {
            Some(prev) => changes(prev, pr, authored.contains(&key)),
            None if !authored.contains(&key) => vec![EventKind::Opened],
            None => Vec::new(),
        };
        if !kinds.is_empty() {
            out.push(Event { pr: pr.clone(), kinds });
        }
    }
    out
}

/// Événements que les réglages laissent passer.
pub fn filter(events: Vec<Event>, settings: &WatchSettings) -> Vec<Event> {
    events
        .into_iter()
        .filter_map(|mut e| {
            e.kinds.retain(|k| k.enabled(settings));
            (!e.kinds.is_empty()).then_some(e)
        })
        .collect()
}

/// Titre et texte : le détail d'une seule PR, ou une ligne par PR.
pub fn text(events: &[Event], provider: Provider) -> (String, String) {
    let (pr_label, sign) = match provider {
        Provider::Gitlab => ("MR", "!"),
        Provider::Github => ("PR", "#"),
    };
    let kinds = |e: &Event| e.kinds.iter().map(|k| k.label(pr_label)).collect::<Vec<_>>().join(", ");
    if let [e] = events {
        let detail = kinds(e);
        let mut chars = detail.chars();
        let capitalized = chars.next().map(|c| c.to_uppercase().chain(chars).collect::<String>()).unwrap_or_default();
        return (format!("{pr_label} {sign}{} · {}", e.pr.number, e.pr.title), format!("{capitalized} — {}", e.pr.project_path));
    }
    let colon = if crate::i18n::is_english() { ": " } else { " : " };
    let mut lines: Vec<String> =
        events.iter().take(MAX_LINES).map(|e| format!("{sign}{} {}{colon}{}", e.pr.number, e.pr.title, kinds(e))).collect();
    let rest = events.len().saturating_sub(MAX_LINES);
    if rest == 1 {
        lines.push(tr!("… et {rest} autre", "… and {rest} other"));
    } else if rest > 1 {
        lines.push(tr!("… et {rest} autres", "… and {rest} others"));
    }
    let length = events.len();
    let title = tr!("{length} {pr_label} mises à jour", "{length} {pr_label}s updated");
    (title, lines.join("\n"))
}

// ---------------------------------------------------------------- Listes « mes PR » (voir github.ts / gitlab.ts)

const GITHUB_FIELDS: &str = "... on PullRequest {
    number title url updatedAt headRefOid
    repository { nameWithOwner }
    reviewDecision
    latestOpinionatedReviews(first: 20) { nodes { state } }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } committer { user { login } } } } }
  }";

fn github_query() -> String {
    let search = |name: &str| format!("{name}: search(query: ${name}, type: ISSUE, first: {PAGE_SIZE}) {{ nodes {{ {GITHUB_FIELDS} }} }}");
    format!(
        "query($assigned: String!, $reviewing: String!, $authored: String!) {{ viewer {{ login }} {} {} {} }}",
        search("assigned"),
        search("reviewing"),
        search("authored")
    )
}

fn str_at<'a>(v: &'a Value, pointer: &str) -> &'a str {
    v.pointer(pointer).and_then(Value::as_str).unwrap_or("")
}

fn github_pr(raw: &Value, me: &str) -> Option<WatchedPr> {
    let number = raw.get("number")?.as_u64()?;
    let head = raw.pointer("/commits/nodes/0/commit");
    let verdicts: Vec<&str> =
        raw.pointer("/latestOpinionatedReviews/nodes").and_then(Value::as_array).into_iter().flatten().map(|r| str_at(r, "/state")).collect();
    let decision = raw.get("reviewDecision").and_then(Value::as_str);
    // Sans relecture obligatoire, GitHub ne donne pas de décision : on la déduit des derniers avis.
    let review = if decision == Some("CHANGES_REQUESTED") || (decision.is_none() && verdicts.contains(&"CHANGES_REQUESTED")) {
        "changes_requested"
    } else if decision == Some("APPROVED") || (decision.is_none() && verdicts.contains(&"APPROVED")) {
        "approved"
    } else {
        "pending"
    };
    let ci = head.and_then(|h| h.pointer("/statusCheckRollup/state")).and_then(Value::as_str).and_then(|s| match s {
        "SUCCESS" => Some("success"),
        "FAILURE" | "ERROR" => Some("failure"),
        "PENDING" | "EXPECTED" => Some("pending"),
        _ => None,
    });
    let committer = head.map(|h| str_at(h, "/committer/user/login")).unwrap_or("");
    Some(WatchedPr {
        number,
        title: str_at(raw, "/title").into(),
        project_path: str_at(raw, "/repository/nameWithOwner").into(),
        url: str_at(raw, "/url").into(),
        head_sha: str_at(raw, "/headRefOid").into(),
        updated_at: str_at(raw, "/updatedAt").into(),
        comment_count: None,
        pushed_by_me: !me.is_empty() && committer == me,
        ci: ci.map(Into::into),
        review: review.into(),
    })
}

/// Sans doublon (même projet et même numéro), dans l'ordre d'arrivée.
fn unique(prs: Vec<WatchedPr>) -> Vec<WatchedPr> {
    let mut seen = HashSet::new();
    prs.into_iter().filter(|pr| seen.insert(pr.key())).collect()
}

/// GitHub : la recherche ne donne pas le nombre de commentaires. Il est relu (une requête par PR) seulement pour les
/// PR qui ont bougé et dont la liste précédente le connaissait : sinon la comparaison se contente de « nouvelle activité ».
fn github_lists(account: &Account, token: &str, previous: Option<&PrLists>) -> Result<PrLists, String> {
    let open = "is:pr is:open archived:false";
    let variables =
        json!({ "assigned": format!("{open} assignee:@me"), "reviewing": format!("{open} review-requested:@me"), "authored": format!("{open} author:@me") });
    let data = forge::graphql(account, token, &github_query(), &variables)?;
    let me = str_at(&data, "/viewer/login");
    let parse = |name: &str| -> Vec<WatchedPr> {
        data.pointer(&format!("/{name}/nodes")).and_then(Value::as_array).into_iter().flatten().filter_map(|n| github_pr(n, me)).collect()
    };
    let mut assigned = parse("assigned");
    assigned.extend(parse("reviewing"));
    let mut lists = PrLists { assigned: unique(assigned), authored: parse("authored") };
    let old: HashMap<String, &WatchedPr> =
        previous.map(|p| p.assigned.iter().chain(&p.authored).map(|pr| (pr.key(), pr)).collect()).unwrap_or_default();
    for pr in lists.assigned.iter_mut().chain(lists.authored.iter_mut()) {
        let Some(prev) = old.get(&pr.key()) else { continue };
        let Some(count) = prev.comment_count else { continue };
        if pr.updated_at == prev.updated_at {
            pr.comment_count = Some(count);
        } else if let Ok(full) = forge::get_json(account, token, &format!("/repos/{}/pulls/{}", pr.project_path, pr.number)) {
            let comments = full.get("comments").and_then(Value::as_u64);
            pr.comment_count = comments.map(|c| c + full.get("review_comments").and_then(Value::as_u64).unwrap_or(0));
        }
    }
    Ok(lists)
}

fn gitlab_pr(raw: &Value, approvals: Option<&Value>, pushed: &HashSet<String>) -> Option<WatchedPr> {
    let full = str_at(raw, "/references/full");
    let review = if str_at(raw, "/detailed_merge_status") == "requested_changes" {
        "changes_requested"
    } else if approvals.is_some_and(|a| {
        a.get("approved_by").and_then(Value::as_array).is_some_and(|v| !v.is_empty()) && a.get("approvals_left").and_then(Value::as_u64).unwrap_or(0) == 0
    }) {
        "approved"
    } else {
        "pending"
    };
    let ci = raw.pointer("/head_pipeline/status").and_then(Value::as_str).and_then(|s| match s {
        "success" => Some("success"),
        "failed" => Some("failure"),
        "created" | "waiting_for_resource" | "preparing" | "pending" | "running" | "scheduled" => Some("pending"),
        _ => None,
    });
    let sha = str_at(raw, "/sha");
    let created = str_at(raw, "/created_at");
    Some(WatchedPr {
        number: raw.get("iid")?.as_u64()?,
        title: str_at(raw, "/title").into(),
        project_path: full.rsplit_once('!').map(|(p, _)| p).unwrap_or("").into(),
        url: str_at(raw, "/web_url").into(),
        head_sha: sha.into(),
        updated_at: raw.get("updated_at").and_then(Value::as_str).unwrap_or(created).into(),
        comment_count: raw.get("user_notes_count").and_then(Value::as_u64),
        pushed_by_me: !sha.is_empty() && pushed.contains(sha),
        ci: ci.map(Into::into),
        review: review.into(),
    })
}

fn gitlab_lists(account: &Account, token: &str) -> Result<PrLists, String> {
    let me = &account.username;
    // Les noms d'utilisateur GitLab n'ont que [A-Za-z0-9_.-] : rien à encoder, mais rien d'autre n'est accepté.
    if me.is_empty() || !me.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c)) {
        return Err(format!("nom d'utilisateur GitLab inattendu : {me}"));
    }
    let open = format!("state=opened&per_page={PAGE_SIZE}");
    let list = |path: String| -> Result<Vec<Value>, String> {
        Ok(forge::get_json(account, token, &path)?.as_array().cloned().unwrap_or_default())
    };
    let assigned = list(format!("/merge_requests?scope=assigned_to_me&{open}"))?;
    let reviewing = list(format!("/merge_requests?scope=all&reviewer_username={me}&{open}"))?;
    let authored = list(format!("/merge_requests?scope=created_by_me&{open}"))?;
    let pushed: HashSet<String> = list("/events?action=pushed&per_page=100".into())
        .unwrap_or_default()
        .iter()
        .filter_map(|e| e.pointer("/push_data/commit_to").and_then(Value::as_str).map(Into::into))
        .collect();
    let mr_path = |raw: &Value| format!("/projects/{}/merge_requests/{}", raw.get("project_id").and_then(Value::as_u64).unwrap_or(0), raw.get("iid").and_then(Value::as_u64).unwrap_or(0));
    let approvals = |raw: &Value| forge::get_json(account, token, &format!("{}/approvals", mr_path(raw))).ok();
    let mine = authored
        .iter()
        .filter_map(|raw| {
            // Le détail donne le pipeline et l'état de relecture, absents de la liste.
            let details = forge::get_json(account, token, &mr_path(raw)).ok();
            gitlab_pr(details.as_ref().unwrap_or(raw), approvals(raw).as_ref(), &pushed)
        })
        .collect();
    let mut to_process: Vec<&Value> = Vec::new();
    let mut keys = HashSet::new();
    for raw in assigned.iter().chain(&reviewing) {
        if keys.insert((str_at(raw, "/references/full").to_string(), raw.get("iid").and_then(Value::as_u64))) {
            to_process.push(raw);
        }
    }
    let assigned = to_process.into_iter().filter_map(|raw| gitlab_pr(raw, approvals(raw).as_ref(), &pushed)).collect();
    Ok(PrLists { assigned, authored: mine })
}

// ---------------------------------------------------------------- Vérification en arrière-plan

/// Notification à afficher (par Kotlin).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Notification {
    pub id: i32,
    pub title: String,
    pub body: String,
}

/// Résultat renvoyé à la tâche Kotlin.
#[derive(Debug, Serialize)]
pub struct CheckResult {
    pub notifications: Vec<Notification>,
    /// Nom du canal de notifications, dans la langue de l'interface.
    pub channel: String,
    /// Comptes en échec (réseau, token expiré…) : le prochain passage réessaiera.
    pub errors: Vec<String>,
}

/// Une vérification : liste de chaque compte, comparée à la dernière connue ; renvoie les notifications à afficher.
/// `fetch` est injecté pour les tests ; voir [`check`].
fn check_with(dir: &Path, fetch: impl Fn(&Account, Option<&PrLists>) -> Result<PrLists, String>) -> Result<CheckResult, String> {
    let (settings, previous) = {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let state = load(dir);
        (state.settings, state.snapshots)
    };
    let Some(settings) = settings else {
        return Ok(CheckResult { notifications: Vec::new(), channel: String::new(), errors: Vec::new() });
    };
    crate::i18n::set_language(if settings.english { "en" } else { "fr" }.into());
    let accounts = AccountStore::new(dir.to_path_buf()).list()?;
    // Réseau sans verrou : le frontend peut écrire pendant ce temps.
    let mut fetched = Vec::new();
    let mut errors = Vec::new();
    for account in &accounts {
        match fetch(account, previous.get(&account.id).map(|s| &s.data)) {
            Ok(lists) => fetched.push((account, lists)),
            Err(e) => errors.push(format!("{} : {e}", account.label)),
        }
    }
    let at = now_ms();
    let notifications = update(dir, |state| {
        let mut out = Vec::new();
        if state.settings.is_none() {
            return out; // désactivée pendant la vérification
        }
        let ids: HashSet<&str> = accounts.iter().map(|a| a.id.as_str()).collect();
        state.snapshots.retain(|id, _| ids.contains(id.as_str()));
        for (account, lists) in fetched {
            // Comparée à la liste la plus récente, éventuellement écrite par le frontend pendant les requêtes.
            if let Some(prev) = state.snapshots.get(&account.id) {
                let found = filter(events(&prev.data, &lists), &settings);
                if !found.is_empty() {
                    let (title, body) = text(&found, account.provider);
                    state.next_id = state.next_id.wrapping_add(1).max(1);
                    let id = state.next_id;
                    let prs = found
                        .into_iter()
                        .map(|e| NotifiedPr { key: format!("{}|{}#{}", account.id, e.pr.project_path, e.pr.number), pr: e.pr })
                        .collect();
                    state.shown.push(Shown { id, prs });
                    out.push(Notification { id, title, body });
                }
            }
            state.snapshots.insert(account.id.clone(), Snapshot { at, data: lists });
        }
        let excess = state.shown.len().saturating_sub(MAX_SHOWN);
        state.shown.drain(..excess);
        out
    })?;
    Ok(CheckResult { notifications, channel: tr!("Activité des PR / MR", "PR / MR activity"), errors })
}

/// Vérification réelle, avec les comptes et tokens enregistrés dans `dir` (dossier de configuration de l'application).
pub fn check(dir: &Path) -> Result<CheckResult, String> {
    let store = AccountStore::new(dir.to_path_buf());
    check_with(dir, |account, previous| {
        let token = store.token(&account.id)?;
        match account.provider {
            Provider::Github => github_lists(account, &token, previous),
            Provider::Gitlab => gitlab_lists(account, &token),
        }
    })
}

/// Point d'entrée de la tâche WorkManager (`MerathonPrWatch.check` en Kotlin) : JSON `{ok: CheckResult}` ou `{error}`.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_gitclient_app_MerathonPrWatch_check<'local>(
    mut env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
    dir: jni::objects::JString<'local>,
) -> jni::sys::jstring {
    let dir: Option<String> = env.get_string(&dir).ok().map(Into::into);
    // Une panique ne doit pas traverser la frontière JNI (comportement indéfini) : elle devient une erreur.
    let result = std::panic::catch_unwind(|| match dir {
        Some(dir) => check(Path::new(&dir)),
        None => Err("dossier illisible".into()),
    })
    .unwrap_or_else(|_| Err("panique pendant la vérification".into()));
    let out = match result {
        Ok(r) => json!({ "ok": r }),
        Err(e) => json!({ "error": e }),
    };
    env.new_string(out.to_string()).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

// ---------------------------------------------------------------- Commandes du frontend

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_config_dir().map_err(|e| e.to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Active (avec ces réglages) ou désactive la vérification en arrière-plan, et (re)programme la tâche Android.
#[tauri::command]
pub async fn pr_watch_configure(app: tauri::AppHandle, settings: Option<WatchSettings>) -> Result<(), String> {
    let dir = config_dir(&app)?;
    blocking(move || {
        let minutes = settings.as_ref().map(|s| s.minutes);
        configure(&dir, settings)?;
        android::schedule(&dir, minutes)
    })
    .await
}

/// Liste « mes PR » que le frontend vient de charger.
#[tauri::command]
pub async fn pr_watch_snapshot(app: tauri::AppHandle, account_id: String, snapshot: Snapshot) -> Result<(), String> {
    let dir = config_dir(&app)?;
    blocking(move || store_snapshot(&dir, &account_id, snapshot)).await
}

#[derive(Debug, Serialize)]
pub struct WatchState {
    snapshots: HashMap<String, Snapshot>,
    shown: Vec<Shown>,
}

/// Dernières listes de la tâche et notifications qu'elle a affichées.
#[tauri::command]
pub async fn pr_watch_state(app: tauri::AppHandle) -> Result<WatchState, String> {
    let dir = config_dir(&app)?;
    blocking(move || Ok(WatchState { snapshots: snapshots(&dir), shown: shown(&dir) })).await
}

/// Retire une notification de la tâche (ses PR ont été consultées) ; sans effet pour un autre identifiant.
pub fn dismiss(app: &tauri::AppHandle, id: i32) -> Result<(), String> {
    if forget_shown(&config_dir(app)?, id)? {
        android::dismiss(id)?;
    }
    Ok(())
}

/// Appels vers `com.gitclient.app.MerathonPrWatch` (Kotlin) ; sans effet hors d'Android.
#[cfg(target_os = "android")]
mod android {
    use jni::objects::JValue;
    use std::path::Path;

    const CLASS: &str = "com.gitclient.app.MerathonPrWatch";

    pub fn schedule(dir: &Path, minutes: Option<u32>) -> Result<(), String> {
        crate::android_keystore::call_class(CLASS, |env, class, app| {
            match minutes {
                Some(minutes) => {
                    let dir = env.new_string(dir.to_string_lossy())?;
                    env.call_static_method(
                        class,
                        "schedule",
                        "(Landroid/content/Context;JLjava/lang/String;)V",
                        &[JValue::Object(app), JValue::Long(minutes.into()), JValue::Object(&dir)],
                    )?;
                }
                None => {
                    env.call_static_method(class, "cancel", "(Landroid/content/Context;)V", &[JValue::Object(app)])?;
                }
            }
            Ok(())
        })
    }

    pub fn dismiss(id: i32) -> Result<(), String> {
        crate::android_keystore::call_class(CLASS, |env, class, app| {
            env.call_static_method(class, "dismiss", "(Landroid/content/Context;I)V", &[JValue::Object(app), JValue::Int(id)]).map(|_| ())
        })
    }
}

#[cfg(not(target_os = "android"))]
mod android {
    use std::path::Path;

    pub fn schedule(_dir: &Path, _minutes: Option<u32>) -> Result<(), String> {
        Ok(())
    }

    pub fn dismiss(_id: i32) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pr(number: u64, sha: &str, updated: &str) -> WatchedPr {
        WatchedPr {
            number,
            title: format!("PR {number}"),
            project_path: "o/r".into(),
            head_sha: sha.into(),
            updated_at: updated.into(),
            review: "pending".into(),
            ..Default::default()
        }
    }

    fn settings() -> WatchSettings {
        WatchSettings { minutes: 30, opened: true, commits: true, comments: true, ci: true, review: true, english: false }
    }

    fn lists(assigned: Vec<WatchedPr>, authored: Vec<WatchedPr>) -> PrLists {
        PrLists { assigned, authored }
    }

    fn kinds(e: &[Event]) -> Vec<(u64, Vec<EventKind>)> {
        e.iter().map(|e| (e.pr.number, e.kinds.clone())).collect()
    }

    #[test]
    fn events_follow_the_frontend_rules() {
        use EventKind::*;
        let before = lists(vec![pr(1, "a", "t1"), pr(2, "b", "t1")], vec![pr(3, "c", "t1")]);
        let mut ci = pr(2, "b", "t2");
        ci.ci = Some("failure".into());
        let mut mine = pr(3, "d", "t2"); // mes commits sur ma PR : rien
        mine.review = "approved".into();
        let after = lists(vec![pr(1, "a2", "t2"), ci, pr(4, "e", "t1")], vec![mine, pr(5, "f", "t1")]);
        assert_eq!(kinds(&events(&before, &after)), vec![(1, vec![Commits]), (2, vec![CiFailure]), (4, vec![Opened]), (3, vec![Approved])]);
    }

    #[test]
    fn comments_counted_when_known_activity_otherwise() {
        let mut a = pr(1, "a", "t1");
        a.comment_count = Some(2);
        let mut b = pr(1, "a", "t2");
        b.comment_count = Some(3);
        assert_eq!(kinds(&events(&lists(vec![a.clone()], vec![]), &lists(vec![b], vec![]))), vec![(1, vec![EventKind::Comments])]);
        let c = pr(1, "a", "t2");
        assert_eq!(kinds(&events(&lists(vec![a], vec![]), &lists(vec![c], vec![]))), vec![(1, vec![EventKind::Activity])]);
    }

    #[test]
    fn pushed_by_me_and_filters() {
        let mut mine = pr(1, "b", "t2");
        mine.pushed_by_me = true;
        assert!(events(&lists(vec![pr(1, "a", "t1")], vec![]), &lists(vec![mine], vec![])).is_empty());
        let s = WatchSettings { opened: false, ..settings() };
        assert!(filter(events(&lists(vec![], vec![]), &lists(vec![pr(1, "a", "t1")], vec![])), &s).is_empty());
    }

    #[test]
    fn notification_text() {
        crate::i18n::set_language("fr".into());
        let one = vec![Event { pr: pr(9, "a", "t"), kinds: vec![EventKind::Commits, EventKind::CiSuccess] }];
        assert_eq!(text(&one, Provider::Github), ("PR #9 · PR 9".into(), "Nouveaux commits, CI passée — o/r".into()));
        let many: Vec<Event> = (1..=6).map(|n| Event { pr: pr(n, "a", "t"), kinds: vec![EventKind::Opened] }).collect();
        let (title, body) = text(&many, Provider::Gitlab);
        assert_eq!(title, "6 MR mises à jour");
        assert_eq!(body.lines().count(), 5);
        assert_eq!(body.lines().next(), Some("!1 PR 1 : nouvelle MR à traiter"));
        assert_eq!(body.lines().last(), Some("… et 2 autres"));
    }

    #[test]
    fn github_parsing() {
        let raw = json!({
            "number": 7, "title": "T", "url": "u", "updatedAt": "t", "headRefOid": "abc",
            "repository": { "nameWithOwner": "o/r" }, "reviewDecision": null,
            "latestOpinionatedReviews": { "nodes": [{ "state": "APPROVED" }] },
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "ERROR" }, "committer": { "user": { "login": "me" } } } }] }
        });
        let pr = github_pr(&raw, "me").unwrap();
        assert_eq!((pr.review.as_str(), pr.ci.as_deref(), pr.pushed_by_me), ("approved", Some("failure"), true));
        assert!(github_pr(&json!({}), "me").is_none(), "résultat de recherche qui n'est pas une PR");
    }

    #[test]
    fn gitlab_parsing() {
        let raw = json!({
            "iid": 3, "title": "T", "web_url": "u", "created_at": "c", "sha": "s", "user_notes_count": 4,
            "references": { "full": "g/sub/p!3" }, "head_pipeline": { "status": "running" }
        });
        let approvals = json!({ "approved_by": [{ "user": {} }], "approvals_left": 0 });
        let pushed = HashSet::from(["s".to_string()]);
        let pr = gitlab_pr(&raw, Some(&approvals), &pushed).unwrap();
        assert_eq!(pr.project_path, "g/sub/p");
        assert_eq!(pr.updated_at, "c");
        assert_eq!((pr.review.as_str(), pr.ci.as_deref(), pr.comment_count, pr.pushed_by_me), ("approved", Some("pending"), Some(4), true));
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("merathon-pr-watch-{}-{}", std::process::id(), now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("accounts.json"),
            r#"[{"id":"acc","provider":"github","label":"GH","base_url":"https://github.com","username":"me"}]"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn check_notifies_once_and_shares_state_with_the_frontend() {
        let dir = temp_dir();
        // Désactivée : aucune requête.
        let r = check_with(&dir, |_, _| panic!("pas de requête")).unwrap();
        assert!(r.notifications.is_empty());

        configure(&dir, Some(settings())).unwrap();
        // Première vérification sans liste de l'application : rien à comparer, la liste devient la référence.
        let first = lists(vec![pr(1, "a", "t1")], vec![]);
        assert!(check_with(&dir, |_, _| Ok(first.clone())).unwrap().notifications.is_empty());
        // Nouveaux commits : une notification, retenue pour être retirée plus tard.
        let second = lists(vec![pr(1, "b", "t2")], vec![]);
        let r = check_with(&dir, |_, prev| {
            assert_eq!(prev, Some(&first));
            Ok(second.clone())
        })
        .unwrap();
        assert_eq!(r.notifications.len(), 1);
        assert_eq!(r.notifications[0].title, "PR #1 · PR 1");
        let shown = shown(&dir);
        assert_eq!(shown[0].prs[0].key, "acc|o/r#1");
        // Même liste : plus rien.
        assert!(check_with(&dir, |_, _| Ok(second.clone())).unwrap().notifications.is_empty());

        // Une liste plus ancienne du frontend n'écrase pas celle de la tâche ; une plus récente, si.
        store_snapshot(&dir, "acc", Snapshot { at: 1, data: first.clone() }).unwrap();
        assert_eq!(snapshots(&dir)["acc"].data, second);
        store_snapshot(&dir, "acc", Snapshot { at: u64::MAX, data: first.clone() }).unwrap();
        assert_eq!(snapshots(&dir)["acc"].data, first);

        assert!(forget_shown(&dir, shown[0].id).unwrap());
        assert!(!forget_shown(&dir, shown[0].id).unwrap());

        // Erreur d'un compte : signalée, la référence reste.
        let r = check_with(&dir, |_, _| Err("hors ligne".into())).unwrap();
        assert_eq!(r.errors, vec!["GH : hors ligne".to_string()]);
        assert_eq!(snapshots(&dir)["acc"].data, first);

        // Désactivée : références oubliées, intervalle validé.
        configure(&dir, None).unwrap();
        assert!(snapshots(&dir).is_empty());
        assert!(configure(&dir, Some(WatchSettings { minutes: 5, ..settings() })).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
