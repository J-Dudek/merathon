//! Le serveur du NAS de bout en bout : un vrai serveur HTTP, un vrai dépôt, un vrai WebSocket.
#![cfg(feature = "server")]

use std::net::SocketAddr;
use std::time::Duration;
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use merathon_lib::server::auth::Authenticator;
use merathon_lib::server::config::Config;
use merathon_lib::server::host::Host;
use merathon_lib::server::http::{router, AppState};
use serde_json::{json, Value};

struct Server {
    addr: SocketAddr,
    _dir: tempfile::TempDir,
}

async fn start() -> Server {
    start_with(|_| {}).await
}

async fn start_with(configure: impl FnOnce(&mut Config)) -> Server {
    let dir = tempfile::tempdir().unwrap();
    let web = dir.path().join("web");
    std::fs::create_dir_all(&web).unwrap();
    std::fs::write(web.join("index.html"), "<title>Merathon</title>").unwrap();
    let mut config = Config::local(dir.path().join("data"), web);
    config.config_dir = dir.path().join("config");
    configure(&mut config);
    let auth = std::sync::Arc::new(Authenticator::new(&config));
    let config = std::sync::Arc::new(config);
    let state = AppState { host: Host::new(config.clone()), config, auth };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(state)).await.unwrap() });
    Server { addr, _dir: dir }
}

/// Appelle une commande : `Ok(valeur)`, ou `Err((statut, corps))`.
async fn call(server: &Server, window: &str, cmd: &str, args: Value) -> Result<Value, (u16, Value)> {
    let url = format!("http://{}/api/invoke/{cmd}", server.addr);
    let window = window.to_string();
    tokio::task::spawn_blocking(move || {
        match ureq::post(&url).set("X-Merathon-Window", &window).send_json(args) {
            Ok(response) => Ok(response.into_json::<Value>().unwrap()),
            Err(ureq::Error::Status(code, response)) => Err((code, response.into_json::<Value>().unwrap_or(Value::Null))),
            Err(e) => panic!("{e}"),
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn serves_the_interface_and_rejects_unknown_commands() {
    let server = start().await;
    let page = tokio::task::spawn_blocking({
        let url = format!("http://{}/", server.addr);
        move || ureq::get(&url).call().unwrap().into_string().unwrap()
    })
    .await
    .unwrap();
    assert!(page.contains("Merathon"));

    let (status, _) = call(&server, "main", "no_such_command", json!({})).await.unwrap_err();
    assert_eq!(status, 404);
    // Un argument manquant est une erreur de la commande, pas du serveur.
    let (status, body) = call(&server, "main", "open_repository", json!({})).await.unwrap_err();
    assert_eq!(status, 400);
    assert!(body.as_str().unwrap().contains("path"), "{body}");
}

#[tokio::test]
async fn a_repository_can_be_created_and_committed_through_http() {
    let server = start().await;
    let repo = server._dir.path().join("repo");
    let path = repo.to_str().unwrap();

    call(&server, "main", "init_repository", json!({ "path": path })).await.unwrap();
    call(&server, "main", "set_identity", json!({ "path": path, "name": "Test", "email": "test@example.com" })).await.unwrap();
    call(&server, "main", "write_file", json!({ "path": path, "filePath": "a.txt", "content": "bonjour\n", "create": true })).await.unwrap();
    call(&server, "main", "stage_files", json!({ "path": path, "paths": ["a.txt"] })).await.unwrap();
    call(&server, "main", "create_commit", json!({ "path": path, "message": "premier commit", "amend": false })).await.unwrap();

    let commits = call(&server, "main", "get_commits", json!({ "path": path, "limit": 10 })).await.unwrap();
    let commits = commits.as_array().unwrap();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0]["message"], "premier commit");

    // L'erreur d'une commande garde le format que l'interface attend de Tauri.
    let (status, error) = call(&server, "main", "open_repository", json!({ "path": "/nulle/part" })).await.unwrap_err();
    assert_eq!(status, 400);
    assert!(error.is_object() || error.is_string(), "{error}");
}

#[tokio::test]
async fn working_tree_changes_are_pushed_through_the_websocket() {
    let server = start().await;
    let repo = server._dir.path().join("watched");
    let path = repo.to_str().unwrap();
    call(&server, "tab1", "init_repository", json!({ "path": path })).await.unwrap();

    let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{}/api/ws?window=tab1", server.addr)).await.unwrap();
    call(&server, "tab1", "workdir_watch", json!({ "path": path, "onChange": 5 })).await.unwrap();
    std::fs::write(repo.join("nouveau.txt"), "x").unwrap();

    let message = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let value: Value = serde_json::from_str(text.as_str()).unwrap();
            if value["t"] == "channel" {
                return value;
            }
        }
    })
    .await
    .expect("aucun signal de surveillance");
    assert_eq!(message["id"], 5);
    assert_eq!(message["data"]["status"], true);

    // Sans WebSocket connecté, un flux ne peut pas être ouvert.
    let (status, _) = call(&server, "autre", "workdir_watch", json!({ "path": path, "onChange": 1 })).await.unwrap_err();
    assert_eq!(status, 400);
}

