//! `#[command]` : déclare une commande de l'interface une seule fois.
//!
//! - Avec la fonctionnalité `tauri-app` (bureau, Android), elle devient une commande Tauri
//!   (`#[command(async)]` → `#[tauri::command(async)]`), sans autre changement.
//! - Avec la fonctionnalité `server` (NAS), elle s'inscrit en plus dans la table des commandes du
//!   serveur HTTP (`crate::server::dispatch`), qui désérialise les arguments JSON par leur nom
//!   (en camelCase, comme l'IPC de Tauri), appelle la fonction et sérialise le résultat.
//!
//! Types de paramètres reconnus par leur dernier segment : `Host` (le contexte de l'application),
//! `Window` (l'onglet appelant) et `Channel<T>` (flux vers l'interface, identifié par son `channelId`).
//! Tous les autres sont désérialisés depuis les arguments.

use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{parse_macro_input, FnArg, ItemFn, Pat, ReturnType, Type};

/// `snake_case` → `camelCase`, comme la conversion des arguments de Tauri.
fn camel_case(name: &str) -> String {
    let mut out = String::new();
    let mut upper = false;
    for c in name.trim_start_matches('_').chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn last_segment(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}

#[proc_macro_attribute]
pub fn command(attr: TokenStream, item: TokenStream) -> TokenStream {
    let tauri_args = TokenStream2::from(attr);
    let func = parse_macro_input!(item as ItemFn);
    let name = func.sig.ident.clone();
    let name_str = name.to_string();

    let tauri_attr = if tauri_args.is_empty() {
        quote! { #[cfg_attr(feature = "tauri-app", tauri::command)] }
    } else {
        quote! { #[cfg_attr(feature = "tauri-app", tauri::command(#tauri_args))] }
    };

    // Les `#[cfg(...)]` de la fonction valent aussi pour son inscription au serveur.
    let cfgs: Vec<_> = func.attrs.iter().filter(|a| a.path().is_ident("cfg")).collect();

    let mut extract = Vec::new();
    let mut call_args = Vec::new();
    for (i, input) in func.sig.inputs.iter().enumerate() {
        let FnArg::Typed(arg) = input else {
            return syn::Error::new_spanned(input, "#[command] : pas de méthode").to_compile_error().into();
        };
        let ident = match &*arg.pat {
            Pat::Ident(p) => p.ident.clone(),
            _ => format_ident!("__arg{i}"),
        };
        let key = camel_case(&ident.to_string());
        let ty = &arg.ty;
        let local = format_ident!("__{}", i);
        let kind = last_segment(ty).unwrap_or_default();
        let value = match kind.as_str() {
            "Host" => quote! { inv.host() },
            "Window" => quote! { inv.window() },
            "Channel" => quote! { inv.channel(#key)? },
            _ => quote! { inv.arg::<#ty>(#key)? },
        };
        extract.push(quote! { let #local: #ty = #value; });
        call_args.push(local);
    }

    let is_async = func.sig.asyncness.is_some();
    let invoke = if is_async {
        quote! { #name(#(#call_args),*).await }
    } else {
        quote! {
            ::tokio::task::spawn_blocking(move || #name(#(#call_args),*))
                .await
                .map_err(|e| ::serde_json::Value::String(e.to_string()))?
        }
    };

    let to_output = match &func.sig.output {
        ReturnType::Default => quote! { { let () = result; Ok(::serde_json::Value::Null) } },
        ReturnType::Type(_, ty) if last_segment(ty).as_deref() == Some("Result") => quote! {
            match result {
                Ok(v) => crate::server::dispatch::to_json(&v),
                Err(e) => Err(crate::server::dispatch::to_json(&e).unwrap_or_else(|e| e)),
            }
        },
        ReturnType::Type(..) => quote! { crate::server::dispatch::to_json(&result) },
    };

    let registration = quote! {
        #[cfg(feature = "server")]
        #(#cfgs)*
        const _: () = {
            ::inventory::submit! {
                crate::server::dispatch::CommandEntry {
                    name: #name_str,
                    handler: |mut inv| ::std::boxed::Box::pin(async move {
                        #(#extract)*
                        let result = #invoke;
                        #to_output
                    }),
                }
            }
        };
    };

    quote! {
        #tauri_attr
        #func
        #registration
    }
    .into()
}
