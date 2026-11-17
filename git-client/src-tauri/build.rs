fn main() {
    // Identifiants client OAuth intégrés au binaire (lus par `option_env!`) : sans ces lignes,
    // Cargo ne recompile pas quand ils changent et le binaire garde l'ancienne valeur.
    // Les noms GIT_CLIENT_* sont ceux d'avant le renommage en Merathon, encore acceptés.
    for name in ["MERATHON_GITHUB_CLIENT_ID", "MERATHON_GITLAB_CLIENT_ID", "GIT_CLIENT_GITHUB_CLIENT_ID", "GIT_CLIENT_GITLAB_CLIENT_ID"] {
        println!("cargo:rerun-if-env-changed={name}");
    }

    #[cfg(feature = "tauri-app")]
    tauri_build::build();

    // Le serveur (NAS) n'utilise pas Tauri : les `cfg(desktop)` / `cfg(mobile)` que Tauri pose d'habitude le sont ici.
    #[cfg(not(feature = "tauri-app"))]
    {
        println!("cargo:rustc-check-cfg=cfg(desktop)");
        println!("cargo:rustc-check-cfg=cfg(mobile)");
        println!("cargo:rustc-check-cfg=cfg(dev)");
        let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
        if target == "android" || target == "ios" {
            println!("cargo:rustc-cfg=mobile");
        } else {
            println!("cargo:rustc-cfg=desktop");
        }
    }
}