const TOKEN: &str = "un-jeton-de-test-assez-long";

fn raw(server: &Server, method: &str, path: &str, headers: &[(&str, &str)], body: Option<Value>) -> (u16, String, Vec<(String, String)>) {
    let url = format!("http://{}{path}", server.addr);
    let mut request = ureq::request(method, &url);
    for (name, value) in headers {
        request = request.set(name, value);
    }
    let result = match body {
        Some(body) => request.send_json(body),
        None => request.call(),
    };
    let response = match result {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(e) => panic!("{e}"),
    };
    let status = response.status();
    let names: Vec<String> = response.headers_names();
    let headers = names.iter().map(|n| (n.clone(), response.header(n).unwrap_or_default().to_string())).collect();
    (status, response.into_string().unwrap_or_default(), headers)
}

#[tokio::test(flavor = "multi_thread")]
async fn token_mode_requires_a_session() {
    let server = start_with(|c| {
        c.auth = merathon_lib::server::config::AuthMode::Token;
        c.token = Some(TOKEN.into());
        c.allowed_roots = vec![c.data_dir.clone()];
    })
    .await;
    let invoke = |headers: &[(&str, &str)]| tokio::task::block_in_place(|| raw(&server, "POST", "/api/invoke/app_info", headers, Some(json!({})))).0;

    assert_eq!(invoke(&[("X-Merathon-Window", "main")]), 401);
    assert_eq!(invoke(&[("X-Merathon-Window", "main"), ("Authorization", "Bearer faux")]), 401);
    let bearer = format!("Bearer {TOKEN}");
    assert_eq!(invoke(&[("X-Merathon-Window", "main"), ("Authorization", &bearer)]), 200);

    // La page de connexion échange le jeton contre un cookie de session.
    let (status, _, _) = tokio::task::block_in_place(|| raw(&server, "POST", "/api/login", &[], Some(json!({ "token": "faux" }))));
    assert_eq!(status, 401);
    let (status, _, headers) = tokio::task::block_in_place(|| raw(&server, "POST", "/api/login", &[], Some(json!({ "token": TOKEN }))));
    assert_eq!(status, 204);
    let cookie = headers.iter().find(|(n, _)| n.eq_ignore_ascii_case("set-cookie")).unwrap().1.clone();
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"), "{cookie}");
    let session = cookie.split(';').next().unwrap().to_string();

    let (status, body, _) =
        tokio::task::block_in_place(|| raw(&server, "POST", "/api/invoke/server_info", &[("X-Merathon-Window", "main"), ("Cookie", &session)], Some(json!({}))));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("\"auth\":\"token\""), "{body}");

    // L'état de la connexion est lisible sans être connecté.
    let (_, body, _) = tokio::task::block_in_place(|| raw(&server, "GET", "/api/session", &[], None));
    assert!(body.contains("\"authenticated\":false"), "{body}");
    let (_, body, _) = tokio::task::block_in_place(|| raw(&server, "GET", "/api/session", &[("Cookie", &session)], None));
    assert!(body.contains("\"authenticated\":true"), "{body}");

    // Le WebSocket est protégé comme les commandes.
    let refused = tokio_tungstenite::connect_async(format!("ws://{}/api/ws?window=tab1", server.addr)).await;
    assert!(refused.is_err(), "WebSocket accepté sans connexion");
}

#[tokio::test(flavor = "multi_thread")]
async fn requests_from_another_origin_are_refused() {
    let server = start().await;
    let host = server.addr.to_string();
    let same = format!("http://{host}");
    let ok = tokio::task::block_in_place(|| {
        raw(&server, "POST", "/api/invoke/app_info", &[("X-Merathon-Window", "main"), ("Origin", &same)], Some(json!({}))).0
    });
    assert_eq!(ok, 200);
    let foreign = tokio::task::block_in_place(|| {
        raw(&server, "POST", "/api/invoke/app_info", &[("X-Merathon-Window", "main"), ("Origin", "https://evil.example")], Some(json!({}))).0
    });
    assert_eq!(foreign, 403);

    let mut request = format!("ws://{host}/api/ws?window=tab1").into_client_request().unwrap();
    request.headers_mut().insert("Origin", "https://evil.example".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(request).await.is_err(), "WebSocket d'une autre origine accepté");
}

