//! Android : dernière version publiée de Merathon, pour prévenir qu'une mise à jour existe.
//!
//! Sur le bureau, le plugin de mise à jour de Tauri télécharge et installe les paquets signés. Sur Android, l'APK est
//! distribué hors store : l'application lit la dernière release du dépôt public, et propose d'en télécharger l'APK
//! dans le navigateur ; Android l'installe ensuite par-dessus (même clé de signature). Fait ici et non dans la WebView,
//! dont la politique de sécurité (CSP) n'autorise aucun appel réseau hors de l'application.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Releases du dépôt public, celui qui sert les téléchargements (voir `plugins.updater` dans tauri.conf.json).
const LATEST_URL: &str = "https://api.github.com/repos/J-Dudek/merathon/releases/latest";
/// Nom de l'APK joint à chaque release (job « APK Android » de release.yml).
const APK_SUFFIX: &str = "_arm64.apk";

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    /// Version sans le « v » du tag.
    pub version: String,
    /// Notes de la release (Markdown).
    pub notes: String,
    pub page_url: String,
    /// APK Android de la release ; absent si elle n'en a pas.
    pub apk_url: Option<String>,
}

/// Lit la réponse de `GET /repos/{owner}/{repo}/releases/latest`.
pub fn parse(release: &Value) -> Result<LatestRelease, String> {
    let tag = release.get("tag_name").and_then(Value::as_str).ok_or("release sans tag")?;
    let apk_url = release
        .get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|a| a.get("name").and_then(Value::as_str).is_some_and(|n| n.ends_with(APK_SUFFIX)))
        .and_then(|a| a.get("browser_download_url").and_then(Value::as_str))
        .map(str::to_string);
    Ok(LatestRelease {
        version: tag.trim_start_matches('v').to_string(),
        notes: release.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
        page_url: release.get("html_url").and_then(Value::as_str).unwrap_or_default().to_string(),
        apk_url,
    })
}

#[tauri::command]
pub async fn latest_release() -> Result<LatestRelease, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let response = crate::http::agent()
            .get(LATEST_URL)
            .set("Accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(15))
            .call()
            .map_err(|e| e.to_string())?;
        let release: Value = response.into_json().map_err(|e| e.to_string())?;
        parse(&release)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_the_version_and_the_android_apk() {
        let release = json!({
            "tag_name": "v2.16.0",
            "body": "### Nouveautés\n- truc",
            "html_url": "https://github.com/J-Dudek/merathon/releases/tag/v2.16.0",
            "assets": [
                { "name": "Merathon_2.16.0_amd64.AppImage", "browser_download_url": "https://x/appimage" },
                { "name": "Merathon_2.16.0_arm64.apk", "browser_download_url": "https://x/apk" },
            ],
        });
        assert_eq!(
            parse(&release).unwrap(),
            LatestRelease {
                version: "2.16.0".into(),
                notes: "### Nouveautés\n- truc".into(),
                page_url: "https://github.com/J-Dudek/merathon/releases/tag/v2.16.0".into(),
                apk_url: Some("https://x/apk".into()),
            }
        );
    }

    #[test]
    fn a_release_without_apk_has_no_download() {
        let release = json!({ "tag_name": "v2.16.0", "assets": [{ "name": "Merathon_2.16.0_x64-setup.exe" }] });
        let latest = parse(&release).unwrap();
        assert_eq!((latest.version.as_str(), latest.apk_url), ("2.16.0", None));
        assert!(parse(&json!({})).is_err());
    }
}
