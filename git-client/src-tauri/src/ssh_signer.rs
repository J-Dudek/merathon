//! Authentification SSH par une clé qui ne sort jamais de son coffre (piste 1 de l'issue #38 : Android Keystore).
//!
//! libssh2 n'a pas besoin de la clé privée : `git_credential_ssh_custom_new` lui donne la clé publique et un rappel qui
//! signe les données de l'authentification. `git2` n'expose pas ce constructeur, d'où le FFI ci-dessous.
//!
//! L'algorithme est ECDSA P-256 (`ecdsa-sha2-nistp256`) : c'est le seul que l'Android Keystore propose sur toutes les
//! versions prises en charge (`minSdk = 24` ; Ed25519 n'y arrive qu'avec Android 13), et GitHub, GitLab et OpenSSH
//! l'acceptent. Le coffre signe en `SHA256withECDSA` et rend une signature DER ; elle est convertie ici au format SSH.
//!
//! Ce module ne connaît pas le Keystore : `android_keystore.rs` fournit l'implémentation de `SshSigner` pour Android.
//! Les tests en fournissent une logicielle (crate `ring`) et s'authentifient pour de vrai auprès d'un serveur OpenSSH
//! local.

use std::ffi::{c_char, c_int, c_uchar, c_void, CString};
use std::cell::Cell;
use std::sync::{Arc, Mutex};

use base64ct::{Base64, Encoding};
use git2::{Binding, Cred};

pub const ALGORITHM: &str = "ecdsa-sha2-nistp256";
const CURVE: &str = "nistp256";
/// En-tête DER d'une `SubjectPublicKeyInfo` P-256 non compressée (`PublicKey.getEncoded()` côté Android).
const P256_SPKI_PREFIX: [u8; 26] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
    0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
];
/// Point non compressé : `04 || X || Y`.
const P256_POINT_LEN: usize = 65;

/// Clé conservée hors de portée de l'application (Android Keystore) : elle signe, elle ne se lit pas.
pub trait SshSigner: Send + Sync {
    /// Point public P-256 non compressé (65 octets, `04 || X || Y`).
    fn public_point(&self) -> Vec<u8>;
    /// Signature `SHA256withECDSA` de `data`, encodée en DER. Peut attendre la confirmation de l'utilisateur ;
    /// une erreur (confirmation refusée, clé invalidée…) arrête l'authentification avec ce message.
    fn sign(&self, data: &[u8]) -> Result<Vec<u8>, String>;
}

/// Point public extrait de la `SubjectPublicKeyInfo` DER d'une clé P-256.
pub fn point_from_spki(der: &[u8]) -> Result<Vec<u8>, String> {
    match der.strip_prefix(&P256_SPKI_PREFIX[..]) {
        Some(point) if point.len() == P256_POINT_LEN && point[0] == 0x04 => Ok(point.to_vec()),
        _ => Err(tr!("Clé publique de l'appareil non reconnue (P-256 attendue)", "Device public key not recognized (P-256 expected)")),
    }
}

