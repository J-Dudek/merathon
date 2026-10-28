# Changelog

Toutes les évolutions notables de Merathon, générées à partir des messages de commit.

## [2.9.1](https://github.com/J-Dudek/merathon/compare/v2.9.0...v2.9.1) (2026-10-28)

### Corrections

- le push rebranche la branche sur sa branche distante réelle (3e3e497)

## [2.9.0](https://github.com/J-Dudek/merathon/compare/v2.8.0...v2.9.0) (2026-10-27)

### Nouveautés

- ajout modification des PR via l'app (titre et contenu) (8476dd7)
- ajout de l'auto-complétion de PR/MR et du close de celles-ci. update doc (afffce1)

## [2.8.0](https://github.com/J-Dudek/merathon/compare/v2.7.2...v2.8.0) (2026-10-21)

### Nouveautés

- ajout details sur rebase interactif (8f01714)

## [2.7.2](https://github.com/J-Dudek/merathon/compare/v2.7.1...v2.7.2) (2026-10-16)

### Corrections

- count fusion when fusion by MR/PR details window (bda5fdd)

## [2.7.1](https://github.com/J-Dudek/merathon/compare/v2.7.0...v2.7.1) (2026-10-16)

### Corrections

- Switch to icons to avoid problems when the font isn't installed (c378772)
- UI issue on WSL (6907654)
- RGAA issue (afea39d)

## [2.7.0](https://github.com/J-Dudek/merathon/compare/v2.6.0...v2.7.0) (2026-10-15)

### Nouveautés

- RGAA (844cdfd)

### Autres changements

- design issue (cadc31c)

## [2.6.0](https://github.com/J-Dudek/merathon/compare/v2.5.2...v2.6.0) (2026-10-15)

### Nouveautés

- ajout actions sur dossier en mode contextuel (ab4d1d9)
- ajout redimensionnement sur la partie graph (48b7241)

### Corrections

- correctif sur rebase interactif (ec70b04)

## [2.5.2](https://github.com/J-Dudek/merathon/compare/v2.5.1...v2.5.2) (2026-10-15)

### Corrections

- wrap long context menu labels instead of truncating them (83a67c4)

## [2.5.1](https://github.com/J-Dudek/merathon/compare/v2.5.0...v2.5.1) (2026-10-15)

### À savoir

- Ouvrir avec la version Windows un dépôt situé dans WSL est désormais possible : Merathon propose de lui faire confiance à la première ouverture. Attention, ce sera nettement plus lent que sur un disque Windows, et c'est normal : chaque lecture de fichier traverse la frontière entre Windows et WSL, et l'état du dépôt demande d'examiner tous ses fichiers. Pour vos dépôts WSL, préférez la version Linux lancée dans WSL.

### Corrections

- run git commands off the main thread (a4eb350)
- open WSL repositories from the Windows build (78833b4)

## [2.5.0](https://github.com/J-Dudek/merathon/compare/v2.4.1...v2.5.0) (2026-10-15)

### Nouveautés

- list the changes of every missed version in the update dialog (cad258d)
- show the PR count badge on the taskbar icon under WSL (26b8cef)
- show Windows notifications under WSL when no Linux notification server is available (0b5a247)

### Corrections

- show the PR count badge on the Windows taskbar (c4200bf)

## [2.4.1](https://github.com/J-Dudek/merathon/compare/v2.4.0...v2.4.1) (2026-10-14)

### Corrections

- remove PR notifications once the PR has been viewed (2396f22)

## [2.4.0](https://github.com/J-Dudek/merathon/compare/v2.3.0...v2.4.0) (2026-10-14)

### Nouveautés

- add branch menu (60fa6fe)
- ajout des notifications (2481f72)
- ajout icone dans la barre des tâches sur wsl (f2b118a)
- ajout bouton de synchronisation à côté du nom de la branche (4cc000f)

## [2.3.0](https://github.com/J-Dudek/merathon/compare/v2.2.0...v2.3.0) (2026-10-13)

### À savoir

- Attention, sous Linux avec le paquet .deb (Debian, Ubuntu, WSL) : après cette mise à jour, il se peut que Merathon ne se rouvre pas tout seul. Relance-le à la main ; la commande git-client devient merathon. Windows et AppImage ne sont pas concernés.

### Nouveautés

- link to the token creation page in the change token dialog (3d75680)

### Corrections

