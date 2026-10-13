//! Client HTTP des appels aux forges (API, OAuth).
//!
//! Les autorités de confiance sont celles de Mozilla **et** celles du système : une forge
//! auto-hébergée signée par une autorité d'entreprise (déployée par la DSI dans le magasin
//! Windows, ou dans /usr/local/share/ca-certificates sous Linux) est ainsi acceptée.

use std::sync::{Arc, OnceLock};

/// Agent partagé (connexions réutilisées, magasin de certificats chargé une seule fois).
pub fn agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT
        .get_or_init(|| ureq::AgentBuilder::new().tls_config(Arc::new(tls_config())).build())
        .clone()
}

fn tls_config() -> rustls::ClientConfig {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("protocoles TLS par défaut pris en charge par ring")
        .with_root_certificates(root_store())
        .with_no_client_auth()
}

fn root_store() -> rustls::RootCertStore {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    // Un fichier de certificat illisible dans le magasin du système n'empêche pas de charger les autres.
    let native = rustls_native_certs::load_native_certs();
    roots.add_parsable_certificates(native.certs);
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_roots_are_added_to_mozilla_ones() {
        assert!(root_store().len() > webpki_roots::TLS_SERVER_ROOTS.len());
    }

    /// Vérification manuelle d'une forge interne :
    /// `TLS_TEST_URL=https://gitlab.mon-entreprise.fr cargo test -- --ignored reaches_tls_test_url`
    #[test]
    #[ignore]
    fn reaches_tls_test_url() {
        let url = std::env::var("TLS_TEST_URL").expect("TLS_TEST_URL non défini");
        match agent().get(&url).call() {
            Ok(_) | Err(ureq::Error::Status(..)) => {}
            Err(e) => panic!("{url} : {e}"),
        }
    }
}
