//! Profils Git : une configuration par dossier, avec le mécanisme natif `includeIf "gitdir:…"` de `~/.gitconfig`.
//!
//! Merathon ne garde aucune copie : les profils sont lus dans la configuration de Git, et `git` en ligne de commande
//! suit donc les mêmes règles. Seuls les fichiers `~/.gitconfig-merathon-*` et leur ligne `includeIf` sont modifiés ;
//! les règles écrites à la main sont lues, jamais touchées.

use std::fs;
use std::path::{Component, Path, PathBuf};
use git2::{Config, ConfigLevel, ErrorCode, Repository};
use serde::{Deserialize, Serialize};
use super::error::GitError;

const FILE_PREFIX: &str = ".gitconfig-merathon-";

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct GitProfile {
    /// Vide pour une règle écrite à la main, qui n'est pas modifiable ici.
    pub id: String,
    pub label: String,
    pub dir: String,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub account_id: Option<String>,
    /// Chemin de la clé SSH du dossier ; absente : clés par défaut.
    pub ssh_key: Option<String>,
    pub managed: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ProfileInput {
    /// Absent : nouveau profil.
    pub id: Option<String>,
    pub label: String,
    pub dir: String,
    pub user_name: String,
    pub user_email: String,
    pub account_id: Option<String>,
    pub ssh_key: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProfilesInfo {
    pub profiles: Vec<GitProfile>,
    /// Règles que Merathon ne sait pas associer à un dossier (`onbranch:`, motifs…), conservées telles quelles.
    pub other_rules: Vec<String>,
}

/// D'où vient l'e-mail utilisé par un dépôt.
#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IdentityOrigin {
    /// `.git/config` du dépôt : passe avant le profil.
    Repo,
    /// Fichier inclus par une règle `includeIf`.
    Profile,
    /// `~/.gitconfig` lui-même, ou la configuration du système.
    Global,
    None,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct IdentityStatus {
    pub name: Option<String>,
    pub email: Option<String>,
    pub origin: IdentityOrigin,
    pub profile: Option<GitProfile>,
    /// Le dépôt est dans un profil, mais ses commits ne seraient pas signés avec l'e-mail du profil.
    pub mismatch: bool,
    /// Des profils existent, mais aucun ne couvre ce dépôt.
    pub outside: bool,
}

pub fn home_dir() -> Result<PathBuf, GitError> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| GitError::Other(tr!("Dossier personnel introuvable", "Home folder not found")))
}

fn invalid(message: impl Into<String>) -> GitError {
    GitError::Conflict(message.into())
}

fn global_file(home: &Path) -> PathBuf {
    home.join(".gitconfig")
}

