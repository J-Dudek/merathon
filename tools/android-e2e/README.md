# Tests de bout en bout sur Android

Parcours de Merathon sur un émulateur (ou un téléphone de test) : la vraie application, installée depuis un APK de debug, pilotée comme le ferait une personne (gestes `adb`, saisie au clavier), contre des serveurs **locaux et fictifs**. Rien ne touche à GitHub, à GitLab ni à un compte réel.

Lancé en CI par le workflow `.github/workflows/android-e2e.yml` (PR qui touchent au code propre à Android, ou à la main).

## Ce qui est vérifié

| Étape | Vérifié côté serveur ou appareil |
|---|---|
| Premier lancement, choix de la langue | |
| Identité Git | |
| Compte **GitHub Enterprise** ajouté depuis l'interface (URL + token) | `GET /api/v3/user` |
| Clone HTTPS avec le token du compte | dépôt sur l'appareil |
| Modification d'un fichier dans l'application (« Fichiers du dépôt… ») | contenu sur l'appareil |
| Commit et push | commit et contenu dans le dépôt du serveur |
| Fetch du commit d'un coéquipier | |
| Approbation d'une pull request | revue `APPROVED` sur le serveur |
| Menu d'une branche par le bouton « ⋮ », fermé par Retour | |
| Retour d'Android : diff plein écran → PR → fermé ; fichier → liste → éditeur fermé | fenêtres ouvertes |
| Retour d'Android depuis le diff d'un fichier d'un commit : retour à la liste des fichiers du commit | écran affiché |
| Mémo Git ouvert sans clavier, avec les équivalents tactiles | aucun champ n'a le focus |
| SSH : réglage expérimental, clé du Keystore, empreinte de l'hôte, confirmation par code | empreinte affichée = celle du serveur ; authentification ECDSA acceptée |
| SSH : clone sans nouvelle confirmation (moins de 30 s) | `git-upload-pack` dans le journal SSH |
| SSH : aucune clé privée dans les fichiers de l'application | `.ssh` ne contient que `known_hosts` |

`pr-watch.mjs` vérifie à part l'activité des PR quand l'application est fermée (Préférences > Synchronisation > « Quand Merathon est fermé », tâche WorkManager) :

| Étape | Vérifié côté appareil |
|---|---|
| Option désactivée par défaut | aucune tâche dans `dumpsys jobscheduler` |
| Option activée : tâche programmée, liste « mes PR » transmise à la tâche | tâche WorkManager ; `pr-watch.json` |
| Application au premier plan : la tâche ne fait rien | trace `MerathonPrWatch` |
| Fermée : commit d'un coéquipier sur une PR à relire | notification « PR #9 · … » dans `dumpsys notification` (pastille sur l'icône) |
| Pas de deuxième notification sans nouveau changement | |
| Processus arrêté : WorkManager relance l'application sans interface (CI en échec) | deuxième notification |
| À l'ouverture, pas de bandeau pour ce qui a déjà été notifié | |
| PR consultée dans l'application : notifications retirées | plus aucune notification |
| Option désactivée : tâche annulée | |

WorkManager refuse d'exécuter une tâche périodique avant son heure, même par `cmd jobscheduler run -f` : l'APK de debug a un récepteur réservé au shell `adb` (`src/debug/…/PrWatchRunNow.kt`) qui lance la même vérification tout de suite. `smoke-release.mjs` vérifie en release que la programmation et le premier passage survivent à R8.

Les étapes SSH posent un code PIN (`1234`) sur l'appareil puis le retirent, ce qui efface la clé de test. Elles sont ignorées si l'appareil a déjà un verrouillage d'écran.

## Lancer

Prérequis : `adb` dans le `PATH` et un seul appareil connecté (émulateur x86_64 conseillé), Node 22+, Python 3 avec `paramiko` (`pip install paramiko`), git.

```bash
# APK de debug (la WebView n'est pilotable qu'en debug), depuis git-client/
npx tauri android build --debug --apk --target x86_64 --ci
git restore src-tauri/gen/schemas/acl-manifests.json

# Parcours, depuis la racine du dépôt
node tools/android-e2e/run.mjs --apk git-client/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
# Vérification des PR en arrière-plan (même APK, données effacées aussi)
node tools/android-e2e/pr-watch.mjs
```

**Les données de l'application sur l'appareil sont effacées** au début (`pm clear`) pour partir d'un état connu ; `--keep-data` l'évite.

| Option | Effet |
|---|---|
| `--apk chemin` | installe cet APK avant le parcours |
| `--keep-data` | garde les données de l'application |
| `--no-ssh` | saute les étapes SSH (pas besoin de `paramiko`) |
| `--out dossier` | captures d'écran (une par étape, `NN-ok.png` / `NN-echec.png`), `resultats.json` et, en cas d'échec, le texte de l'écran |

Variables : `E2E_WORK` (dossier de travail, `tools/android-e2e/.work` par défaut), `E2E_GITHUB_PORT` (8765), `E2E_SSH_PORT` (2222), `E2E_CDP_PORT` (9333).

## Fonctionnement

- `fake/make_repos.sh` crée deux dépôts fictifs (`atelier/site-vitrine`, `atelier/boutique-api`), auteurs en `example.com`.
- `fake/fake_github.py` imite GitHub Enterprise : API REST `/api/v3`, GraphQL `/api/graphql`, git en HTTP (`git http-backend`), et des actions de test (`/__test/teammate-push`, `/__test/state`…). Il accepte n'importe quel token.
- `fake/fake_sshd.py` sert git en SSH (paramiko), pour l'utilisateur `git`, avec les clés envoyées par « Configurer SSH… » (`POST /user/keys`).
- `adb reverse` rend ces serveurs joignables depuis l'appareil sur `localhost` (seule adresse HTTP acceptée pour un compte) ; le port 22 de l'émulateur renvoie vers le serveur SSH, car Merathon vise toujours le port 22.
- `lib.mjs` lit l'interface par le protocole DevTools de la WebView (`adb forward` vers `webview_devtools_remote_<pid>`) et agit par de vrais gestes (`adb shell input tap`, appui long) ; le texte passe par `Input.insertText`, comme un clavier.

La demande de code PIN est une fenêtre sécurisée du système : elle apparaît noire sur les captures et se remplit au clavier (`adb shell input text`).

## Écrire une étape

```js
await step("Ce que fait l'étape", async () => {
  await menu("Fichiers du dépôt…");                   // ☰ puis une entrée
  await app.tap("README.md", { within: "[role=dialog]" });
  await app.fill("Résumé du commit", "Mon message");  // libellé : aria-label, title, texte, placeholder ou <label>
  await app.tap("^Commiter");                         // « ^ » : le libellé commence par…
  await app.waitText("Aucune modification en cours");
});
```

Vérifier aussi l'effet côté serveur (`serverGit`, `serverState`) ou appareil (`onDevice`), pas seulement l'affichage.
