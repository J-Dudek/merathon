//! Clé SSH de l'appareil : pont vers `MerathonKeystore.kt` (Android Keystore), appelé par JNI.
//!
//! La clé privée ECDSA P-256 est créée dans le Keystore et n'en sort jamais : Rust ne reçoit que la clé publique
//! (`SubjectPublicKeyInfo`) et les signatures (DER), converties pour libssh2 par `ssh_signer.rs`. Chaque signature peut
//! demander l'empreinte digitale ou le code de l'appareil ; une confirmation vaut 30 secondes.
//!
//! La partie JNI n'existe que sur Android. Le reste (états, messages d'erreur, description de la clé) est testé sur le
//! bureau.

use std::sync::Arc;

use serde::Serialize;

use crate::ssh_setup::SshKeyInfo;
use crate::ssh_signer::{self, SshSigner};

/// Nom de la clé de l'appareil dans `SshKeyInfo` (il n'y a pas de fichier).
pub const DEVICE_KEY_NAME: &str = "android-keystore";
/// Commentaire de la clé publique, visible sur la forge à côté du titre choisi.
const PUBLIC_KEY_COMMENT: &str = "merathon-android";
/// Préfixe stable d'une signature refusée faute de pouvoir demander la confirmation (synchronisation en arrière-plan) :
/// l'interface le reconnaît pour ignorer le dépôt sans bruit.
pub const LOCKED_MARKER: &str = "device-ssh-key-locked";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKeyState {
    /// Pas encore de clé.
    Absent,
    /// Clé utilisable (une confirmation pourra être demandée).
    Ready,
    /// Clé inutilisable : verrouillage d'écran retiré ou modifié.
    Invalidated,
    /// Pas de verrouillage d'écran : Android ne protège pas la clé, aucune n'est créée.
    Insecure,
}

pub fn parse_state(state: &str) -> Result<DeviceKeyState, String> {
    match state {
        "absent" => Ok(DeviceKeyState::Absent),
        "ready" => Ok(DeviceKeyState::Ready),
        "invalidated" => Ok(DeviceKeyState::Invalidated),
        "insecure" => Ok(DeviceKeyState::Insecure),
        other => Err(describe(other)),
    }
}

/// Message de l'utilisateur pour une erreur de `MerathonKeystore.kt` (`code: détail`).
pub fn describe(error: &str) -> String {
    let code = error.split(':').next().unwrap_or("").trim();
    match code {
        "absent" => tr!("Aucune clé SSH sur cet appareil : crée-la avec Comptes > Configurer SSH…", "No SSH key on this device: create it with Accounts > Set up SSH…"),
        "locked" => format!("{LOCKED_MARKER}: {}", tr!("la clé SSH de l'appareil est verrouillée, et aucune confirmation ne peut être demandée en arrière-plan", "the device SSH key is locked, and no confirmation can be requested in the background")),
        "cancelled" => tr!("Confirmation annulée", "Confirmation cancelled"),
        "invalidated" => tr!("La clé SSH de l'appareil n'est plus utilisable (verrouillage d'écran retiré ou modifié) : supprime-la dans Préférences > SSH, crée-en une autre et ajoute-la sur la forge.", "The device SSH key can no longer be used (screen lock removed or changed): delete it in Preferences > SSH, create another one and add it on the forge."),
        "insecure" => tr!("Configure d'abord un verrouillage d'écran (code, schéma ou empreinte) : sans lui, Android ne protège pas la clé SSH, et Merathon n'en crée pas.", "Set up a screen lock first (PIN, pattern or fingerprint): without it, Android does not protect the SSH key, and Merathon does not create one."),
        "exists" => tr!("Une clé SSH existe déjà sur cet appareil : elle n'est jamais remplacée.", "An SSH key already exists on this device: it is never replaced."),
        "prompt" => {
            let detail = error.split_once(':').map_or("", |(_, d)| d.trim());
            tr!("La demande d'empreinte ou de code n'a pas pu s'afficher ({detail})", "The fingerprint or PIN request could not be shown ({detail})")
        }
        "busy" => tr!("La confirmation ne peut pas s'afficher pour l'instant : réessaie avec Merathon au premier plan.", "The confirmation cannot be shown right now: try again with Merathon in the foreground."),
        _ => tr!("Erreur de l'Android Keystore : {error}", "Android Keystore error: {error}"),
    }
}

