#!/bin/sh
# Compile la recette avec l'image Docker de SynoCommunity, à partir de l'arbre local (sans release publiée).
#
#   test-build.sh <dépôt spksrc cloné> <dist-server> [arch, défaut arch-x64-7.2]
#
# Le code source (git archive HEAD) et l'interface (<dist-server>) sont servis par un serveur HTTP local, et les
# adresses de téléchargement de la recette lui sont substituées dans une copie : la recette du dépôt n'est pas modifiée.
# L'image est celle de ghcr.io (l'ancienne, sur Docker Hub, a un GNU Make trop vieux pour spksrc) ; SPKSRC_IMAGE la remplace.
set -eu
[ $# -ge 2 ] || { sed -n '2,8p' "$0" >&2; exit 2; }
spksrc=$(cd "$1" && pwd)
web=$(cd "$2" && pwd)
target=${3:-arch-x64-7.2}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
version=$(sed -n 's/^PKG_VERS = //p' "$here/cross/merathon/Makefile")

serve=$(mktemp -d)
trap 'kill "${server:-0}" 2>/dev/null || true; rm -rf "$serve"' EXIT
git -C "$root" archive --format=tar.gz --prefix="merathon-$version/" -o "$serve/source.tar.gz" HEAD
mkdir "$serve/w" && cp -R "$web" "$serve/w/web" && tar -czf "$serve/web.tar.gz" -C "$serve/w" web
(cd "$serve" && python3 -m http.server 8099 --bind 0.0.0.0 >/dev/null 2>&1) &
server=$!
sleep 1
host=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')

cp -R "$here/cross/." "$spksrc/cross/"
cp -R "$here/spk/." "$spksrc/spk/"
sed -i -e "s|^PKG_DIST_SITE = .*|PKG_DIST_SITE = http://$host:8099|" -e "s|^PKG_DIST_NAME = .*|PKG_DIST_NAME = source.tar.gz|" "$spksrc/cross/merathon/Makefile"
sed -i -e "s|^PKG_DIST_SITE = .*|PKG_DIST_SITE = http://$host:8099|" -e "s|^PKG_DIST_NAME = .*|PKG_DIST_NAME = web.tar.gz|" "$spksrc/cross/merathon_web/Makefile"
"$here/digests.sh" "$serve/source.tar.gz" "merathon-$version.tar.gz" > "$spksrc/cross/merathon/digests"
"$here/digests.sh" "$serve/web.tar.gz" "merathon_web-$version.tar.gz" > "$spksrc/cross/merathon_web/digests"

docker run --rm --platform=linux/amd64 -v "$spksrc":/spksrc -w /spksrc "${SPKSRC_IMAGE:-ghcr.io/synocommunity/spksrc}" /bin/bash -c "make setup >/dev/null 2>&1; cd spk/merathon && make $target"
ls -la "$spksrc"/packages/*.spk