fn put_string(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

/// Clé publique au format binaire SSH (RFC 5656) : `string type, string courbe, string point`.
pub fn public_key_blob(point: &[u8]) -> Result<Vec<u8>, String> {
    if point.len() != P256_POINT_LEN || point[0] != 0x04 {
        return Err(tr!("Clé publique de l'appareil non reconnue (P-256 attendue)", "Device public key not recognized (P-256 expected)"));
    }
    let mut blob = Vec::with_capacity(4 + ALGORITHM.len() + 4 + CURVE.len() + 4 + point.len());
    put_string(&mut blob, ALGORITHM.as_bytes());
    put_string(&mut blob, CURVE.as_bytes());
    put_string(&mut blob, point);
    Ok(blob)
}

/// Ligne `ecdsa-sha2-nistp256 AAAA… commentaire`, à ajouter sur la forge.
pub fn public_key_openssh(point: &[u8], comment: &str) -> Result<String, String> {
    let blob = public_key_blob(point)?;
    let comment = comment.replace(['\n', '\r'], " ");
    let line = format!("{ALGORITHM} {}", Base64::encode_string(&blob));
    Ok(if comment.trim().is_empty() { line } else { format!("{line} {}", comment.trim()) })
}

/// Lit un élément DER `tag longueur contenu` ; longueurs courtes ou sur un octet (une signature P-256 fait < 128 octets).
fn der_element(input: &[u8], tag: u8) -> Option<(&[u8], &[u8])> {
    let (&found, rest) = input.split_first()?;
    if found != tag {
        return None;
    }
    let (&first, rest) = rest.split_first()?;
    let (len, rest) = match first {
        n if n < 0x80 => (n as usize, rest),
        0x81 => {
            let (&n, rest) = rest.split_first()?;
            if n < 0x80 {
                return None; // Encodage non minimal.
            }
            (n as usize, rest)
        }
        _ => return None,
    };
    (rest.len() >= len).then(|| rest.split_at(len))
}

/// Entier DER positif et minimal, de 32 octets utiles au plus : son contenu est déjà un `mpint` SSH valide.
fn der_positive_integer(input: &[u8]) -> Option<(&[u8], &[u8])> {
    let (value, rest) = der_element(input, 0x02)?;
    let minimal = match value {
        [] => false,
        [0x00] => false, // r et s ne sont jamais nuls.
        [0x00, next, ..] => *next >= 0x80,
        [first, ..] => *first < 0x80,
    };
    let useful = value.iter().skip_while(|b| **b == 0).count();
    (minimal && useful <= 32).then_some((value, rest))
}

/// Signature DER `SEQUENCE { INTEGER r, INTEGER s }` → `mpint r, mpint s`, le contenu attendu par libssh2 (qui
/// l'enveloppe ensuite dans `string "ecdsa-sha2-nistp256", string signature`).
pub fn ssh_signature_from_der(der: &[u8]) -> Result<Vec<u8>, String> {
    let invalid = || tr!("Signature de l'appareil illisible", "Unreadable device signature");
    let (sequence, trailing) = der_element(der, 0x30).ok_or_else(invalid)?;
    let (r, rest) = der_positive_integer(sequence).ok_or_else(invalid)?;
    let (s, rest) = der_positive_integer(rest).ok_or_else(invalid)?;
    if !rest.is_empty() || !trailing.is_empty() {
        return Err(invalid());
    }
    let mut out = Vec::with_capacity(8 + r.len() + s.len());
    put_string(&mut out, r);
    put_string(&mut out, s);
    Ok(out)
}

/// Empreinte `SHA256:…` de la clé, comme `ssh-keygen -l`.
pub fn fingerprint(point: &[u8]) -> Result<String, String> {
    use ssh_key::sha2::{Digest, Sha256};
    let blob = public_key_blob(point)?;
    Ok(format!("SHA256:{}", base64ct::Base64Unpadded::encode_string(&Sha256::digest(&blob))))
}

thread_local! {
    /// Faux pendant une synchronisation en arrière-plan : aucune confirmation ne doit alors s'afficher.
    static PROMPT_ALLOWED: Cell<bool> = const { Cell::new(true) };
}

/// La clé peut-elle demander une confirmation à l'utilisateur sur ce fil ? libgit2 appelle la signature sur le fil de
/// l'opération Git : c'est celui qui a lancé `without_prompt`.
pub fn prompt_allowed() -> bool {
    PROMPT_ALLOWED.with(Cell::get)
}

/// Exécute `job` sans qu'aucune confirmation puisse s'afficher : une clé verrouillée fait alors échouer la signature.
#[cfg_attr(not(target_os = "android"), allow(dead_code))] // Bureau : seuls les tests l'utilisent.
pub fn without_prompt<T>(job: impl FnOnce() -> T) -> T {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            PROMPT_ALLOWED.with(|p| p.set(self.0));
        }
    }
    let _restore = Restore(PROMPT_ALLOWED.with(|p| p.replace(false)));
    job()
}