/// Message d'une opération SSH sans clé d'appareil utilisable, selon l'état du coffre (`state()`).
/// Le backend ne connaît pas le réglage « SSH (expérimental) » : le message couvre les deux cas.
pub fn unusable_key_message(state: Result<DeviceKeyState, String>) -> String {
    match state {
        Ok(DeviceKeyState::Invalidated) => describe("invalidated"),
        Ok(DeviceKeyState::Insecure) => tr!("Pas de clé SSH sur cet appareil, et aucune ne peut être créée sans verrouillage d'écran : utilise l'URL HTTPS du dépôt, ou configure un verrouillage d'écran puis Comptes > Configurer SSH… (réglage SSH expérimental).", "No SSH key on this device, and none can be created without a screen lock: use the repository's HTTPS URL, or set up a screen lock and then Accounts > Set up SSH… (experimental SSH setting)."),
        _ => tr!("Pas de clé SSH sur cet appareil : utilise l'URL HTTPS du dépôt, ou active le SSH dans Préférences > SSH (expérimental) puis crée la clé avec Comptes > Configurer SSH… Si une clé existait, Android l'a effacée avec le verrouillage d'écran : retire aussi l'ancienne de la forge.", "No SSH key on this device: use the repository's HTTPS URL, or enable SSH in Preferences > SSH (experimental) and create the key with Accounts > Set up SSH… If a key existed, Android erased it together with the screen lock: also remove the old one from the forge."),
    }
}

/// Description de la clé de l'appareil pour l'interface, au même format qu'une clé de `~/.ssh`.
pub fn key_info(point: &[u8]) -> Result<SshKeyInfo, String> {
    Ok(SshKeyInfo {
        name: DEVICE_KEY_NAME.to_string(),
        path: tr!("Android Keystore", "Android Keystore"),
        public_key: ssh_signer::public_key_openssh(point, PUBLIC_KEY_COMMENT)?,
        fingerprint: ssh_signer::fingerprint(point)?,
        // Pas de passphrase : la protection est la confirmation de l'utilisateur.
        encrypted: Some(false),
    })
}

/// État de la clé de l'appareil et sa description si elle est utilisable (préférences SSH sur Android).
#[derive(Debug, Clone, Serialize)]
pub struct DeviceKeyStatus {
    pub state: DeviceKeyState,
    pub key: Option<SshKeyInfo>,
    /// Ce que l'utilisateur doit faire, pour une clé invalidée ou un appareil sans verrouillage d'écran.
    pub message: Option<String>,
}

pub fn status() -> Result<DeviceKeyStatus, String> {
    let state = state()?;
    let message = match state {
        DeviceKeyState::Invalidated => Some(describe("invalidated")),
        DeviceKeyState::Insecure => Some(describe("insecure")),
        _ => None,
    };
    let key = if state == DeviceKeyState::Ready { ready_key()? } else { None };
    Ok(DeviceKeyStatus { state, key, message })
}

/// Clé de l'appareil, qui signe dans le Keystore.
pub struct KeystoreSigner {
    point: Vec<u8>,
}

impl SshSigner for KeystoreSigner {
    fn public_point(&self) -> Vec<u8> {
        self.point.clone()
    }

    fn sign(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        let title = tr!("Utiliser la clé SSH", "Use the SSH key");
        let subtitle = tr!("Merathon se connecte en SSH (confirmation valable 30 s)", "Merathon is connecting over SSH (confirmation valid for 30 s)");
        bridge::sign(data, ssh_signer::prompt_allowed(), &title, &subtitle).map_err(|e| describe(&e))
    }
}

/// État de la clé, sans demander de confirmation.
pub fn state() -> Result<DeviceKeyState, String> {
    parse_state(&bridge::state()?)
}

/// Clé utilisable pour les opérations Git, s'il y en a une.
pub fn signer() -> Option<Arc<dyn SshSigner>> {
    if state().ok()? != DeviceKeyState::Ready {
        return None;
    }
    let point = ssh_signer::point_from_spki(&bridge::public_key().ok()??).ok()?;
    Some(Arc::new(KeystoreSigner { point }))
}

/// Description de la clé si elle est utilisable.
pub fn ready_key() -> Result<Option<SshKeyInfo>, String> {
    if state()? != DeviceKeyState::Ready {
        return Ok(None);
    }
    let Some(spki) = bridge::public_key().map_err(|e| describe(&e))? else { return Ok(None) };
    key_info(&ssh_signer::point_from_spki(&spki)?).map(Some)
}

