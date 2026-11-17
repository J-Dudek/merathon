# Merathon sur un NAS (Synology, Docker)

Merathon peut tourner sur un NAS : le service `merathon-server` (le même moteur Git que l'application de bureau, sans
fenêtre) sert l'interface à votre navigateur. Les dépôts restent sur le NAS.

## Installer le paquet Synology (DSM 7.2 ou plus)

1. Téléchargez le `.spk` de votre processeur sur la [dernière release](https://github.com/J-Dudek/merathon/releases/latest) :
   `merathon-<version>-x86_64.spk` (Intel, AMD) ou `merathon-<version>-armv8.spk` (ARM 64 bits).
2. **Centre de paquets > Installation manuelle** : choisissez le fichier. DSM signale un paquet d'un éditeur non vérifié : c'est
   normal, le paquet n'est pas signé par Synology.
3. L'assistant demande :
   - le **nom du dossier partagé** qui contient les dépôts (par exemple `git`) : DSM le crée s'il n'existe pas et donne
     automatiquement les droits de lecture et d'écriture à l'utilisateur système `merathon` du paquet (DSM 7 interdit aux
     paquets d'agir en root) ;
   - le **jeton d'accès** (16 caractères ou plus) : il est demandé à chaque connexion depuis un navigateur (une session dure 12 heures
     et se termine au redémarrage du paquet) ; conservez-le dans un gestionnaire de mots de passe ;
   - l'activation du **terminal intégré** (désactivé par défaut).
4. Copiez vos dépôts dans ce dossier partagé (ou clonez-les depuis Merathon), puis ouvrez-les depuis le sélecteur de dossiers.
5. Ouvrez Merathon par son icône du menu DSM, à l'adresse `http://<IP du NAS>:8765/`, ou mieux par le proxy inverse HTTPS décrit plus bas.

### L'icône du menu DSM

L'icône ouvre une page servie par DSM, qui mène à Merathon : à l'**adresse de Merathon** saisie dans l'assistant (celle de votre proxy inverse,
par exemple `https://merathon.monnas.myds.me`), sinon à `http://<NAS>:8765/`. Sans adresse et avec DSM en HTTPS, la page explique quoi faire au lieu
d'échouer. Pour changer l'adresse après coup : `MERATHON_PUBLIC_URL='https://…'` dans `/var/packages/Merathon/var/config.env` (fichier à
l'utilisateur `merathon`, mode 600), puis arrêtez et démarrez le paquet.

### Mises à jour automatiques

Ajoutez la source de paquets de Merathon dans **Centre de paquets > Paramètres > Sources de paquets** :

```
https://github.com/J-Dudek/merathon/releases/latest/download/packages.json
```

Les nouvelles versions apparaissent ensuite dans le Centre de paquets.

## HTTPS : à faire avant d'ouvrir le service hors de votre réseau local

Le port 8765 parle en HTTP : le jeton d'accès y circule en clair. Placez Merathon derrière le reverse proxy de DSM :

1. **Panneau de configuration > Portail de connexion > Avancé > Proxy inverse > Créer** ;
2. source : `HTTPS`, votre nom d'hôte, un port (ou `merathon.votre-nas.example`) ; destination : `HTTP`, `localhost`, `8765` ;
3. onglet **En-têtes personnalisés > Créer > WebSocket** (Merathon pousse les changements du dépôt et le terminal par WebSocket) : c'est le **seul** en-tête
   nécessaire. Ne cochez pas HSTS sur la règle : celui de votre domaine DSM suffit, et l'activer est un engagement durable ;
4. pour que seul le proxy joigne le service, passez `MERATHON_BIND='127.0.0.1:8765'` dans `/var/packages/Merathon/var/config.env`
   (le fichier doit rester à l'utilisateur `merathon`, mode 600), puis arrêtez et démarrez le paquet. Le paquet ne déclare pas son port à DSM :
   avec le pare-feu de DSM actif et sans proxy, ouvrez le port 8765 à la main.

## « Ouvrir » ne marche pas avec le nom du NAS (`monnas.myds.me`)

Le service parle en HTTP sur le port 8765. DSM envoie l'en-tête HSTS : un navigateur qui l'a vu réécrit ensuite **tout** appel `http://monnas.myds.me:<port>`
en `https://`, sur n'importe quel port, et la connexion échoue. Avec l'adresse IP (`http://192.168.x.x:8765/`) il n'y a pas de HSTS : c'est l'accès à utiliser sans
proxy. Pour utiliser le nom du NAS, passez par le proxy inverse HTTPS de DSM (section précédente). Servir du HTTPS soi-même ne règle rien : le certificat
de DSM n'est pas lisible par un paquet, et un certificat auto-signé est refusé sans appel sur un domaine HSTS.

Servie en HTTP, l'interface fonctionne ; la copie dans le presse-papiers passe par une méthode de repli.

## Connexion

Le paquet se connecte par **jeton d'accès** : la page de connexion l'échange contre un cookie de session (`HttpOnly`, `SameSite=Strict`) valable
12 heures. Le jeton est donc redemandé à chaque nouvelle session, et après un redémarrage du paquet. Il est enregistré dans
`/var/packages/Merathon/var/config.env` (`MERATHON_TOKEN`), lisible par le seul utilisateur du paquet.

> Le serveur contient aussi un mode `dsm` (reconnaître la session DSM de l'utilisateur par `authenticate.cgi`). Il est **expérimental, non validé
> et non proposé par l'assistant** : ne l'activez pas en production.

## Image Docker (Container Manager, Unraid, TrueNAS…)

L'image est publiée à chaque release, pour x86_64 et ARM 64 bits : `ghcr.io/j-dudek/merathon`.

**Container Manager (DSM) :** *Registre > Paramètres > Ajouter* le registre `ghcr.io`, rechercher `j-dudek/merathon`, télécharger
l'image `latest`, puis créer le conteneur : port `8765`, variable `MERATHON_TOKEN` (16 caractères ou plus), volumes `/data` (réglages et
comptes) et `/repos` (vos dépôts, par exemple `/volume1/git`).

**En ligne de commande :**

```sh
docker run -d --name merathon -p 8765:8765 \
  -e MERATHON_TOKEN='un-jeton-de-16-caracteres-ou-plus' \
  -v merathon-data:/data -v /volume1/git:/repos ghcr.io/j-dudek/merathon:latest
```

Pour la construire vous-même : `docker build -f packaging/docker/Dockerfile -t merathon .` (plusieurs minutes de compilation Rust).

L'image démarre en mode `token` et refuse de démarrer sans jeton. Les dépôts sont dans `/repos` (utilisateur `1000` : donnez-lui
les droits sur le dossier monté). L'image contient `git`, `git-lfs` et `ssh`.

## Réglages (variables d'environnement)

| Variable | Rôle | Défaut |
|---|---|---|
| `MERATHON_BIND` | adresse d'écoute | `127.0.0.1:8765` (le paquet : `0.0.0.0:8765`) |
| `MERATHON_AUTH` | `token`, `none` (développement, adresse locale seulement) ou `dsm` (expérimental) | `token` |
| `MERATHON_TOKEN` / `MERATHON_TOKEN_FILE` | jeton d'accès (16 caractères au moins) ou fichier qui le contient | |
| `MERATHON_ALLOWED_ROOTS` | dossiers où ouvrir des dépôts, séparés par `:` — **obligatoire** avec une authentification | |
| `MERATHON_TERMINAL` | `1` pour autoriser le terminal intégré | désactivé |
| `MERATHON_DATA_DIR`, `MERATHON_CONFIG_DIR` | données et comptes | `~/.local/share/merathon`, `<données>/config` |
| `MERATHON_WEB_DIR` | interface (`dist-server/`) | `dist` |
| `MERATHON_BASE_PATH` | préfixe d'URL derrière un reverse proxy (`/merathon`) | vide |
| `MERATHON_ALLOWED_USERS`, `MERATHON_ALLOWED_GROUPS` | mode `dsm` : utilisateurs et groupes autorisés (séparés par `,`) | groupe `administrators` |
| `MERATHON_DSM_CGI`, `MERATHON_GROUP_FILE` | mode `dsm` : `authenticate.cgi` et fichier des groupes | chemins de DSM |
| `MERATHON_FRAME_ANCESTORS` | origines autorisées à afficher Merathon dans un cadre | `'self'` |
| `MERATHON_PUBLIC_URL` | paquet Synology : adresse ouverte par l'icône du menu DSM (lue par le script de démarrage, pas par le serveur) | vide |
| `MERATHON_KEEP_HOME` | ne pas remplacer `HOME` par le dossier de données | |

Git lit sa configuration globale, ses clés SSH et `known_hosts` dans `HOME` : le service les garde dans son dossier de données.
**Tous les utilisateurs du service partagent donc la même identité Git (nom et e-mail des commits) et les mêmes clés SSH** ; seuls
les comptes GitHub / GitLab (jetons) seraient séparés par utilisateur dans le mode `dsm` expérimental. Merathon est pensé pour une personne, ou une équipe qui partage
une identité ; les profils Git de Merathon permettent de varier l'identité d'un dépôt à l'autre. La création de clés SSH utilise
`ssh-keygen` (fourni par DSM avec son OpenSSH).

## Git et Git LFS

Merathon n'a pas besoin du programme `git` : lecture, commits, push et pull passent par libgit2, intégrée au binaire. Seul **Git LFS**
lance `git lfs …` : DSM n'embarque ni `git` ni `git-lfs`. Pour des dépôts LFS, installez le paquet Synology « Git Server » (il apporte
`git`) puis `git-lfs` ; sans eux, Merathon affiche « git-lfs n'est pas installé » et tout le reste fonctionne. L'image Docker embarque les deux.

