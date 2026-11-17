# Recette SynoCommunity (spksrc) de Merathon

[SynoCommunity](https://synocommunity.com) propose des paquets au Centre de paquets de DSM depuis sa propre source
(`https://packages.synocommunity.com`). Ses paquets sont **compilés depuis les sources** par leur outil
[spksrc](https://github.com/SynoCommunity/spksrc) : ce dossier contient la recette de Merathon, au format de ce dépôt.

```
cross/merathon/       compile merathon-server (Rust, --features server, sans Tauri) depuis l'archive du tag
cross/merathon_web/   interface web (merathon-web-<version>.tar.gz, jointe à chaque release par le workflow Release)
spk/merathon/         le paquet : service, assistant d'installation (dossier partagé, connexion, jeton, terminal)
```

Ce n'est **pas** le paquet de `packaging/synology/` : celui-ci est assemblé par le workflow Release avec un binaire musl, pour
la source de paquets propre à Merathon et pour l'installation manuelle. Les deux coexistent.

L'icône du menu DSM ouvre une page du paquet servie par DSM (`spk/merathon/src/app/`), qui mène à l'adresse saisie dans l'assistant (proxy inverse)
ou, à défaut, au port du service. Cette page et l'assistant sont les mêmes que ceux de `packaging/synology` : `test-service-setup.sh` le vérifie,
avec le script de service (jeton, adresse, `app/address.js`). La recette garde la déclaration de port de spksrc (`SERVICE_PORT`) : DSM refuse alors un
proxy inverse sur ce même port, à placer sur un autre port ou un autre nom d'hôte.

## Essayer la recette ici

Prérequis : Docker, un clone de spksrc (`git clone --depth 1 https://github.com/SynoCommunity/spksrc`), et l'interface construite
(`cd git-client && npm run build:server`).

```sh
packaging/spksrc/test-build.sh <clone de spksrc> git-client/dist-server            # x64, DSM 7.2
packaging/spksrc/test-build.sh <clone de spksrc> git-client/dist-server arch-aarch64-7.2
```

Le script sert l'arbre local (code et interface) à la place des adresses GitHub, dans une copie de la recette. La compilation
d'une architecture prend longtemps (toolchain Synology, OpenSSL, Rust).

## Proposer le paquet à SynoCommunity

1. Publier une release de Merathon (le workflow joint `merathon-web-<version>.tar.gz`), puis `packaging/spksrc/update-digests.sh <version>`.
2. Dans un fork de spksrc, sur une **nouvelle branche** (pas `master`) : copier `cross/merathon`, `cross/merathon_web` et `spk/merathon`.
3. Vérifier, comme l'exige la liste de contrôle de leur [guide de contribution](https://github.com/SynoCommunity/spksrc/blob/master/CONTRIBUTING.md) :
   - `make all-supported` : chaque architecture compile, ou est exclue (`UNSUPPORTED_ARCHS`, `MIN_GCC_VERSION`, `REQUIRE_64BIT`) ;
   - installation neuve sur un **vrai DSM** sans erreur dans `/var/log/packages/merathon` ;
   - mise à jour (même version réinstallée) : l'assistant s'affiche en mode mise à jour et la configuration est conservée.
4. Ouvrir la pull request. Les mainteneurs relisent : l'acceptation n'est pas garantie.
5. Ensuite, à chaque version : `update-digests.sh`, `SPK_REV` incrémenté (jamais remis à 1), `CHANGELOG` à jour.

## Points à confirmer pendant la relecture

- Faut-il que l'interface soit compilée par spksrc (Node) plutôt que récupérée précompilée ? `vaultwarden` récupère son interface
  précompilée de la même façon (`cross/vaultwarden_web`).
- Architectures : x64 et aarch64 compilent avec spksrc (DSM 7.2) ; seul x86_64 a été installé sur un vrai DSM ; armv7 n'a pas été
  compilé (à exclure si la compilation échoue).
- Git LFS demande les binaires `git` et `git-lfs`, absents de DSM : voir `docs/nas.fr.md`.
