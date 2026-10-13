fn main() {
    // Identifiants client OAuth intégrés au binaire (lus par `option_env!`) : sans ces lignes,
    // Cargo ne recompile pas quand ils changent et le binaire garde l'ancienne valeur.
    // Les noms GIT_CLIENT_* sont ceux d'avant le renommage en Merathon, encore acceptés.
    for name in ["MERATHON_GITHUB_CLIENT_ID", "MERATHON_GITLAB_CLIENT_ID", "GIT_CLIENT_GITHUB_CLIENT_ID", "GIT_CLIENT_GITLAB_CLIENT_ID"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    tauri_build::build()
}