#[tokio::test(flavor = "multi_thread")]
async fn paths_outside_the_allowed_roots_and_the_disabled_terminal_are_refused() {
    let server = start_with(|c| {
        let root = c.data_dir.join("git");
        std::fs::create_dir_all(&root).unwrap();
        c.allowed_roots = vec![root];
    })
    .await;
    let allowed = server._dir.path().join("data/git/depot");
    call(&server, "main", "init_repository", json!({ "path": allowed.to_str().unwrap() })).await.unwrap();

    for command in ["init_repository", "open_repository", "list_device_folders"] {
        let args = if command == "list_device_folders" { json!({ "dir": "/etc" }) } else { json!({ "path": "/tmp/hors-racine" }) };
        let (status, body) = call(&server, "main", command, args).await.unwrap_err();
        assert_eq!(status, 403, "{command} : {body}");
    }
    let (status, body) = call(&server, "main", "terminal_open", json!({ "cwd": allowed.to_str().unwrap(), "cols": 80, "rows": 24, "onEvent": 1 })).await.unwrap_err();
    assert_eq!(status, 403);
    assert!(body.as_str().unwrap().to_lowercase().contains("terminal"), "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn responses_carry_security_headers_and_the_base_path_is_honoured() {
    let server = start_with(|c| {
        c.base_path = "/merathon".into();
        c.frame_ancestors = "https://nas.example:5001".into();
    })
    .await;
    let (status, body, headers) = tokio::task::block_in_place(|| raw(&server, "GET", "/merathon/", &[], None));
    assert_eq!(status, 200);
    assert!(body.contains("Merathon"));
    let header = |name: &str| headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.clone()).unwrap_or_default();
    assert!(header("content-security-policy").contains("frame-ancestors https://nas.example:5001"));
    assert_eq!(header("x-content-type-options"), "nosniff");
    // L'API suit le même préfixe, et rien n'est servi hors de lui.
    let (status, ..) = tokio::task::block_in_place(|| raw(&server, "POST", "/merathon/api/invoke/app_info", &[("X-Merathon-Window", "main")], Some(json!({}))));
    assert_eq!(status, 200);
    let (status, ..) = tokio::task::block_in_place(|| raw(&server, "POST", "/api/invoke/app_info", &[("X-Merathon-Window", "main")], Some(json!({}))));
    assert_eq!(status, 404);
}

/// Régression : `forge_api` reçoit une adresse d'API dans `path`, que le contrôle des dossiers prenait pour un dossier du disque
/// (« Dossier hors des dossiers autorisés : /user/repos?… ») et qui empêchait de lister ses dépôts pour cloner.
#[tokio::test(flavor = "multi_thread")]
async fn forge_api_paths_are_not_checked_as_folders() {
    let server = start_with(|c| {
        let root = c.data_dir.join("git");
        std::fs::create_dir_all(&root).unwrap();
        c.allowed_roots = vec![root];
    })
    .await;
    let api = "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
    for command in ["forge_api", "forge_api_send"] {
        let (status, body) = call(&server, "main", command, json!({ "accountId": "inconnu", "method": "POST", "path": api })).await.unwrap_err();
        // Refusé pour une autre raison (aucun compte) : pas par le contrôle des dossiers.
        assert_ne!(status, 403, "{command} : {body}");
        assert!(!body.to_string().contains("hors des dossiers"), "{command} : {body}");
    }
    // Un vrai chemin de dossier hors des dossiers autorisés reste refusé.
    let (status, _) = call(&server, "main", "open_repository", json!({ "path": "/etc" })).await.unwrap_err();
    assert_eq!(status, 403);
}

