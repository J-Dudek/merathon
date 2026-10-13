//! Terminaux intégrés : un shell de l'utilisateur dans un pseudo-terminal, ouvert dans le
//! dossier du dépôt. La sortie est envoyée au frontend (xterm.js) par un canal ; les frappes
//! reviennent par `terminal_write`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TerminalEvent {
    Output { data: String },
    /// Le shell s'est terminé (code de sortie s'il est connu).
    Exit { code: Option<u32> },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Fenêtre propriétaire : ses terminaux sont fermés avec elle.
    window: String,
}

#[derive(Default)]
pub struct Terminals {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl Terminals {
    fn close(&self, id: u32) {
        let session = self.sessions.lock().unwrap().remove(&id);
        if let Some(mut s) = session {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }

    /// Ferme les terminaux d'une fenêtre fermée.
    pub fn close_window(&self, window: &str) {
        let ids: Vec<u32> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.window == window)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            self.close(id);
        }
    }
}

/// Décode un flux UTF-8 arrivant par morceaux : un caractère coupé entre deux lectures
/// est gardé pour la suivante au lieu d'être remplacé par �.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(s) => {
                    out.push_str(s);
                    self.pending.clear();
                    return out;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap());
                    match e.error_len() {
                        // Séquence incomplète en fin de tampon : on attend la suite.
                        None => {
                            self.pending.drain(..valid);
                            return out;
                        }
                        // Octets invalides : remplacés, puis on continue.
                        Some(len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            self.pending.drain(..valid + len);
                        }
                    }
                }
            }
        }
    }
}

pub fn open(
    app: &AppHandle,
    window: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<u32, String> {
    if !Path::new(cwd).is_dir() {
        return Err(format!("Dossier introuvable : {cwd}"));
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Impossible de créer le terminal : {e}"))?;

    // Shell par défaut de l'utilisateur ($SHELL / compte sous Unix, cmd.exe sous Windows).
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Impossible de lancer le shell : {e}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let state = app.state::<Terminals>();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(
        id,
        Session { master: pair.master, writer, child, window: window.to_string() },
    );

    let app = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut decoder = Utf8Stream::default();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = decoder.push(&buf[..n]);
                    if !data.is_empty() && on_event.send(TerminalEvent::Output { data }).is_err() {
                        break; // fenêtre fermée
                    }
                }
            }
        }
        // Fin du shell (exit) ou terminal fermé par `close`.
        let session = app.state::<Terminals>().sessions.lock().unwrap().remove(&id);
        let code = session.and_then(|mut s| s.child.wait().ok()).map(|status| status.exit_code());
        let _ = on_event.send(TerminalEvent::Exit { code });
    });

    Ok(id)
}

pub fn write(app: &AppHandle, id: u32, data: &str) -> Result<(), String> {
    let state = app.state::<Terminals>();
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("Terminal fermé")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(app: &AppHandle, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let state = app.state::<Terminals>();
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("Terminal fermé")?;
    session
        .master
        .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn close(app: &AppHandle, id: u32) {
    app.state::<Terminals>().close(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_stream_keeps_split_characters() {
        let mut s = Utf8Stream::default();
        let bytes = "é→x".as_bytes(); // é = 2 octets, → = 3 octets
        assert_eq!(s.push(&bytes[..1]), "");
        assert_eq!(s.push(&bytes[1..3]), "é");
        assert_eq!(s.push(&bytes[3..]), "→x");
    }

    /// Lance un vrai shell dans un pseudo-terminal, ouvert dans le dossier demandé.
    #[cfg(unix)]
    #[test]
    fn shell_starts_in_requested_directory() {
        let dir = tempfile::tempdir().unwrap();
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new("sh");
        cmd.cwd(dir.path());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"pwd; exit\n").unwrap();

        let mut out = String::new();
        let mut decoder = Utf8Stream::default();
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            out.push_str(&decoder.push(&buf[..n]));
            if out.contains(dir.path().file_name().unwrap().to_str().unwrap()) {
                break;
            }
        }
        let _ = child.wait();
        assert!(out.contains(dir.path().file_name().unwrap().to_str().unwrap()), "sortie : {out}");
    }

    #[test]
    fn utf8_stream_replaces_invalid_bytes() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.push(b"a\xffb"), "a\u{FFFD}b");
    }
}
