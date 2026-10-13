use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn unique_label(existing_labels: &[String]) -> String {
    let mut n = 1u32;
    loop {
        let label = format!("repo-{n}");
        if !existing_labels.contains(&label) {
            return label;
        }
        n += 1;
    }
}

pub fn open_new_window(app: &AppHandle, repo: Option<&str>) -> Result<(), String> {
    let existing: Vec<String> = app.webview_windows().keys().cloned().collect();
    let label = unique_label(&existing);

    // Le dépôt à ouvrir est transmis au frontend avant le chargement de la page.
    let init = format!(
        "window.__GIT_CLIENT_OPEN_REPO__ = {};",
        serde_json::to_string(&repo).map_err(|e| e.to_string())?
    );

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("/".into()))
        .initialization_script(&init)
        .title("Merathon — Git Repository Manager")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_label_starts_at_repo_1_when_empty() {
        assert_eq!(unique_label(&[]), "repo-1");
    }

    #[test]
    fn unique_label_skips_existing() {
        let existing = vec!["repo-1".into(), "repo-2".into()];
        assert_eq!(unique_label(&existing), "repo-3");
    }

    #[test]
    fn unique_label_fills_gaps() {
        let existing = vec!["repo-1".into(), "repo-3".into()];
        assert_eq!(unique_label(&existing), "repo-2");
    }

    #[test]
    fn unique_label_handles_non_repo_windows() {
        let existing = vec!["main".into()];
        assert_eq!(unique_label(&existing), "repo-1");
    }
}
