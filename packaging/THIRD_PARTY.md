# Composants tiers / Third-party components

Le binaire `merathon-server` est lié statiquement (musl) avec les bibliothèques ci-dessous, en plus des crates Rust
listées dans `git-client/src-tauri/Cargo.lock` (chacune sous sa propre licence, toutes compatibles avec la licence MIT de
Merathon).

The `merathon-server` binary is statically linked (musl) with the libraries below, besides the Rust crates listed in
`git-client/src-tauri/Cargo.lock` (each under its own license, all compatible with Merathon's MIT license).

| Composant / Component | Licence / License |
|---|---|
| libgit2 | GPL-2.0 with linking exception |
| libssh2 | BSD-3-Clause |
| OpenSSL 3 | Apache-2.0 |
| zlib | zlib |
| musl libc | MIT |

Les textes de licence sont fournis par les projets d'origine. / License texts are provided by the upstream projects.