/// Ce que le rappel de signature reçoit de libgit2 : la clé et l'endroit où ranger un éventuel échec, pour que
/// l'utilisateur lise « confirmation annulée » plutôt qu'une erreur générique de libssh2.
pub struct SignContext {
    signer: Arc<dyn SshSigner>,
    last_error: Mutex<Option<String>>,
}

impl SignContext {
    /// Le contexte est partagé (`Arc`) : son adresse ne change pas, libgit2 la garde le temps de l'authentification, et
    /// l'appelant relit l'éventuel échec une fois l'opération terminée.
    pub fn new(signer: Arc<dyn SshSigner>) -> Arc<Self> {
        Arc::new(SignContext { signer, last_error: Mutex::new(None) })
    }

    /// Message du dernier échec de signature, s'il y en a eu un (et l'efface).
    pub fn take_error(&self) -> Option<String> {
        self.last_error.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    fn sign_ssh(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        let der = self.signer.sign(data)?;
        ssh_signature_from_der(&der)
    }

    /// Identifiant libgit2 qui signe avec cette clé. `self` doit vivre plus longtemps que l'identifiant : c'est le cas
    /// quand le contexte appartient au rappel `credentials`, que libgit2 garde pendant toute l'opération.
    pub fn credential(&self, username: &str) -> Result<Cred, git2::Error> {
        let blob = public_key_blob(&self.signer.public_point()).map_err(|e| git2::Error::from_str(&e))?;
        let username = CString::new(username).map_err(|_| git2::Error::from_str("nul byte in SSH username"))?;
        let mut out = std::ptr::null_mut();
        // SAFETY : libgit2 copie le nom et la clé publique ; `payload` (ce contexte) reste valide, voir ci-dessus.
        let rc = unsafe {
            git_credential_ssh_custom_new(
                &mut out,
                username.as_ptr(),
                blob.as_ptr().cast(),
                blob.len(),
                sign_callback,
                self as *const SignContext as *mut c_void,
            )
        };
        if rc < 0 || out.is_null() {
            return Err(git2::Error::last_error(rc));
        }
        // SAFETY : identifiant valide créé ci-dessus, dont `Cred` devient le propriétaire (libéré par libgit2).
        Ok(unsafe { Cred::from_raw(out.cast()) })
    }
}

type SignCallback = extern "C" fn(
    session: *mut c_void,
    sig: *mut *mut c_uchar,
    sig_len: *mut usize,
    data: *const c_uchar,
    data_len: usize,
    payload: *mut *mut c_void,
) -> c_int;

// Déclaré ici et non pris dans libgit2-sys, dont le type du rappel oublie la valeur de retour (`int`), que libssh2 lit
// pour savoir si la signature a réussi.
extern "C" {
    fn git_credential_ssh_custom_new(
        out: *mut *mut c_void,
        username: *const c_char,
        publickey: *const c_char,
        publickey_len: usize,
        sign_callback: SignCallback,
        payload: *mut c_void,
    ) -> c_int;
}

/// Appelé par libssh2 pendant l'authentification. `payload` pointe vers le pointeur passé à
/// `git_credential_ssh_custom_new`. La signature est allouée avec `malloc` : libssh2 la libère avec `free`.
extern "C" fn sign_callback(
    _session: *mut c_void,
    sig: *mut *mut c_uchar,
    sig_len: *mut usize,
    data: *const c_uchar,
    data_len: usize,
    payload: *mut *mut c_void,
) -> c_int {
    // Une panique ne doit jamais traverser le code C.
    std::panic::catch_unwind(|| {
        // SAFETY : pointeurs fournis par libssh2 pour la durée de l'appel ; `payload` désigne un `SignContext` vivant.
        unsafe {
            if sig.is_null() || sig_len.is_null() || data.is_null() || payload.is_null() || (*payload).is_null() {
                return -1;
            }
            *sig = std::ptr::null_mut();
            *sig_len = 0;
            let context = &*((*payload) as *const SignContext);
            let data = std::slice::from_raw_parts(data, data_len);
            match context.sign_ssh(data) {
                Ok(signature) => {
                    let buffer = libc::malloc(signature.len()) as *mut c_uchar;
                    if buffer.is_null() {
                        return -1;
                    }
                    std::ptr::copy_nonoverlapping(signature.as_ptr(), buffer, signature.len());
                    *sig = buffer;
                    *sig_len = signature.len();
                    0
                }
                Err(e) => {
                    *context.last_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e);
                    -1
                }
            }
        }
    })
    .unwrap_or(-1)
}