/// Chemin écrit dans la configuration : séparateurs `/`, compris par Git sur tous les systèmes.
fn slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Retire le préfixe `\\?\` de `canonicalize` sous Windows, que `gitdir:` ne comprend pas.
/// `\\?\UNC\serveur\partage` (dépôt WSL ouvert depuis Windows) redevient `\\serveur\partage`.
fn without_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

fn canonical(path: &Path) -> Option<PathBuf> {
    Some(PathBuf::from(without_verbatim_prefix(&path.canonicalize().ok()?.to_string_lossy())))
}

/// Forme canonique du plus proche parent existant : la cible d'un clone n'existe pas encore.
fn resolve_existing(path: &Path) -> Option<PathBuf> {
    let mut rest = Vec::new();
    let mut current = path;
    loop {
        if let Some(found) = canonical(current) {
            return Some(rest.iter().rev().fold(found, |p: PathBuf, name: &&std::ffi::OsStr| p.join(name)));
        }
        rest.push(current.file_name()?);
        current = current.parent()?;
    }
}

/// Dossier d'une condition `gitdir:~/dev/pro/`. Seule cette forme est gérée ; les motifs restent dans `other_rules`.
fn condition_dir(condition: &str, home: &Path) -> Option<PathBuf> {
    let raw = condition.strip_prefix("gitdir:").or_else(|| condition.strip_prefix("gitdir/i:"))?;
    if !raw.ends_with('/') || raw.contains(['*', '?', '[']) {
        return None;
    }
    let path = raw.strip_prefix("~/").map_or_else(|| PathBuf::from(raw), |rest| home.join(rest));
    path.is_absolute().then_some(path)
}

fn condition_for(dir: &Path) -> String {
    let prefix = if cfg!(windows) { "gitdir/i" } else { "gitdir" };
    format!("{prefix}:{}/", slashes(dir).trim_end_matches('/'))
}

/// Paires (condition, fichier inclus) de `~/.gitconfig`, dans l'ordre du fichier.
fn include_rules(home: &Path) -> Result<Vec<(String, String)>, GitError> {
    let file = global_file(home);
    if !file.exists() {
        return Ok(Vec::new());
    }
    let config = Config::open(&file)?;
    let mut rules = Vec::new();
    let mut entries = config.entries(Some("includeif\\..*\\.path"))?;
    while let Some(entry) = entries.next() {
        let entry = entry?;
        let (Ok(name), Ok(value)) = (entry.name(), entry.value()) else { continue };
        let Some(condition) = name.strip_prefix("includeif.").and_then(|n| n.strip_suffix(".path")) else { continue };
        rules.push((condition.to_string(), value.to_string()));
    }
    Ok(rules)
}

fn included_path(value: &str, home: &Path) -> PathBuf {
    match value.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        // Un chemin relatif est relatif au fichier qui l'inclut.
        None if Path::new(value).is_absolute() => PathBuf::from(value),
        None => home.join(value),
    }
}

fn read_string(config: &Config, key: &str) -> Option<String> {
    config.get_string(key).ok().filter(|v| !v.is_empty())
}

/// Clé désignée par `core.sshCommand` : `ssh -i "chemin" …`, avec ou sans guillemets.
pub(crate) fn key_from_ssh_command(command: &str, home: &Path) -> Option<PathBuf> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut quote, mut started) = (None, false);
    for c in command.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started || !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                started = false;
            }
            (None, c) => word.push(c),
        }
    }
    if started || !word.is_empty() {
        words.push(word);
    }
    let raw = words.iter().enumerate().skip(1).find_map(|(i, w)| match w.as_str() {
        "-i" => words.get(i + 1).cloned(),
        other => other.strip_prefix("-i").filter(|rest| !rest.is_empty()).map(str::to_string),
    })?;
    Some(raw.strip_prefix("~/").map_or_else(|| PathBuf::from(&raw), |rest| home.join(rest)))
}

fn read_profile(condition: &str, value: &str, home: &Path) -> Option<GitProfile> {
    let dir = condition_dir(condition, home)?;
    let file = included_path(value, home);
    let file_name = file.file_name()?.to_string_lossy().to_string();
    let id = file_name.strip_prefix(FILE_PREFIX).map(str::to_string);
    let config = if file.exists() { Config::open(&file).ok()? } else { Config::new().ok()? };
    Some(GitProfile {
        managed: id.is_some(),
        label: read_string(&config, "merathon.label").unwrap_or_else(|| file_name.clone()),
        id: id.unwrap_or_default(),
        dir: slashes(&dir).trim_end_matches('/').to_string(),
        user_name: read_string(&config, "user.name"),
        user_email: read_string(&config, "user.email"),
        account_id: read_string(&config, "merathon.account"),
        ssh_key: read_string(&config, "core.sshcommand").and_then(|c| key_from_ssh_command(&c, home)).map(|k| slashes(&k)),
    })
}

pub fn list_profiles(home: &Path) -> Result<ProfilesInfo, GitError> {
    let mut profiles = Vec::new();
    let mut other_rules = Vec::new();
    for (condition, value) in include_rules(home)? {
        match read_profile(&condition, &value, home) {
            Some(profile) => profiles.push(profile),
            None => other_rules.push(format!("{condition} → {value}")),
        }
    }
    Ok(ProfilesInfo { profiles, other_rules })
}

/// Profil qui couvre ce chemin, comme le ferait Git : le dernier du fichier l'emporte.
fn matching(profiles: &[GitProfile], location: &Path) -> Option<GitProfile> {
    let location = resolve_existing(location)?;
    profiles.iter().rev().find(|p| resolve_existing(Path::new(&p.dir)).is_some_and(|dir| location.starts_with(dir))).cloned()
}

/// Clé SSH du profil qui couvre ce chemin (dépôt, ou cible d'un clone). Lue uniquement dans `~/.gitconfig` et ses
/// inclusions : la configuration d'un dépôt ne peut pas désigner de fichier.
pub fn ssh_key_for(location: &Path) -> Option<PathBuf> {
    let home = home_dir().ok()?;
    let info = list_profiles(&home).ok()?;
    matching(&info.profiles, location)?.ssh_key.map(PathBuf::from).filter(|key| key.is_file())
}

fn slug(label: &str) -> String {
    let raw: String = label.to_lowercase().chars().map(|c| match c {
        'à' | 'â' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'î' | 'ï' => 'i',
        'ô' | 'ö' => 'o',
        'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        c if c.is_ascii_alphanumeric() => c,
        _ => '-',
    }).collect();
    let trimmed = raw.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if trimmed.is_empty() { "profil".to_string() } else { trimmed }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn profile_file(home: &Path, id: &str) -> PathBuf {
    home.join(format!("{FILE_PREFIX}{id}"))
}

fn unique_id(home: &Path, label: &str) -> String {
    let base = slug(label);
    if !profile_file(home, &base).exists() {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|id| !profile_file(home, id).exists()).expect("suite infinie")
}

/// Le dossier est écrit dans une condition : ni motif (il changerait de sens), ni caractère qui casserait la ligne.
fn validate(home: &Path, input: &ProfileInput, others: &[GitProfile]) -> Result<PathBuf, GitError> {
    if input.label.trim().is_empty() {
        return Err(invalid(tr!("Donne un nom au profil", "Give the profile a name")));
    }
    if input.user_name.trim().is_empty() || input.user_name.contains(['\n', '\r']) {
        return Err(invalid(tr!("Indique le nom à utiliser dans les commits", "Enter the name to use in commits")));
    }
    let email = input.user_email.trim();
    if !email.contains('@') || email.contains(['\n', '\r', ' ']) {
        return Err(invalid(tr!("Indique une adresse e-mail valide", "Enter a valid email address")));
    }
    let requested = without_verbatim_prefix(&input.dir);
    if requested.contains(['*', '?', '[', '"', '\n', '\r']) {
        return Err(invalid(tr!("Ce nom de dossier n'est pas utilisable dans une règle Git : {}", "This folder name cannot be used in a Git rule: {}", input.dir)));
    }
    let dir = canonical(Path::new(&requested)).filter(|d| d.is_dir()).ok_or_else(|| invalid(tr!("Dossier introuvable : {}", "Folder not found: {}", input.dir)))?;
    if dir.parent().is_none() || canonical(home).is_some_and(|h| h == dir) {
        return Err(invalid(tr!("Choisis un dossier de projets : le dossier personnel entier couvrirait tous tes dépôts", "Choose a projects folder: the entire home folder would cover all your repositories")));
    }
    for other in others {
        let Some(other_dir) = resolve_existing(Path::new(&other.dir)) else { continue };
        if other_dir == dir {
            return Err(invalid(tr!("Le profil « {} » couvre déjà ce dossier", "Profile \"{}\" already covers this folder", other.label)));
        }
        if other_dir.starts_with(&dir) || dir.starts_with(&other_dir) {
            return Err(invalid(tr!("Ce dossier chevauche celui du profil « {} » ({})", "This folder overlaps that of profile \"{}\" ({})", other.label, other.dir)));
        }
    }
    if let Some(key) = &input.ssh_key {
        let key = ssh_key_path(key)?;
        if !Path::new(&key).is_file() {
            return Err(invalid(tr!("Clé SSH introuvable : {key}", "SSH key not found: {key}")));
        }
    }
    Ok(dir)
}

/// Chemin de clé tel qu'il sera écrit dans `core.sshCommand` : séparateurs `/` (Windows), et aucun caractère que le
/// shell lancé par Git interpréterait entre guillemets.
fn ssh_key_path(key: &str) -> Result<String, GitError> {
    let path = slashes(Path::new(&without_verbatim_prefix(key)));
    if path.contains(['"', '$', '`', '\\', '\n', '\r']) {
        return Err(invalid(tr!("Chemin de clé SSH non utilisable : {key}", "SSH key path not usable: {key}")));
    }
    Ok(path)
}

