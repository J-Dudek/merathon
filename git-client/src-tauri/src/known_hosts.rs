//! Lecture de `known_hosts` sans `ssh-keygen` (Android, où OpenSSH n'existe pas).
//!
//! Formats pris en charge, comme OpenSSH : hôtes en clair, listes séparées par des virgules, `[hôte]:port`, motifs `*`
//! et `?`, négation `!motif`, commentaires et marqueur `@revoked`. Les lignes `@cert-authority` sont ignorées : ni
//! libssh2 ni Merathon ne vérifient de certificat d'hôte.
//!
//! Les hôtes hachés (`|1|sel|empreinte`, `HashKnownHosts yes`) sont ignorés : sur Android, seul Merathon écrit ce
//! fichier, toujours en clair. Une telle ligne fait donc traiter l'hôte comme inconnu, ce qui mène à la validation de
//! l'empreinte, jamais à une connexion acceptée sans vérification. libgit2 (via libssh2), qui fait la vérification
//! réelle au moment de la connexion, comprend en revanche ces lignes.

use base64ct::{Base64, Encoding};

/// Réponse de `lookup` pour une clé présentée par un serveur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyStatus {
    /// L'hôte est connu avec cette clé.
    Match,
    /// L'hôte est connu avec une autre clé du même type : la connexion doit être bloquée.
    Mismatch,
    /// La clé est révoquée pour cet hôte.
    Revoked,
    /// Aucune clé de ce type pour cet hôte.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Marker {
    None,
    Revoked,
    CertAuthority,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    marker: Marker,
    /// Motifs de la première colonne ; `None` pour une ligne hachée.
    patterns: Option<Vec<String>>,
    key_type: String,
    key: Vec<u8>,
}

/// Nom de l'hôte tel qu'écrit dans `known_hosts` : `hôte` sur le port 22, `[hôte]:port` sinon.
pub fn host_field(host: &str, port: u16) -> String {
    if port == 22 { host.to_string() } else { format!("[{host}]:{port}") }
}

fn parse_line(line: &str) -> Option<Entry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut fields = line.split_whitespace();
    let mut first = fields.next()?;
    let marker = match first {
        "@revoked" => Marker::Revoked,
        "@cert-authority" => Marker::CertAuthority,
        m if m.starts_with('@') => return None,
        _ => Marker::None,
    };
    if marker != Marker::None {
        first = fields.next()?;
    }
    let key_type = fields.next()?.to_string();
    let key = Base64::decode_vec(fields.next()?).ok()?;
    let patterns = (!first.starts_with('|')).then(|| first.split(',').map(str::to_ascii_lowercase).collect());
    Some(Entry { marker, patterns, key_type, key })
}

/// Motif OpenSSH : `*` (zéro ou plusieurs caractères) et `?` (un caractère).
fn glob(pattern: &[u8], text: &[u8]) -> bool {
    match (pattern.first(), text.first()) {
        (None, None) => true,
        (Some(b'*'), _) => glob(&pattern[1..], text) || (!text.is_empty() && glob(pattern, &text[1..])),
        (Some(b'?'), Some(_)) => glob(&pattern[1..], &text[1..]),
        (Some(p), Some(t)) if p == t => glob(&pattern[1..], &text[1..]),
        _ => false,
    }
}

/// Une négation qui correspond exclut la ligne, même si un autre motif correspond.
fn matches_host(patterns: &[String], target: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if glob(negated.as_bytes(), target.as_bytes()) {
                return false;
            }
        } else if glob(pattern.as_bytes(), target.as_bytes()) {
            positive = true;
        }
    }
    positive
}

/// Lignes en clair, hors autorités de certification, qui désignent cet hôte.
fn entries_for<'a>(content: &'a str, host: &str, port: u16) -> impl Iterator<Item = Entry> + 'a {
    let target = host_field(&host.to_ascii_lowercase(), port);
    content.lines().filter_map(parse_line).filter(move |e| {
        e.marker != Marker::CertAuthority && e.patterns.as_deref().is_some_and(|p| matches_host(p, &target))
    })
}

/// Équivalent de `ssh-keygen -F` : l'hôte a-t-il au moins une clé (non révoquée) ?
pub fn is_known(content: &str, host: &str, port: u16) -> bool {
    entries_for(content, host, port).any(|e| e.marker == Marker::None)
}

