//! Notifications système.
//!
//! Sous Linux, elles ne passent pas par le plugin : `notify-rust` ouvre une connexion D-Bus par notification et la
//! ferme aussitôt. GNOME Shell rattache la notification à la fenêtre Merathon (par le PID de l'expéditeur) et
//! détruit ses notifications dès que la connexion de l'expéditeur disparaît : elles s'effaçaient avant d'être vues.
//! Une connexion ouverte une fois et gardée jusqu'à la fermeture de l'application évite ce problème.
//!
//! Les notifications restent alors dans la liste de GNOME, dont le dock d'Ubuntu affiche le nombre sur l'icône :
//! `notify_desktop` renvoie l'identifiant de chacune, pour la retirer (`close_desktop_notification`) une fois
//! les PR qu'elle mentionne consultées.
//!
//! Sous WSL, il n'y a en général aucun serveur de notifications sur le bus de session, et WSLg ne relaie pas
//! les notifications vers Windows : à défaut de serveur, Merathon affiche un toast Windows par `powershell.exe`.
//! Ce toast ne peut pas être retiré ensuite, comme sous Windows.

use tauri::AppHandle;

/// Affiche une notification ; renvoie son identifiant quand le système permet de la retirer ensuite (Linux).
#[tauri::command]
pub async fn notify_desktop(app: AppHandle, title: String, body: String) -> Result<Option<u32>, String> {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || match linux::notify(&title, &body) {
            Ok(id) => Ok(Some(id)),
            Err(e) if crate::is_wsl() => wsl::notify(&title, &body).map(|()| None).map_err(|toast| {
                format!("aucun serveur de notifications dans WSL ({e}) et notification Windows impossible ({toast})")
            }),
            Err(e) => Err(e),
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())?;
        Ok(None)
    }
}

/// Retire une notification de la liste du système (sans effet si l'utilisateur l'a déjà fermée).
#[tauri::command]
pub async fn close_desktop_notification(id: u32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || linux::close(id))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = id;
        Ok(())
    }
}

/// Merathon tourne dans WSL : la pastille du nombre de PR est alors dessinée dans l'icône de la fenêtre.
#[tauri::command]
pub fn is_wsl() -> bool {
    #[cfg(target_os = "linux")]
    {
        crate::is_wsl()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use zbus::blocking::Connection;
    use zbus::zvariant::Value;

    /// Connexion au bus de session, gardée ouverte ; recréée si la précédente a échoué.
    static CONNECTION: Mutex<Option<Connection>> = Mutex::new(None);

    fn connection() -> Result<Connection, String> {
        let mut slot = CONNECTION.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = slot.as_ref() {
            return Ok(conn.clone());
        }
        let conn = Connection::session().map_err(|e| e.to_string())?;
        *slot = Some(conn.clone());
        Ok(conn)
    }

    pub fn notify(title: &str, body: &str) -> Result<u32, String> {
        let conn = connection()?;
        // Fichier `.desktop` et icône installés par le paquet (`/usr/share/applications/Merathon.desktop`).
        let hints: HashMap<&str, Value> = HashMap::from([("desktop-entry", Value::from("Merathon"))]);
        let actions: Vec<&str> = Vec::new();
        let result = conn.call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &("Merathon", 0u32, "merathon", title, body, actions, hints, -1i32),
        );
        match result {
            Ok(reply) => reply.body().deserialize::<u32>().map_err(|e| e.to_string()),
            Err(e) => {
                // Bus redémarré ou connexion perdue : une nouvelle sera ouverte à la prochaine notification.
                *CONNECTION.lock().map_err(|e| e.to_string())? = None;
                Err(e.to_string())
            }
        }
    }

    pub fn close(id: u32) -> Result<(), String> {
        let conn = connection()?;
        conn.call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "CloseNotification",
            &(id,),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "linux")]
mod wsl {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use std::process::Command;

    /// `powershell.exe` est dans le PATH si l'interopérabilité de WSL l'y ajoute (`appendWindowsPath`, par défaut).
    const POWERSHELL: [&str; 2] =
        ["powershell.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"];

    /// Identifiant d'application de PowerShell : Windows n'affiche que les toasts d'une application qu'il connaît.
    const APP_ID: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

    pub fn notify(title: &str, body: &str) -> Result<(), String> {
        let command = encoded_command(&toast_script(title, body));
        let mut last_error = String::new();
        for exe in POWERSHELL {
            let output =
                match Command::new(exe).args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &command]).output() {
                    Ok(output) => output,
                    Err(e) => {
                        last_error = format!("{exe} : {e}");
                        continue;
                    }
                };
            if output.status.success() {
                return Ok(());
            }
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Err(last_error)
    }

    /// Script PowerShell du toast. Titre et texte y sont en base64 (UTF-8) : aucun caractère ne peut casser le
    /// script, et le XML du toast est construit par nœuds texte, sans échappement à faire.
    fn toast_script(title: &str, body: &str) -> String {
        format!(
            r#"$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {{
  function D($s) {{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }}
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
  $texts = $xml.GetElementsByTagName('text')
  $null = $texts.Item(0).AppendChild($xml.CreateTextNode((D '{title}')))
  $null = $texts.Item(1).AppendChild($xml.CreateTextNode((D '{body}')))
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{app_id}').Show($toast)
}} catch {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1 }}
"#,
            title = STANDARD.encode(title),
            body = STANDARD.encode(body),
            app_id = APP_ID,
        )
    }

    /// Argument de `-EncodedCommand` : le script en UTF-16 LE, encodé en base64.
    fn encoded_command(script: &str) -> String {
        let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
        STANDARD.encode(utf16)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn embeds_texts_as_base64() {
            let script = toast_script("PR « fix » d'Ana", "a\n<b>&");
            assert!(script.contains(&format!("(D '{}')", STANDARD.encode("PR « fix » d'Ana"))));
            assert!(script.contains(&format!("(D '{}')", STANDARD.encode("a\n<b>&"))));
            assert!(!script.contains("fix"));
        }

        #[test]
        fn encodes_command_as_utf16le_base64() {
            assert_eq!(encoded_command("é"), STANDARD.encode([0xE9, 0x00]));
        }

        /// Affiche un vrai toast : `cargo test -- --ignored wsl` depuis WSL.
        #[test]
        #[ignore]
        fn shows_windows_toast() {
            notify("Merathon", "Notification de test « depuis WSL »\nseconde ligne").unwrap();
        }
    }
}