/// `~/.gitconfig` avant la première écriture de Merathon, puis avant chacune : rien n'est perdu en cas de surprise.
fn backup_global(home: &Path) -> Result<(), GitError> {
    let file = global_file(home);
    if !file.exists() {
        return Ok(());
    }
    let original = home.join(".gitconfig.merathon-original");
    if !original.exists() {
        fs::copy(&file, &original)?;
    }
    fs::copy(&file, home.join(".gitconfig.merathon-backup"))?;
    Ok(())
}

fn set_or_remove(config: &mut Config, key: &str, value: Option<&str>) -> Result<(), GitError> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => config.set_str(key, v)?,
        None => match config.remove(key) {
            Ok(()) => {}
            Err(e) if e.code() == ErrorCode::NotFound => {}
            Err(e) => return Err(e.into()),
        },
    }
    Ok(())
}

fn remove_rule(global: &mut Config, condition: &str) -> Result<(), GitError> {
    match global.remove(&format!("includeIf.{condition}.path")) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn save_profile(home: &Path, input: &ProfileInput) -> Result<GitProfile, GitError> {
    let rules = include_rules(home)?;
    let profiles = list_profiles(home)?.profiles;
    if let Some(id) = &input.id {
        if !valid_id(id) || !profile_file(home, id).exists() {
            return Err(invalid(tr!("Profil introuvable : {id}", "Profile not found: {id}")));
        }
    }
    let others: Vec<GitProfile> = profiles.iter().filter(|p| Some(&p.id) != input.id.as_ref() || !p.managed).cloned().collect();
    let dir = validate(home, input, &others)?;
    backup_global(home)?;

    let id = input.id.clone().unwrap_or_else(|| unique_id(home, &input.label));
    let file = profile_file(home, &id);
    {
        let mut config = Config::open(&file)?;
        config.set_str("merathon.label", input.label.trim())?;
        config.set_str("user.name", input.user_name.trim())?;
        config.set_str("user.email", input.user_email.trim())?;
        set_or_remove(&mut config, "merathon.account", input.account_id.as_deref())?;
        let command = input.ssh_key.as_deref().map(ssh_key_path).transpose()?.map(|key| format!("ssh -i \"{key}\" -o IdentitiesOnly=yes"));
        set_or_remove(&mut config, "core.sshCommand", command.as_deref())?;
    }

    let mut global = Config::open(&global_file(home))?;
    let target = slashes(&file);
    let condition = condition_for(&dir);
    for (old, value) in &rules {
        if included_path(value, home) == file && *old != condition {
            remove_rule(&mut global, old)?;
        }
    }
    global.set_str(&format!("includeIf.{condition}.path"), &target)?;
    read_profile(&condition, &target, home).ok_or_else(|| GitError::Other(tr!("Profil enregistré mais illisible", "Profile saved but unreadable")))
}

pub fn delete_profile(home: &Path, id: &str) -> Result<(), GitError> {
    if !valid_id(id) {
        return Err(invalid(tr!("Profil introuvable : {id}", "Profile not found: {id}")));
    }
    let file = profile_file(home, id);
    backup_global(home)?;
    let mut global = Config::open(&global_file(home))?;
    for (condition, value) in include_rules(home)? {
        if included_path(&value, home) == file {
            remove_rule(&mut global, &condition)?;
        }
    }
    if file.exists() {
        fs::remove_file(&file)?;
    }
    Ok(())
}

fn email_origin(config: &Config) -> IdentityOrigin {
    let Ok(entry) = config.get_entry("user.email") else { return IdentityOrigin::None };
    match entry.level() {
        ConfigLevel::Local | ConfigLevel::Worktree | ConfigLevel::App => IdentityOrigin::Repo,
        ConfigLevel::Global if entry.include_depth() > 0 => IdentityOrigin::Profile,
        _ => IdentityOrigin::Global,
    }
}

pub fn identity_status(home: &Path, repo: &Repository) -> Result<IdentityStatus, GitError> {
    let mut config = repo.config()?;
    let origin = email_origin(&config);
    let snapshot = config.snapshot()?;
    let name = read_string(&snapshot, "user.name");
    let email = read_string(&snapshot, "user.email");
    let profiles = list_profiles(home)?.profiles;
    let profile = matching(&profiles, repo.path());
    let mismatch = profile.as_ref().and_then(|p| p.user_email.as_deref()).is_some_and(|expected| {
        email.as_deref().is_none_or(|e| !e.eq_ignore_ascii_case(expected))
    });
    let outside = profile.is_none() && !profiles.is_empty();
    Ok(IdentityStatus { name, email, origin, profile, mismatch, outside })
}

/// Retire le nom et l'e-mail propres au dépôt : celui-ci reprend ceux de son profil.
pub fn clear_local_identity(repo: &Repository) -> Result<(), GitError> {
    let mut config = repo.config()?.open_level(ConfigLevel::Local)?;
    for key in ["user.name", "user.email"] {
        set_or_remove(&mut config, key, None)?;
    }
    Ok(())
}

/// Un chemin ne doit pas pouvoir sortir de son dossier : utilisé pour les noms de clés reçus de l'interface.
pub(crate) fn is_plain_file_name(name: &str) -> bool {
    let mut parts = Path::new(name).components();
    matches!((parts.next(), parts.next()), (Some(Component::Normal(_)), None)) && !name.contains(['/', '\\'])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    struct Poste { _tmp: TempDir, home: PathBuf, projets: PathBuf }

    fn poste() -> Poste {
        let tmp = TempDir::new().unwrap();
        let home = canonical(tmp.path()).unwrap().join("home");
        let projets = home.join("dev");
        fs::create_dir_all(projets.join("pro/app")).unwrap();
        fs::create_dir_all(projets.join("perso/site")).unwrap();
        Poste { _tmp: tmp, home, projets }
    }

    fn input(p: &Poste, label: &str, dir: &str, email: &str) -> ProfileInput {
        ProfileInput {
            id: None,
            label: label.into(),
            dir: p.projets.join(dir).to_string_lossy().to_string(),
            user_name: format!("Camille {label}"),
            user_email: email.into(),
            account_id: None,
            ssh_key: None,
        }
    }

    /// Le vrai `git`, dans ce faux dossier personnel : c'est lui la référence.
    fn git(p: &Poste, cwd: &Path, args: &[&str]) -> String {
        let out = Command::new("git").current_dir(cwd).env("HOME", &p.home).env("XDG_CONFIG_HOME", p.home.join(".config"))
            .env("GIT_CONFIG_NOSYSTEM", "1").args(args).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn git_applies_each_profile_to_its_folder_only() {
        let p = poste();
        fs::write(global_file(&p.home), "[user]\n\tname = Global\n\temail = global@example.com\n# commentaire gardé\n").unwrap();
        save_profile(&p.home, &input(&p, "Pro", "pro", "camille@pro.example")).unwrap();
        save_profile(&p.home, &input(&p, "Perso", "perso", "camille@perso.example")).unwrap();
        for (dir, _) in [("pro/app", ""), ("perso/site", "")] {
            git(&p, &p.projets.join(dir), &["init", "-q"]);
        }
        fs::create_dir_all(p.home.join("autre")).unwrap();
        git(&p, &p.home.join("autre"), &["init", "-q"]);

        assert_eq!(git(&p, &p.projets.join("pro/app"), &["config", "user.email"]), "camille@pro.example");
        assert_eq!(git(&p, &p.projets.join("perso/site"), &["config", "user.email"]), "camille@perso.example");
        assert_eq!(git(&p, &p.home.join("autre"), &["config", "user.email"]), "global@example.com");
        assert!(fs::read_to_string(global_file(&p.home)).unwrap().contains("# commentaire gardé"));
    }

    #[test]
    fn lists_what_it_wrote_and_keeps_hand_written_rules() {
        let p = poste();
        fs::write(p.home.join(".gitconfig-main"), "[user]\n\temail = main@example.com\n").unwrap();
        fs::write(global_file(&p.home), "[includeIf \"gitdir:~/dev/perso/\"]\n\tpath = ~/.gitconfig-main\n[includeIf \"onbranch:main\"]\n\tpath = ~/.gitconfig-main\n").unwrap();
        let saved = save_profile(&p.home, &input(&p, "Mon Pro !", "pro", "camille@pro.example")).unwrap();
        assert_eq!(saved.id, "mon-pro");
        assert!(saved.managed);

        let info = list_profiles(&p.home).unwrap();
        assert_eq!(info.profiles.len(), 2);
        let manual = info.profiles.iter().find(|x| !x.managed).unwrap();
        assert_eq!(manual.user_email.as_deref(), Some("main@example.com"));
        assert!(manual.dir.ends_with("/dev/perso"));
        assert_eq!(info.other_rules, ["onbranch:main → ~/.gitconfig-main"]);

        delete_profile(&p.home, "mon-pro").unwrap();
        let info = list_profiles(&p.home).unwrap();
        assert_eq!(info.profiles.len(), 1);
        assert!(!p.home.join(".gitconfig-merathon-mon-pro").exists());
        assert!(fs::read_to_string(global_file(&p.home)).unwrap().contains("gitconfig-main"));
    }

    #[test]
    fn moving_a_profile_replaces_its_rule() {
        let p = poste();
        let saved = save_profile(&p.home, &input(&p, "Pro", "pro", "a@b.c")).unwrap();
        let mut moved = input(&p, "Pro", "perso", "a@b.c");
        moved.id = Some(saved.id);
        save_profile(&p.home, &moved).unwrap();
        let info = list_profiles(&p.home).unwrap();
        assert_eq!(info.profiles.len(), 1);
        assert!(info.profiles[0].dir.ends_with("/dev/perso"));
    }

    #[test]
    fn refuses_bad_folders_and_values() {
        let p = poste();
        save_profile(&p.home, &input(&p, "Pro", "pro", "a@b.c")).unwrap();
        let cases = [
            input(&p, "Doublon", "pro", "a@b.c"),
            input(&p, "Dedans", "pro/app", "a@b.c"),
            input(&p, "Absent", "nulle-part", "a@b.c"),
            input(&p, "Mail", "perso", "pas-une-adresse"),
            input(&p, "", "perso", "a@b.c"),
            ProfileInput { dir: p.home.to_string_lossy().to_string(), ..input(&p, "Maison", "perso", "a@b.c") },
            ProfileInput { dir: format!("{}/**", p.projets.display()), ..input(&p, "Motif", "perso", "a@b.c") },
            ProfileInput { ssh_key: Some("/nulle/part".into()), ..input(&p, "Clé", "perso", "a@b.c") },
            ProfileInput { id: Some("../../etc".into()), ..input(&p, "Id", "perso", "a@b.c") },
        ];
        for case in &cases {
            assert!(save_profile(&p.home, case).is_err(), "{case:?}");
        }
        assert_eq!(list_profiles(&p.home).unwrap().profiles.len(), 1);
        assert!(delete_profile(&p.home, "../.gitconfig").is_err());
    }

    #[test]
    fn backs_up_the_global_file_before_writing() {
        let p = poste();
        fs::write(global_file(&p.home), "[user]\n\tname = Avant\n").unwrap();
        save_profile(&p.home, &input(&p, "Pro", "pro", "a@b.c")).unwrap();
        save_profile(&p.home, &input(&p, "Perso", "perso", "a@b.c")).unwrap();
        assert_eq!(fs::read_to_string(p.home.join(".gitconfig.merathon-original")).unwrap(), "[user]\n\tname = Avant\n");
        assert!(fs::read_to_string(p.home.join(".gitconfig.merathon-backup")).unwrap().contains("gitconfig-merathon-pro"));
    }

    #[test]
    fn stores_the_key_as_an_ssh_command_understood_by_git() {
        let p = poste();
        let key = p.home.join(".ssh/cle pro");
        fs::create_dir_all(key.parent().unwrap()).unwrap();
        fs::write(&key, "x").unwrap();
        let saved = save_profile(&p.home, &ProfileInput { ssh_key: Some(key.to_string_lossy().to_string()), ..input(&p, "Pro", "pro", "a@b.c") }).unwrap();
        assert_eq!(saved.ssh_key, Some(slashes(&key)));
        git(&p, &p.projets.join("pro/app"), &["init", "-q"]);
        let command = git(&p, &p.projets.join("pro/app"), &["config", "core.sshCommand"]);
        assert_eq!(command, format!("ssh -i \"{}\" -o IdentitiesOnly=yes", slashes(&key)));

        let info = list_profiles(&p.home).unwrap();
        // Les sous-dossiers et la cible d'un clone (pas encore créée) sont couverts ; le dossier voisin non.
        assert!(matching(&info.profiles, &p.projets.join("pro/nouveau/depot")).is_some());
        assert!(matching(&info.profiles, &p.projets.join("pro-bis/depot")).is_none());
    }

    /// Chemins Windows, vérifiables sur tous les systèmes : une clé de `~/.ssh` y contient des `\\`.
    #[test]
    fn accepts_windows_paths_for_folders_and_keys() {
        assert_eq!(without_verbatim_prefix(r"\\?\C:\Users\a\dev"), r"C:\Users\a\dev");
        assert_eq!(without_verbatim_prefix(r"\\?\UNC\wsl.localhost\Ubuntu\dev"), r"\\wsl.localhost\Ubuntu\dev");
        assert_eq!(without_verbatim_prefix("/home/a/dev"), "/home/a/dev");

        assert_eq!(ssh_key_path(r"C:\Users\a\.ssh\id_pro").unwrap(), "C:/Users/a/.ssh/id_pro");
        assert_eq!(ssh_key_path(r"\\?\C:\Users\a\.ssh\id_pro").unwrap(), "C:/Users/a/.ssh/id_pro");
        assert_eq!(ssh_key_path("/home/a/.ssh/cle pro").unwrap(), "/home/a/.ssh/cle pro");
        for bad in ["/a/$(reboot)", "/a/`reboot`", "/a/\"b", "/a/b\nc"] {
            assert!(ssh_key_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_the_key_of_an_ssh_command() {
        let home = Path::new("/h");
        for (command, expected) in [
            ("ssh -i ~/.ssh/pro", Some("/h/.ssh/pro")),
            ("ssh -i \"/a b/c\" -o IdentitiesOnly=yes", Some("/a b/c")),
            ("ssh -o X=y -i '/a/c'", Some("/a/c")),
            ("ssh -i/a/c", Some("/a/c")),
            ("ssh -o IdentitiesOnly=yes", None),
            ("ssh -i", None),
        ] {
            assert_eq!(key_from_ssh_command(command, home).as_deref(), expected.map(Path::new), "{command}");
        }
    }

    #[test]
    fn accepts_only_plain_file_names() {
        for ok in ["id_ed25519", "id_ed25519_pro"] {
            assert!(is_plain_file_name(ok), "{ok}");
        }
        for bad in ["", "..", ".", "../x", "a/b", "a\\b", "/etc/passwd"] {
            assert!(!is_plain_file_name(bad), "{bad}");
        }
    }

    #[test]
    fn slug_gives_safe_names() {
        assert_eq!(slug("GitLab Pro (self-hosted)"), "gitlab-pro-self-hosted");
        assert_eq!(slug("!!!"), "profil");
        assert_eq!(slug("Client Été"), "client-ete");
        assert!(valid_id(&slug("Été 2026")));
    }
}
