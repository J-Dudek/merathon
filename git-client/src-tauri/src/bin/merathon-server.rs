//! Merathon pour NAS : service sans fenêtre, configuré par l'environnement (voir `merathon_lib::server::config`).

fn main() {
    let config = match merathon_lib::server::config::Config::from_env() {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Configuration invalide : {e}");
            std::process::exit(2);
        }
    };
    if let Err(e) = merathon_lib::server::prepare_environment(&config) {
        eprintln!("Préparation impossible : {e}");
        std::process::exit(1);
    }
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("moteur asynchrone");
    if let Err(e) = runtime.block_on(merathon_lib::server::run(config)) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