/// Vérifie la clé `key` (format binaire SSH) de type `key_type` présentée par `host:port`.
/// Une révocation l'emporte sur tout ; une autre clé du même type signale un changement de clé.
pub fn lookup(content: &str, host: &str, port: u16, key_type: &str, key: &[u8]) -> HostKeyStatus {
    let mut matched = false;
    let mut other_key = false;
    for entry in entries_for(content, host, port) {
        let same_key = entry.key == key;
        match entry.marker {
            Marker::Revoked if same_key => return HostKeyStatus::Revoked,
            Marker::None if same_key => matched = true,
            Marker::None if entry.key_type == key_type => other_key = true,
            _ => {}
        }
    }
    match (matched, other_key) {
        (true, _) => HostKeyStatus::Match,
        (false, true) => HostKeyStatus::Mismatch,
        (false, false) => HostKeyStatus::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ED: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    // Autre clé ed25519, valide en base64 : seul l'octet final change.
    const ED_OTHER: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJm";
    const ECDSA: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=";

    fn key(b64: &str) -> Vec<u8> {
        Base64::decode_vec(b64).unwrap()
    }

    #[test]
    fn plain_host_and_port_syntax() {
        assert_eq!(host_field("github.com", 22), "github.com");
        assert_eq!(host_field("git.corp", 2222), "[git.corp]:2222");
        let file = format!("github.com ssh-ed25519 {ED}\n[git.corp]:2222 ssh-ed25519 {ED}\n");
        assert!(is_known(&file, "github.com", 22));
        assert!(is_known(&file, "GitHub.com", 22), "le nom d'hôte ne tient pas compte de la casse");
        assert!(!is_known(&file, "github.com", 2222), "un autre port est un autre hôte");
        assert!(is_known(&file, "git.corp", 2222));
        assert!(!is_known(&file, "git.corp", 22));
    }

    #[test]
    fn comma_separated_hosts_comments_and_blank_lines() {
        let file = format!("# commentaire\n\n   \ngithub.com,140.82.121.4 ssh-ed25519 {ED} un commentaire\n");
        assert!(is_known(&file, "github.com", 22));
        assert!(is_known(&file, "140.82.121.4", 22));
        assert!(!is_known(&file, "gitlab.com", 22));
        assert_eq!(lookup(&file, "140.82.121.4", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Match);
    }

    #[test]
    fn wildcards_and_negation() {
        let file = format!("*.corp.io,!secret.corp.io ssh-ed25519 {ED}\ngit?.lan ssh-ed25519 {ED}\n");
        assert!(is_known(&file, "git.corp.io", 22));
        assert!(!is_known(&file, "secret.corp.io", 22), "la négation exclut la ligne");
        assert!(!is_known(&file, "corp.io", 22));
        assert!(is_known(&file, "git1.lan", 22));
        assert!(!is_known(&file, "git12.lan", 22));
    }

    #[test]
    fn hashed_lines_are_ignored() {
        let file = format!("|1|F1E1KeoE/eEWhi10WpGv4OdiO6Y=|3988QV0VE8wmZL7suNrYQLITLCg= ssh-ed25519 {ED}\n");
        assert!(!is_known(&file, "github.com", 22));
        assert_eq!(lookup(&file, "github.com", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Unknown);
    }

    #[test]
    fn same_key_matches_and_another_key_of_the_same_type_is_a_mismatch() {
        let file = format!("github.com ssh-ed25519 {ED}\n");
        assert_eq!(lookup(&file, "github.com", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Match);
        assert_eq!(lookup(&file, "github.com", 22, "ssh-ed25519", &key(ED_OTHER)), HostKeyStatus::Mismatch);
        // Clé d'un autre type : pas encore enregistrée, et non un changement (comme libssh2).
        assert_eq!(lookup(&file, "github.com", 22, "ecdsa-sha2-nistp256", &key(ECDSA)), HostKeyStatus::Unknown);
        assert_eq!(lookup(&file, "gitlab.com", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Unknown);
    }

    #[test]
    fn revoked_key_wins_and_does_not_count_as_known() {
        let file = format!("@revoked github.com ssh-ed25519 {ED}\ngithub.com ssh-ed25519 {ED}\n");
        assert_eq!(lookup(&file, "github.com", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Revoked);
        let only_revoked = format!("@revoked * ssh-ed25519 {ED}\n");
        assert!(!is_known(&only_revoked, "github.com", 22));
        assert_eq!(lookup(&only_revoked, "github.com", 22, "ssh-ed25519", &key(ED)), HostKeyStatus::Revoked);
        assert_eq!(lookup(&only_revoked, "github.com", 22, "ssh-ed25519", &key(ED_OTHER)), HostKeyStatus::Unknown);
    }

    #[test]
    fn cert_authorities_and_malformed_lines_are_ignored() {
        let file = format!(
            "@cert-authority *.corp ssh-ed25519 {ED}\n@inconnu x ssh-ed25519 {ED}\ngithub.com ssh-ed25519\ngithub.com ssh-ed25519 !!pas-du-base64!!\n"
        );
        assert!(!is_known(&file, "git.corp", 22));
        assert!(!is_known(&file, "github.com", 22));
    }
}