- keep the legacy keyring entry when migrating account tokens (e5d2987)
- install the app under the merathon name instead of git-client (466c411)

## [2.2.0](https://github.com/J-Dudek/merathon/compare/v2.1.0...v2.2.0) (2026-10-13)

### Nouveautés

- add memo fit in menu for newbie (f05a63c)
- add to .gitignore on right menu (57b61fd)

## [2.1.0](https://github.com/J-Dudek/merathon/compare/v2.0.0...v2.1.0) (2026-10-13)

### Nouveautés

- Expand the compatibility matrix (f147f8c)

## [2.0.0](https://github.com/J-Dudek/merathon/compare/v0.0.1-test...v2.0.0) (2026-10-13)

### ⚠ Changements incompatibles

- update CI and pass to public repo (fa56541)

## [1.9.0](https://github.com/J-Dudek/git-management/compare/v1.8.0...v1.9.0) (2026-10-12)

### Nouveautés

- add about section on menu fix: release job issue ([50ff712](https://github.com/J-Dudek/git-management/commit/50ff712cd77b3c2ede5bf752b38fe9625e8a5ae2))

## [1.8.0](https://github.com/J-Dudek/git-management/compare/v1.7.0...v1.8.0) (2026-10-12)

### Nouveautés

- design, display name on PR/MR consultation ([da37034](https://github.com/J-Dudek/git-management/commit/da37034a2944695aff78f3a849e3364902666c6e))

## [1.7.0](https://github.com/J-Dudek/git-management/compare/v1.6.0...v1.7.0) (2026-10-12)

### Nouveautés

- add resize on right and left sections ([9c7b409](https://github.com/J-Dudek/git-management/commit/9c7b409803b6f087ba5ba4f0c3b4890e4f75d0c3))
- add bypass for force merge ([b7be880](https://github.com/J-Dudek/git-management/commit/b7be8803d996f829ad94ac8f64bca1024c484bb9))
- add label on approuved MR ([6f59f48](https://github.com/J-Dudek/git-management/commit/6f59f48ae1c9108fba645653e1a12bb17e96bbf2))

## [1.6.0](https://github.com/J-Dudek/git-management/compare/v1.5.1...v1.6.0) (2026-10-09)

### Nouveautés

- add rebase possibility when it's possible and force push on pr ([b859976](https://github.com/J-Dudek/git-management/commit/b85997611ee83b425fe71301533648b68ebb0d43))
- add infobulles on menus ([0fd2f7c](https://github.com/J-Dudek/git-management/commit/0fd2f7c8c6ea8e1527234cedb7dd08bbdc7dcb23))
- ajout thème sombre,light et systeme ([1b0ecc0](https://github.com/J-Dudek/git-management/commit/1b0ecc01f21b5629c1b646dea855147f00aa68d6))
- resize on PR modale ([fa81930](https://github.com/J-Dudek/git-management/commit/fa8193058571fbf1d459e5fb5a83e79c1bf3d623))
- update files opération ([afcbe48](https://github.com/J-Dudek/git-management/commit/afcbe48a7ce01f76a28c412262dd789b7b8f2148))

## [1.5.1](https://github.com/J-Dudek/git-management/compare/v1.5.0...v1.5.1) (2026-10-08)

### Autres changements

- docs update readme. fix: design ([9f3d386](https://github.com/J-Dudek/git-management/commit/9f3d38657069435a2a88555e9917b953b657ff1c))

## [1.5.0](https://github.com/J-Dudek/git-management/compare/v1.4.0...v1.5.0) (2026-10-08)

### Nouveautés

- suivi des PR / MR lues, MR de tous les projets dans l'onglet Comptes, intervalle de synchronisation réglable ([86c8511](https://github.com/J-Dudek/git-management/commit/86c851165a4b2292ae36f2026abae925ce3688e4))
- synchronisation périodique des dépôts ouverts (fetch et PR / MR) ([4dbe935](https://github.com/J-Dudek/git-management/commit/4dbe93568e6334ad4e1d84aecbf712598d1aa919))

## [1.4.0](https://github.com/J-Dudek/git-management/compare/v1.3.0...v1.4.0) (2026-10-08)

### Nouveautés

- pull request review on app ([6041072](https://github.com/J-Dudek/git-management/commit/6041072647606fe9f9b27a6847e0b90702f63203))

## [1.3.0](https://github.com/J-Dudek/git-management/compare/v1.2.1...v1.3.0) (2026-10-08)

### Nouveautés

- add pull request management ([3581a22](https://github.com/J-Dudek/git-management/commit/3581a225f083491e45eee59fe226d3ae6b916593))
- ui branch management ([d7d80b3](https://github.com/J-Dudek/git-management/commit/d7d80b315a8a14fdd4d96b227b97f782223a355b))

## [1.2.1](https://github.com/J-Dudek/git-management/compare/v1.2.0...v1.2.1) (2026-10-06)

### Corrections

- fix update issue when 2 windows are open ([3940418](https://github.com/J-Dudek/git-management/commit/394041893ff70cb5dfb79d8572d117cf6df41a5e))

## [1.2.0](https://github.com/J-Dudek/git-management/compare/v1.1.0...v1.2.0) (2026-10-06)

### Nouveautés

- design, terminal, browser tab ([6055900](https://github.com/J-Dudek/git-management/commit/60559002899623920e7012bf772d16d38ee2be16))
- add terminal and git log ([59df736](https://github.com/J-Dudek/git-management/commit/59df73644d9ebd9b0a27c9a2a8e4b802ed8afd29))
- add browser tab ([6628d95](https://github.com/J-Dudek/git-management/commit/6628d9556e93ee501c63829a747a762607f7f2d1))

## [1.1.0](https://github.com/J-Dudek/git-management/compare/v1.0.1...v1.1.0) (2026-10-06)

### Nouveautés

- mises à jour automatiques de l'application ([46e8454](https://github.com/J-Dudek/git-management/commit/46e84547b73ddecc3da9b90c62c853d81ba8ac47))
- ajout auto-update ([2a3f53a](https://github.com/J-Dudek/git-management/commit/2a3f53ad73a2884d121273c6b6609bd2c201007d))

## [1.0.1](https://github.com/J-Dudek/git-management/compare/v1.0.0...v1.0.1) (2026-10-06)

### Corrections

- tls issue ([f5fa57b](https://github.com/J-Dudek/git-management/commit/f5fa57b1895fea7dae7ebf505db40fe7c320fc79))
- tls issue ([7aad4c6](https://github.com/J-Dudek/git-management/commit/7aad4c67591faf98b8b2e9c39171c092b9205bdf))

## 1.0.0 (2026-10-06)

### ⚠ Changements incompatibles

- première version stable ([dca2b27](https://github.com/J-Dudek/git-management/commit/dca2b2771496b83f64f61036ffbeaca9424647e4))

### Nouveautés

- delete multiples branchs ([0e48514](https://github.com/J-Dudek/git-management/commit/0e48514e58f26287c733c02708bc8467a63d01c6))
- UI pastilles ([54bc5f6](https://github.com/J-Dudek/git-management/commit/54bc5f64fee2d30139792d72d39c0f6a6151ad86))
- commit squash on the side ([bc09c7b](https://github.com/J-Dudek/git-management/commit/bc09c7b5825a81dee151efcbe307c51e0ca8bf7b))
- commit squash ([015ff7c](https://github.com/J-Dudek/git-management/commit/015ff7c43593fec3f311d5122844ad88455f8ec7))
- UI branch management ([7f27f19](https://github.com/J-Dudek/git-management/commit/7f27f19d7b88bb12dc93025a9d867514d7d2730d))
- link redirect on self-hosted ([df77ef0](https://github.com/J-Dudek/git-management/commit/df77ef0155c585c5c733df035b34c40fd6c67ad3))
- start the base version ([e58ee39](https://github.com/J-Dudek/git-management/commit/e58ee39db5b8b21ba3576990232048b333fad8d7))
- initial implementation of Git GUI client (Tauri + Rust + React) ([6b80313](https://github.com/J-Dudek/git-management/commit/6b80313c14e537a04109869f925e040cd4844de9))

### Corrections

- CI issue on test windows ([b0c881a](https://github.com/J-Dudek/git-management/commit/b0c881a538a3ad042bb467de831c45dbf1c1a1e4))
- solve CI issue on windows ([b27a9ff](https://github.com/J-Dudek/git-management/commit/b27a9ff7839f247065fe04cea2c7fa32fe33dd12))

### Autres changements

- ignore ([a8c9f13](https://github.com/J-Dudek/git-management/commit/a8c9f136caed068f29a607aa2454b3eff852ad85))
- Initial commit ([345660e](https://github.com/J-Dudek/git-management/commit/345660ea8386e3a56203ad5987a42e2b21e69697))
