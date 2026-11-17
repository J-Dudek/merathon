#!/bin/sh
# Essai de spk/merathon/src/service-setup.sh hors DSM : installation (config.env), puis adresse de l'icône au démarrage.
#   test-service-setup.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
setup="$here/spk/merathon/src/service-setup.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "ECHEC : $*" >&2; exit 1; }
token="un jeton; \$HOME '\"piegeux\" & #(x) fin"

install() { # install <dossier> <adresse>
    mkdir -p "$1/target/app" "$1/var"
    ( set +eu
      SYNOPKG_PKGDEST="$1/target" SYNOPKG_PKGVAR="$1/var" SYNOPKG_TEMP_LOGFILE="$1/log" SYNOPKG_PKG_STATUS=INSTALL
      SHARE_PATH=/volume1/git SERVICE_PORT=8765 wizard_token="$token" wizard_terminal=false wizard_public_url="$2"
      . "$setup"; service_postinst )
}
start() { # start <dossier> : comme le script de démarrage de spksrc, qui relit service-setup puis appelle service_prestart
    ( set +eu
      SYNOPKG_PKGDEST="$1/target" SYNOPKG_PKGVAR="$1/var"
      . "$setup"; service_prestart; printf '%s' "$MERATHON_TOKEN" > "$1/token-relu" )
}

for bad in 'ftp://x' 'javascript:alert(1)' 'https://x/";alert(1)//' 'https://x y'; do
    if install "$work/bad" "$bad"; then fail "adresse acceptée à tort : $bad"; fi
    [ ! -f "$work/bad/var/config.env" ] || fail "configuration écrite malgré l'adresse refusée"
done

install "$work/a" "https://merathon.nas.example:8443/x?a=1&b=2" || fail "installation"
[ "$(stat -c %a "$work/a/var/config.env")" = "600" ] || fail "config.env doit être en mode 600"
start "$work/a"
[ "$(cat "$work/a/token-relu")" = "$token" ] || fail "le jeton relu au démarrage diffère de celui saisi"
grep -q '^window.MERATHON_URL = "https://merathon.nas.example:8443/x?a=1&b=2";$' "$work/a/target/app/address.js" || fail "adresse de l'icône"
grep -q '^window.MERATHON_PORT = "8765";$' "$work/a/target/app/address.js" || fail "port de l'icône"

install "$work/b" "" || fail "installation sans adresse"
start "$work/b"
grep -q '^window.MERATHON_URL = "";$' "$work/b/target/app/address.js" || fail "sans adresse : vide attendu"

# Adresse rendue dangereuse à la main dans config.env : ignorée au démarrage.
sed -i "s|^MERATHON_PUBLIC_URL=.*|MERATHON_PUBLIC_URL='https://x/\";alert(1)//'|" "$work/b/var/config.env"
start "$work/b"
grep -q '^window.MERATHON_URL = "";$' "$work/b/target/app/address.js" || fail "adresse dangereuse non ignorée"

# La page de l'icône est la même que celle du paquet de packaging/synology.
for f in index.html open.js open.css address.js; do
    cmp -s "$here/spk/merathon/src/app/$f" "$here/../synology/package/app/$f" || fail "src/app/$f diffère de packaging/synology/package/app/$f"
done
for f in install_uifile install_uifile_fre; do
    cmp -s "$here/spk/merathon/src/wizard/$f" "$here/../synology/WIZARD_UIFILES/$f" || fail "l'assistant $f diffère de celui de packaging/synology"
done
echo "OK : service-setup de la recette spksrc"
