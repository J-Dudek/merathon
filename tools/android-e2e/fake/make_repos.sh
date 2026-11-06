#!/bin/bash
# Dépôts fictifs (auteurs et adresses en example.com) : atelier/site-vitrine et atelier/boutique-api, en bare,
# servis par fake_github.py et fake_sshd.py. Recrée tout le dossier $E2E_WORK (par défaut tools/android-e2e/.work).
set -e
HERE=$(dirname "$(readlink -f "$0")")
ROOT=${E2E_WORK:-$(dirname "$HERE")/.work}
SRV=$ROOT/srv/atelier; WORK=$ROOT/build
rm -rf "$ROOT"; mkdir -p "$SRV" "$WORK"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
as() { export GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" GIT_AUTHOR_DATE="$3" GIT_COMMITTER_DATE="$3"; }
CAM="Camille Martin"; CE=camille@example.com; NOAH="Noah Petit"; NE=noah@example.com; LEA="Léa Bernard"; LE=lea@example.com

# --- site-vitrine
git init -q -b main "$WORK/site-vitrine"; cd "$WORK/site-vitrine"
as "$CAM" $CE "2026-10-20T09:00:00"
mkdir -p .github css js
printf '# Site vitrine\n\nSite de l’atelier.\n' > README.md
printf '## Résumé\n\n## Tests\n\n- [ ] testé sur mobile\n' > .github/pull_request_template.md
printf '<!doctype html>\n<html lang="fr">\n<head><title>Atelier</title></head>\n<body>\n  <h1>Bienvenue</h1>\n</body>\n</html>\n' > index.html
printf 'body { font-family: sans-serif; }\nh1 { color: #333; }\n' > css/style.css
git add -A; git commit -qm "Premier commit"
as "$NOAH" $NE "2026-10-21T10:00:00"
printf 'export function menu() {\n  return document.querySelector("nav");\n}\n' > js/menu.js
git add -A; git commit -qm "Ajoute le menu"
as "$LEA" $LE "2026-10-22T14:30:00"
printf 'body { font-family: sans-serif; margin: 0; }\nh1 { color: #333; }\n' > css/style.css
git commit -qam "Supprime la marge du body"
git tag v1.0
# PR #9 (noah) : panier
git checkout -qb feature/panier
as "$NOAH" $NE "2026-10-25T09:00:00"
printf 'export const panier = [];\n\nexport function ajouter(article) {\n  panier.push(article);\n  return panier.length;\n}\n' > js/panier.js
git add -A; git commit -qm "Ajoute le panier"
printf 'body { font-family: sans-serif; margin: 0; }\nh1 { color: #222; }\n.panier { float: right; }\n' > css/style.css
git commit -qam "Style du panier"
# PR #7 (camille) : menu mobile
git checkout -q main; git checkout -qb fix/menu-mobile
as "$CAM" $CE "2026-10-26T11:00:00"
printf 'export function menu() {\n  const nav = document.querySelector("nav");\n  nav?.classList.toggle("ouvert");\n  return nav;\n}\n' > js/menu.js
git commit -qam "Corrige le menu sur mobile"
git checkout -q main
as "$LEA" $LE "2026-10-27T08:00:00"
printf '# Site vitrine\n\nSite de l’atelier.\n\n## Lancer\n\nOuvrir index.html.\n' > README.md
git commit -qam "Documente le lancement"
git clone -q --bare . "$SRV/site-vitrine.git"

# --- boutique-api
git init -q -b main "$WORK/boutique-api"; cd "$WORK/boutique-api"
as "$LEA" $LE "2026-10-18T09:00:00"
printf '# Boutique API\n' > README.md
printf 'def produits():\n    return []\n' > api.py
git add -A; git commit -qm "Squelette de l’API"
as "$CAM" $CE "2026-10-24T16:00:00"
printf 'def produits():\n    return ["tasse", "affiche"]\n' > api.py
git commit -qam "Liste des produits"
git clone -q --bare . "$SRV/boutique-api.git"

for r in "$SRV"/*.git; do git -C "$r" config http.receivepack true; done
echo ok