## Sécurité

Le service donne accès à des dépôts, à des jetons de forge et (si vous l'activez) à un terminal : traitez son accès comme
celui d'un shell sur le NAS.

- les chemins reçus sont confinés aux dossiers autorisés (`..` et liens symboliques sortants refusés) ;
- l'`Origin` des requêtes et du WebSocket doit être celle du service ; chaque commande exige l'en-tête `X-Merathon-Window` ;
- CSP stricte, `X-Content-Type-Options`, `Referrer-Policy` ;
- le terminal est désactivé tant que l'administrateur ne l'a pas demandé ;
- le service refuse `MERATHON_AUTH=none` hors de la boucle locale.

## Différences avec l'application de bureau

- pas de mise à jour automatique (le Centre de paquets ou une nouvelle image Docker s'en charge), mais Merathon annonce les nouvelles
  versions publiées sur GitHub : un bandeau au chargement de la page (une vérification par jour au plus, une seule annonce par version
  et par navigateur), et « Rechercher des mises à jour… » dans le menu ou dans Préférences › À propos. Le NAS doit pouvoir joindre
  `api.github.com` ;
- pas de pastille sur l'icône ni de thème de barre de titre ;
- pas de « Nouvelle fenêtre » : les onglets de Merathon (et ceux du navigateur) en tiennent lieu ; les liens s'ouvrent dans un nouvel
  onglet ;
- la taille de l'interface est celle du zoom du navigateur (Ctrl+= / Ctrl+- / Ctrl+0), qu'il mémorise pour l'adresse de Merathon :
  Merathon n'y ajoute pas son propre zoom ;
- les onglets de Merathon se pilotent avec Alt (Alt+T, Alt+W, Alt+PgSuiv / PgPréc) : le navigateur garde Ctrl+T, Ctrl+W,
  Ctrl+Tab et Ctrl+PgSuiv / PgPréc pour ses propres onglets. Ctrl+W ferme donc l'onglet du navigateur, même depuis le terminal intégré :
  tant qu'un shell y tourne, le navigateur demande confirmation ;
- le sélecteur de dossiers parcourt les dossiers autorisés du NAS ;
- pas de notification système : l'activité de mes PR / MR est signalée par un bandeau dans Merathon (Préférences › Synchronisation) ;
- la synchronisation automatique tourne tant qu'une page Merathon est ouverte. Plusieurs pages (personnes, onglets) ouvrent les mêmes
  dépôts : le NAS fait passer les fetch, pull et push d'un même dépôt l'un après l'autre (deux fetch simultanés se disputeraient ses
  verrous), et ne refait pas un fetch automatique qu'une autre page vient de faire, moins d'une minute avant. Un fetch demandé à la main
  est toujours fait ;
- « Afficher dans le gestionnaire de fichiers » n'existe pas ;
- Git LFS demande les binaires `git` et `git-lfs` sur le NAS (déjà dans l'image Docker, à installer à part avec le paquet Synology).

## Compiler soi-même

```sh
# interface
cd git-client && npm ci && npm run build:server          # dist-server/
# serveur (glibc, pour le développement)
cd src-tauri && cargo build --release --no-default-features --features server --bin merathon-server
# binaire statique et interface pour le paquet : packaging/docker/Dockerfile (cible « artifacts »)
packaging/synology/build-spk.sh <version> x86_64 <merathon-server> <dist-server>
packaging/synology/verify-spk.py packaging/synology/dist/merathon-<version>-x86_64.spk
```