/// Crée la clé (jamais par-dessus une clé existante).
pub fn create() -> Result<SshKeyInfo, String> {
    let spki = bridge::create().map_err(|e| describe(&e))?;
    key_info(&ssh_signer::point_from_spki(&spki)?)
}

/// Supprime la clé de l'appareil. Elle reste à retirer de la forge.
pub fn delete() -> Result<(), String> {
    bridge::delete().map_err(|e| describe(&e))
}

/// Sur le bureau (tests), le Keystore n'existe pas : toute opération échoue proprement.
#[cfg(not(target_os = "android"))]
mod bridge {
    const UNAVAILABLE: &str = "unavailable: Android Keystore";
    pub fn state() -> Result<String, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn public_key() -> Result<Option<Vec<u8>>, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn create() -> Result<Vec<u8>, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn delete() -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn sign(_data: &[u8], _allow_prompt: bool, _title: &str, _subtitle: &str) -> Result<Vec<u8>, String> {
        Err(UNAVAILABLE.into())
    }
}

#[cfg(target_os = "android")]
pub(crate) use bridge::call_class;

/// Appels JNI vers `com.gitclient.app.MerathonKeystore` (méthodes statiques, voir son en-tête).
#[cfg(target_os = "android")]
mod bridge {
    use jni::objects::{JByteArray, JClass, JObject, JString, JValue};
    use jni::{JNIEnv, JavaVM};

    const CLASS: &str = "com.gitclient.app.MerathonKeystore";

