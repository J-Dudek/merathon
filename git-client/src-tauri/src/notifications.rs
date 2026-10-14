//! Notifications système.
//!
//! Sous Linux, elles ne passent pas par le plugin : `notify-rust` ouvre une connexion D-Bus par notification et la
//! ferme aussitôt. GNOME Shell rattache la notification à la fenêtre Merathon (par le PID de l'expéditeur) et
//! détruit ses notifications dès que la connexion de l'expéditeur disparaît : elles s'effaçaient avant d'être vues.
//! Une connexion ouverte une fois et gardée jusqu'à la fermeture de l'application évite ce problème.

use tauri::AppHandle;

#[tauri::command]
pub async fn notify_desktop(app: AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || linux::notify(&title, &body))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
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

    pub fn notify(title: &str, body: &str) -> Result<(), String> {
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
        if let Err(e) = result {
            // Bus redémarré ou connexion perdue : une nouvelle sera ouverte à la prochaine notification.
            *CONNECTION.lock().map_err(|e| e.to_string())? = None;
            return Err(e.to_string());
        }
        Ok(())
    }
}
