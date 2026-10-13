fn main() {
    // Identifiants client OAuth intégrés au binaire (lus par `option_env!`) : sans ces lignes,
    // Cargo ne recompile pas quand ils changent et le binaire garde l'ancienne valeur.
    println!("cargo:rerun-if-env-changed=GIT_CLIENT_GITHUB_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GIT_CLIENT_GITLAB_CLIENT_ID");
    tauri_build::build()
}