    fn call<T>(f: impl for<'local> FnOnce(&mut JNIEnv<'local>, &JClass<'local>, &JObject<'local>) -> jni::errors::Result<T>) -> Result<T, String> {
        call_class(CLASS, f)
    }

    /// Exécute `f` avec la classe Kotlin `class_name` et le contexte de l'application. Le fil courant (souvent un fil
    /// de libgit2) est attaché à la JVM le temps de l'appel ; les références locales sont libérées à la sortie.
    /// Aussi utilisé par pr_watch.rs.
    pub fn call_class<T>(
        class_name: &str,
        f: impl for<'local> FnOnce(&mut JNIEnv<'local>, &JClass<'local>, &JObject<'local>) -> jni::errors::Result<T>,
    ) -> Result<T, String> {
        let context = ndk_context::android_context();
        // SAFETY : JVM du processus et référence globale vers l'Application, posées par tao au démarrage et valides
        // pendant toute la vie du processus. La référence globale n'est jamais libérée ici.
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let app = unsafe { JObject::from_raw(context.context().cast()) };
        let result = env.with_local_frame(16, |env| -> jni::errors::Result<T> {
            // Depuis un fil natif, FindClass ne voit pas les classes de l'application : on passe par son chargeur.
            let loader = env.call_method(&app, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let name = env.new_string(class_name)?;
            let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?.l()?;
            f(env, &JClass::from(class), &app)
        });
        match result {
            Ok(value) => Ok(value),
            Err(jni::errors::Error::JavaException) => Err(take_exception(&mut env)),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Message de l'exception Java en cours (`code: détail`), effacée pour que la JVM reste utilisable.
    fn take_exception(env: &mut JNIEnv) -> String {
        let Ok(throwable) = env.exception_occurred() else { return "exception".into() };
        let _ = env.exception_clear();
        let message = env
            .call_method(&throwable, "getMessage", "()Ljava/lang/String;", &[])
            .and_then(|v| v.l())
            .ok()
            .filter(|o| !o.is_null())
            .and_then(|o| env.get_string(&JString::from(o)).ok().map(String::from));
        let _ = env.exception_clear();
        message.unwrap_or_else(|| "exception".into())
    }

    fn bytes(env: &mut JNIEnv, value: JObject) -> jni::errors::Result<Option<Vec<u8>>> {
        if value.is_null() {
            return Ok(None);
        }
        env.convert_byte_array(JByteArray::from(value)).map(Some)
    }

    pub fn state() -> Result<String, String> {
        call(|env, class, app| {
            let value = env.call_static_method(class, "state", "(Landroid/content/Context;)Ljava/lang/String;", &[JValue::Object(app)])?.l()?;
            Ok(env.get_string(&JString::from(value))?.into())
        })
    }

    pub fn public_key() -> Result<Option<Vec<u8>>, String> {
        call(|env, class, _| {
            let value = env.call_static_method(class, "publicKey", "()[B", &[])?.l()?;
            bytes(env, value)
        })
    }

    pub fn create() -> Result<Vec<u8>, String> {
        call(|env, class, app| {
            let value = env.call_static_method(class, "create", "(Landroid/content/Context;)[B", &[JValue::Object(app)])?.l()?;
            Ok(bytes(env, value)?.unwrap_or_default())
        })
    }

    pub fn delete() -> Result<(), String> {
        call(|env, class, _| env.call_static_method(class, "delete", "()V", &[]).map(|_| ()))
    }

    pub fn sign(data: &[u8], allow_prompt: bool, title: &str, subtitle: &str) -> Result<Vec<u8>, String> {
        call(|env, class, _| {
            let data = env.byte_array_from_slice(data)?;
            let title = env.new_string(title)?;
            let subtitle = env.new_string(subtitle)?;
            let value = env
                .call_static_method(
                    class,
                    "sign",
                    "([BZLjava/lang/String;Ljava/lang/String;)[B",
                    &[JValue::Object(&data), JValue::Bool(allow_prompt.into()), JValue::Object(&title), JValue::Object(&subtitle)],
                )?
                .l()?;
            Ok(bytes(env, value)?.unwrap_or_default())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_signer::testing::SoftwareSigner;

    #[test]
    fn reads_every_state_of_the_kotlin_side() {
        assert_eq!(parse_state("absent"), Ok(DeviceKeyState::Absent));
        assert_eq!(parse_state("ready"), Ok(DeviceKeyState::Ready));
        assert_eq!(parse_state("invalidated"), Ok(DeviceKeyState::Invalidated));
        assert_eq!(parse_state("insecure"), Ok(DeviceKeyState::Insecure));
        assert!(parse_state("autre").unwrap_err().contains("Android Keystore"));
        assert_eq!(serde_json::to_string(&DeviceKeyState::Invalidated).unwrap(), "\"invalidated\"");
    }

    #[test]
    fn explains_each_error_code() {
        assert_eq!(describe("cancelled: confirmation expired"), "Confirmation annulée");
        assert!(describe("locked: locked").starts_with(&format!("{LOCKED_MARKER}: ")));
        assert!(describe("insecure: insecure").contains("verrouillage d'écran"));
        assert!(describe("invalidated: invalidated").contains("supprime-la"));
        assert!(describe("exists: exists").contains("jamais remplacée"));
        assert!(describe("busy: no activity").contains("premier plan"));
        let prompt = describe("prompt: java.lang.SecurityException: Must have USE_BIOMETRIC permission");
        assert!(prompt.contains("n'a pas pu s'afficher") && prompt.contains("USE_BIOMETRIC") && !prompt.contains("annulée"), "{prompt}");
        assert!(describe("absent: absent").contains("Configurer SSH"));
        assert!(describe("java.lang.RuntimeException: boom").contains("boom"));
    }

    #[test]
    fn explains_why_no_device_key_can_be_used() {
        let absent = unusable_key_message(Ok(DeviceKeyState::Absent));
        assert!(absent.contains("HTTPS") && absent.contains("Préférences > SSH") && absent.contains("Configurer SSH"));
        assert!(!absent.contains("pas encore pris en charge"));
        assert_eq!(unusable_key_message(Err("bridge".into())), absent);
        assert!(unusable_key_message(Ok(DeviceKeyState::Invalidated)).contains("supprime-la"));
        assert!(unusable_key_message(Ok(DeviceKeyState::Insecure)).contains("verrouillage d'écran"));
    }

    #[test]
    fn describes_the_device_key_like_a_key_file() {
        let point = SoftwareSigner::generate().public_point();
        let info = key_info(&point).unwrap();
        assert_eq!(info.name, DEVICE_KEY_NAME);
        assert!(info.public_key.starts_with("ecdsa-sha2-nistp256 AAAA") && info.public_key.ends_with(" merathon-android"));
        assert!(info.fingerprint.starts_with("SHA256:"));
        assert_eq!(info.encrypted, Some(false));
    }

    #[test]
    fn without_the_keystore_nothing_is_offered() {
        // Sur le bureau, le pont répond toujours « indisponible » : aucune clé, aucune signature possible.
        assert!(signer().is_none());
        assert!(state().is_err());
        assert!(create().unwrap_err().contains("unavailable"));
        assert!(ready_key().is_err());
        assert!(status().is_err());
        assert!(delete().unwrap_err().contains("unavailable"));
    }
}
