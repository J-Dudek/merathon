#!/bin/sh
# Essai des scripts du paquet hors DSM : variables SYNOPKG_* simulées, vrai binaire.
#
#   test-scripts.sh <merathon-server> <dossier de l'interface>
#
# Vérifie : refus d'un jeton trop court, configuration en mode 600, démarrage, état, réponse du service, arrêt propre.

set -eu
binary=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
web=$(cd "$2" && pwd)
here=$(cd "$(dirname "$0")" && pwd)

work=$(mktemp -d)
trap 'sh "$here/scripts/start-stop-status" stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
mkdir -p "$work/target/bin" "$work/target/app" "$work/var" "$work/volume1/reposx"
cp "$binary" "$work/target/bin/merathon-server"
cp -R "$web" "$work/target/web"

export SYNOPKG_PKGDEST="$work/target" SYNOPKG_PKGVAR="$work/var" SYNOPKG_TEMP_LOGFILE="$work/install.log" MERATHON_VOLUMES="$work/volume1"
port=$((20000 + $$ % 20000))
# Jeton volontairement piégeux : espaces, ;, $, apostrophe, guillemet, &, #, parenthèses, antislash.
token="un jeton; \$HOME '\"piegeux\" & #(x) \\ fin"
fail() { echo "ECHEC : $*" >&2; exit 1; }

# Jeton trop court : l'installation échoue, avec un message pour l'utilisateur.
if wizard_repos_share=reposx wizard_token=court sh "$here/scripts/postinst"; then
    fail "un jeton trop court aurait dû être refusé"
fi
[ -s "$SYNOPKG_TEMP_LOGFILE" ] || fail "pas de message d'erreur pour DSM"
[ ! -f "$work/var/config.env" ] || fail "configuration écrite malgré l'échec"

# Dossier partagé inexistant : l'installation échoue, avec un message.
if wizard_repos_share=absent wizard_token=un-jeton-de-test-16car sh "$here/scripts/postinst"; then
    fail "un dossier partagé inconnu aurait dû être refusé"
fi
[ ! -f "$work/var/config.env" ] || fail "configuration écrite malgré l'échec"

# Adresse de l'icône : seulement http(s), sans caractère qui sortirait de la page web où elle est écrite.
for bad in 'ftp://x' 'javascript:alert(1)' 'https://x/";alert(1)//' 'https://x y' "https://x/'<script>"; do
    if wizard_repos_share=reposx wizard_token="$token" wizard_public_url="$bad" sh "$here/scripts/postinst"; then
        fail "adresse acceptée à tort : $bad"
    fi
done
[ ! -f "$work/var/config.env" ] || fail "configuration écrite malgré l'adresse refusée"

# Installation valide.
wizard_repos_share=reposx wizard_token="$token" wizard_terminal=false wizard_public_url="https://merathon.nas.example:8443/x?a=1&b=2" sh "$here/scripts/postinst"
config="$work/var/config.env"
[ "$(stat -c %a "$config")" = "600" ] || fail "config.env doit être en mode 600 (contient le jeton)"
sed -i "s|^MERATHON_BIND=.*|MERATHON_BIND=127.0.0.1:$port|" "$config"
grep -q "^MERATHON_TERMINAL=0$" "$config" || fail "terminal : désactivé attendu"
grep -q "^MERATHON_PUBLIC_URL='https://merathon.nas.example:8443/x?a=1&b=2'$" "$config" || fail "adresse de l'icône absente de la configuration"
( PKGDEST="$work/target"; LOGFILE="$work/l"; . "$config"; eval "$(sed -n '/^write_icon_address() {/,/^}/p' "$here/scripts/start-stop-status")"; write_icon_address )
grep -q '^window.MERATHON_URL = "https://merathon.nas.example:8443/x?a=1&b=2";$' "$work/target/app/address.js" || fail "adresse de l'icône mal écrite"
( PKGDEST="$work/target"; LOGFILE="$work/l"; MERATHON_BIND=0.0.0.0:8765; MERATHON_PUBLIC_URL='https://x/";alert(1)//'; eval "$(sed -n '/^write_icon_address() {/,/^}/p' "$here/scripts/start-stop-status")"; write_icon_address )
grep -q '^window.MERATHON_URL = "";$' "$work/target/app/address.js" || fail "une adresse modifiée à la main et dangereuse doit être ignorée"
grep -q "^MERATHON_ALLOWED_ROOTS='$work/volume1/reposx'$" "$config" || fail "dossier des dépôts absent de la configuration"

# Une mise à jour silencieuse (aucune réponse d'assistant) garde la configuration existante.
cp "$config" "$work/config.saved"
sh "$here/scripts/postinst"
cmp -s "$config" "$work/config.saved" || fail "la mise à jour a écrasé la configuration"

# Une réinstallation (l'assistant est affiché) remplace un config.env resté de l'installation précédente.
printf "MERATHON_TOKEN=ancien jeton\n" > "$config"
wizard_repos_share=reposx wizard_token="$token" wizard_terminal=false sh "$here/scripts/postinst"
grep -q "^MERATHON_ALLOWED_ROOTS='$work/volume1/reposx'$" "$config" || fail "la réinstallation n'a pas remplacé l'ancienne configuration"
sed -i "s|^MERATHON_BIND=.*|MERATHON_BIND=127.0.0.1:$port|" "$config"

sh "$here/scripts/start-stop-status" status && fail "ne devrait pas tourner avant le démarrage"
sh "$here/scripts/start-stop-status" start || { cat "$work/var/merathon.log" >&2; fail "démarrage"; }
sh "$here/scripts/start-stop-status" status || fail "devrait tourner"
# L'adresse de l'icône du menu DSM est écrite au démarrage, avec le port du service.
grep -q '^window.MERATHON_URL = "";$' "$work/target/app/address.js" || fail "adresse de l'icône : vide attendue après la réinstallation sans adresse"
grep -q "^window.MERATHON_PORT = \"$port\";\$" "$work/target/app/address.js" || fail "port de l'icône"
sh "$here/scripts/start-stop-status" start || fail "démarrer deux fois doit rester sans effet"

i=0
until curl -fs "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do
    i=$((i + 1)); [ $i -lt 20 ] || fail "le service ne répond pas"; sleep 0.5
done
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/invoke/app_info" -H 'X-Merathon-Window: t' -d '{}')" = "401" ] || fail "sans jeton, 401 attendu"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/invoke/app_info" -H 'X-Merathon-Window: t' -H "Authorization: Bearer $token" -d '{}')" = "200" ] || fail "avec le jeton, 200 attendu"

sh "$here/scripts/start-stop-status" stop || fail "arrêt"
sh "$here/scripts/start-stop-status" status && fail "devrait être arrêté"
[ ! -f "$work/var/merathon.pid" ] || fail "fichier pid laissé"
echo "OK : scripts du paquet"
