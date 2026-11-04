//! Langue des messages renvoyés à l'interface, choisie par le frontend au chargement de chaque fenêtre.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_language(language: String) {
    ENGLISH.store(language == "en", Ordering::Relaxed);
}

/// Message en français ou en anglais selon la langue de l'interface : `tr!("Fermé : {x}", "Closed: {x}")`.
macro_rules! tr {
    ($fr:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::is_english() { format!($en $(, $arg)*) } else { format!($fr $(, $arg)*) }
    };
}