#[cfg(test)]
pub(crate) mod testing {
    //! Clé logicielle P-256 pour les tests : même interface et même format (DER) que le Keystore.
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    pub struct SoftwareSigner {
        key: EcdsaKeyPair,
        rng: SystemRandom,
        /// Simule une confirmation refusée par l'utilisateur.
        pub refuse: AtomicBool,
        /// Simule une confirmation expirée : la clé ne signe que si une confirmation peut être demandée.
        pub locked: AtomicBool,
        pub signatures: AtomicUsize,
    }

    impl SoftwareSigner {
        pub fn generate() -> Arc<Self> {
            let rng = SystemRandom::new();
            let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
            let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng).unwrap();
            Arc::new(SoftwareSigner { key, rng, refuse: AtomicBool::new(false), locked: AtomicBool::new(false), signatures: AtomicUsize::new(0) })
        }

        pub fn authorized_key(&self) -> String {
            public_key_openssh(&self.public_point(), "merathon-test").unwrap()
        }
    }

    impl SshSigner for SoftwareSigner {
        fn public_point(&self) -> Vec<u8> {
            self.key.public_key().as_ref().to_vec()
        }

        fn sign(&self, data: &[u8]) -> Result<Vec<u8>, String> {
            if self.refuse.load(Ordering::SeqCst) {
                return Err("Confirmation annulée".into());
            }
            if self.locked.load(Ordering::SeqCst) && !prompt_allowed() {
                return Err(crate::android_keystore::describe("locked: test"));
            }
            self.signatures.fetch_add(1, Ordering::SeqCst);
            Ok(self.key.sign(&self.rng, data).map_err(|e| e.to_string())?.as_ref().to_vec())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::SoftwareSigner;
    use super::*;
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_FIXED};

    #[test]
    fn public_key_has_the_openssh_format() {
        let signer = SoftwareSigner::generate();
        let line = public_key_openssh(&signer.public_point(), "Merathon - téléphone").unwrap();
        assert!(line.starts_with("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABB"), "{line}");
        assert!(line.ends_with(" Merathon - téléphone"));
        // OpenSSH relit la ligne, quand il est installé : c'est bien une clé SSH valide.
        if let Ok(out) = std::process::Command::new("ssh-keygen").args(["-l", "-f", "-"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(line.as_bytes())?;
            child.wait_with_output()
        }) {
            assert!(out.status.success(), "ssh-keygen refuse la clé : {line}");
            assert!(String::from_utf8_lossy(&out.stdout).contains("(ECDSA)"));
        }
    }

    #[test]
    fn refuses_anything_but_an_uncompressed_p256_point() {
        assert!(public_key_blob(&[0x04; 64]).is_err());
        let mut compressed = vec![0x02];
        compressed.extend([1u8; 64]);
        assert!(public_key_blob(&compressed).is_err());
    }

    #[test]
    fn reads_the_point_of_an_android_spki() {
        let signer = SoftwareSigner::generate();
        let point = signer.public_point();
        let mut spki = P256_SPKI_PREFIX.to_vec();
        spki.extend(&point);
        assert_eq!(point_from_spki(&spki).unwrap(), point);
        assert!(point_from_spki(&spki[..spki.len() - 1]).is_err());
        let mut p384 = spki.clone();
        p384[20] = 0x22; // autre courbe
        assert!(point_from_spki(&p384).is_err());
    }

    /// Le résultat de la conversion, relu comme `r || s`, doit être vérifiable : c'est la même signature.
    #[test]
    fn converted_signatures_still_verify() {
        let signer = SoftwareSigner::generate();
        let point = signer.public_point();
        for i in 0..200u32 {
            let data = format!("données de session {i}");
            let der = signer.sign(data.as_bytes()).unwrap();
            let ssh = ssh_signature_from_der(&der).unwrap();
            // mpint r, mpint s → r et s sur 32 octets chacun.
            let mut fixed = Vec::new();
            let mut rest = &ssh[..];
            for _ in 0..2 {
                let len = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
                let value = &rest[4..4 + len];
                assert!(value[0] < 0x80, "mpint positif");
                assert!(value.len() == 1 || value[0] != 0 || value[1] >= 0x80, "mpint minimal");
                let trimmed: Vec<u8> = value.iter().copied().skip_while(|b| *b == 0).collect();
                fixed.extend(std::iter::repeat_n(0u8, 32 - trimmed.len()));
                fixed.extend(trimmed);
                rest = &rest[4 + len..];
            }
            assert!(rest.is_empty());
            UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, &point).verify(data.as_bytes(), &fixed).unwrap();
        }
    }

    #[test]
    fn refuses_malformed_der_signatures() {
        for bad in [
            &[][..],
            &[0x30, 0x00],
            &[0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00], // octet en trop
            &[0x30, 0x06, 0x02, 0x01, 0x81, 0x02, 0x01, 0x01],       // r négatif
            &[0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01], // r non minimal
            &[0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01],       // r nul
            &[0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01],       // pas une SEQUENCE
            &[0x30, 0x08, 0x02, 0x01, 0x01],                         // longueur trop grande
        ] {
            assert!(ssh_signature_from_der(bad).is_err(), "{bad:02x?}");
        }
        let mut too_long = vec![0x30, 0x25, 0x02, 0x21];
        too_long.extend([0x7f; 33]);
        too_long.extend([0x02, 0x01, 0x01]);
        assert!(ssh_signature_from_der(&too_long).is_err(), "r de 33 octets utiles");
        assert_eq!(ssh_signature_from_der(&[0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07]).unwrap(), [0, 0, 0, 1, 5, 0, 0, 0, 1, 7]);
    }

    #[test]
    fn prompts_are_forbidden_only_inside_without_prompt() {
        assert!(prompt_allowed());
        let inside = without_prompt(|| {
            let nested = without_prompt(prompt_allowed);
            (prompt_allowed(), nested)
        });
        assert_eq!(inside, (false, false));
        assert!(prompt_allowed(), "rétabli à la sortie");
        let _ = std::panic::catch_unwind(|| without_prompt(|| panic!("échec")));
        assert!(prompt_allowed(), "rétabli même après une panique");
        // Propre à chaque fil : une synchronisation ne bloque pas les confirmations d'une opération manuelle.
        without_prompt(|| assert!(std::thread::spawn(prompt_allowed).join().unwrap()));
    }

    #[test]
    fn fingerprint_is_the_one_openssh_shows() {
        let signer = SoftwareSigner::generate();
        let fingerprint = fingerprint(&signer.public_point()).unwrap();
        let line = public_key_openssh(&signer.public_point(), "x").unwrap();
        let out = std::process::Command::new("ssh-keygen").args(["-l", "-E", "sha256", "-f", "-"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(line.as_bytes())?;
            child.wait_with_output()
        });
        if let Ok(out) = out {
            assert!(String::from_utf8_lossy(&out.stdout).contains(&fingerprint), "{fingerprint}");
        }
        assert!(fingerprint.starts_with("SHA256:") && !fingerprint.ends_with('='));
    }

    #[test]
    fn creates_a_libgit2_credential_for_the_device_key() {
        let context = SignContext::new(SoftwareSigner::generate());
        let cred = context.credential("git").unwrap();
        assert_eq!(cred.credtype(), libgit2_sys::GIT_CREDTYPE_SSH_CUSTOM);
        assert!(context.credential("nul\0byte").is_err());
    }
}