/// Un dossier partagé de NAS (ACL) rend tous les fichiers exécutables : sans correction, chacun apparaît « modifié » sans différence.
/// Ouvrir le dépôt dans Merathon rétablit un état propre.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn opening_a_repository_on_an_acl_share_does_not_show_every_file_as_modified() {
    use std::os::unix::fs::PermissionsExt;
    let server = start().await;
    let dir = server._dir.path().join("partage");
    let repo = git2::Repository::init(&dir).unwrap();
    for i in 0..5 {
        std::fs::write(dir.join(format!("f{i}.txt")), format!("contenu {i}\n")).unwrap();
    }
    let mut index = repo.index().unwrap();
    index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
    index.write().unwrap();
    {
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("T", "t@example.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
    }
    for i in 0..5 {
        std::fs::set_permissions(dir.join(format!("f{i}.txt")), std::fs::Permissions::from_mode(0o777)).unwrap();
    }
    let path = dir.to_str().unwrap();

    let before = call(&server, "main", "get_status", json!({ "path": path })).await.unwrap();
    assert_eq!(before.as_array().unwrap().len(), 5, "le symptôme : cinq fichiers modifiés sans aucune différence de contenu");

    call(&server, "main", "open_repository", json!({ "path": path })).await.unwrap();
    let after = call(&server, "main", "get_status", json!({ "path": path })).await.unwrap();
    assert!(after.as_array().unwrap().is_empty(), "{after}");
}

/// Dépôt « distant » (nu) avec un commit sur main et `branches` branches, et son clone local.
fn remote_and_clone(root: &std::path::Path, branches: usize) -> (git2::Repository, std::path::PathBuf) {
    std::fs::create_dir_all(root).unwrap();
    let remote = git2::Repository::init_bare(root.join("origin.git")).unwrap();
    add_remote_commit(&remote, "init", branches, "a");
    let local = root.join("depots").join("projet");
    git2::Repository::clone(root.join("origin.git").to_str().unwrap(), &local).unwrap();
    (remote, local)
}

/// Nouveau commit sur main du dépôt nu, et `branches` branches `{prefix}-{i}` qui le pointent.
fn add_remote_commit(remote: &git2::Repository, message: &str, branches: usize, prefix: &str) {
    let sig = git2::Signature::now("Coéquipier", "c@example.com").unwrap();
    let tree = remote.find_tree(remote.treebuilder(None).unwrap().write().unwrap()).unwrap();
    let parent = remote.refname_to_id("refs/heads/main").ok().map(|id| remote.find_commit(id).unwrap());
    let id = remote.commit(Some("refs/heads/main"), &sig, &sig, message, &tree, &parent.iter().collect::<Vec<_>>()).unwrap();
    for i in 0..branches {
        remote.reference(&format!("refs/heads/{prefix}-{i}"), id, true, "test").unwrap();
    }
}

fn remote_branches(local: &std::path::Path) -> usize {
    let repo = git2::Repository::open(local).unwrap();
    repo.branches(Some(git2::BranchType::Remote)).unwrap().count()
}

#[tokio::test(flavor = "multi_thread")]
async fn simultaneous_fetches_of_one_repository_do_not_fight_over_its_locks() {
    let server = start().await;
    // Un dépôt par tour : dans un même dépôt, les fetch automatiques suivants seraient sautés (fetch récent).
    for round in 0..3 {
        let root = server._dir.path().join(format!("tour{round}"));
        let (remote, local) = remote_and_clone(&root, 5);
        let path = local.to_str().unwrap().to_string();
        // Le distant change, puis quatre pages synchronisent en même temps et deux personnes cliquent sur Fetch.
        add_remote_commit(&remote, "nouveau", 30, "t");
        let calls: Vec<_> = (0..6)
            .map(|page| {
                let args = if page < 4 {
                    json!({ "path": path, "remote": null, "background": true })
                } else {
                    json!({ "path": path, "remote": null })
                };
                let window = format!("page{page}");
                let server = &server;
                async move { call(server, &window, "fetch_remote", args).await }
            })
            .collect();
        for result in futures_util::future::join_all(calls).await {
            assert!(result.is_ok(), "tour {round} : {result:?}");
        }
        // origin/main et les 5 + 30 branches.
        assert_eq!(remote_branches(&local), 1 + 5 + 30);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_automatic_fetch_right_after_another_is_skipped_but_a_manual_fetch_is_not() {
    let server = start().await;
    let (remote, local) = remote_and_clone(server._dir.path(), 0);
    let path = local.to_str().unwrap();
    call(&server, "page1", "fetch_remote", json!({ "path": path, "remote": null, "background": true })).await.unwrap();
    add_remote_commit(&remote, "nouveau", 1, "nouvelle");

    call(&server, "page2", "fetch_remote", json!({ "path": path, "remote": null, "background": true })).await.unwrap();
    assert_eq!(remote_branches(&local), 1, "fetch automatique d'une autre page, quelques secondes après : sauté");

    call(&server, "page2", "fetch_remote", json!({ "path": path, "remote": null })).await.unwrap();
    assert_eq!(remote_branches(&local), 2, "fetch demandé à la main : toujours fait");
}
