//! Mesure des lectures faites à chaque actualisation d'un dépôt (graphe, branches, statut…), sur un dépôt fourni.
//! Ignoré par défaut :
//!
//! ```bash
//! MERATHON_BENCH_REPO=/chemin/vers/un/gros/depot cargo test --release --lib bench -- --ignored --nocapture
//! ```

use std::time::{Duration, Instant};

use crate::git;

/// Médiane de `runs` exécutions.
fn median(runs: usize, mut f: impl FnMut()) -> Duration {
    let mut times: Vec<Duration> = (0..runs)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed()
        })
        .collect();
    times.sort();
    times[runs / 2]
}

#[test]
#[ignore = "mesure : MERATHON_BENCH_REPO=<dépôt>"]
fn refresh_reads() {
    let Ok(path) = std::env::var("MERATHON_BENCH_REPO") else {
        eprintln!("MERATHON_BENCH_REPO non défini : rien à mesurer");
        return;
    };
    const RUNS: usize = 7;
    let repo = git::open_repo(&path).unwrap();
    let head = repo.head().unwrap().target().unwrap().to_string();
    let rows: Vec<(&str, Duration)> = vec![
        ("open_repo", median(RUNS, || drop(git::open_repo(&path).unwrap()))),
        ("get_commits(1000)", median(RUNS, || drop(git::get_commits(&repo, 1000).unwrap()))),
        ("get_branches", median(RUNS, || drop(git::get_branches(&repo).unwrap()))),
        ("get_tags", median(RUNS, || drop(git::get_tags(&repo).unwrap()))),
        ("get_status", median(RUNS, || drop(git::get_status(&repo).unwrap()))),
        ("repo_info", median(RUNS, || drop(git::repo_info(&repo).unwrap()))),
        ("list_remotes", median(RUNS, || drop(git::list_remotes(&repo).unwrap()))),
        ("list_submodules", median(RUNS, || drop(git::list_submodules(&repo).unwrap()))),
        ("list_worktrees", median(RUNS, || drop(git::list_worktrees(&repo).unwrap()))),
        ("list_stashes", median(RUNS, || drop(git::list_stashes(&mut git::open_repo(&path).unwrap()).unwrap()))),
        ("get_commit_details(HEAD)", median(RUNS, || drop(git::get_commit_details(&repo, &head).unwrap()))),
        ("list_files", median(RUNS, || drop(git::list_files(&repo).unwrap()))),
    ];
    let total: Duration = rows.iter().map(|(_, d)| *d).sum();
    for (name, d) in &rows {
        println!("{name:<26} {:>9.2} ms", d.as_secs_f64() * 1000.0);
    }
    println!("{:<26} {:>9.2} ms", "total (séquentiel)", total.as_secs_f64() * 1000.0);
}
