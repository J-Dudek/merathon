#!/bin/sh
# Après la publication d'une release : télécharge ses deux archives et met à jour les `digests` de la recette.
#
#   update-digests.sh <version>        (ex. 2.17.0)
set -eu
[ $# -eq 1 ] || { sed -n '2,5p' "$0" >&2; exit 2; }
version=$1
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
base=https://github.com/J-Dudek/merathon
curl -fsSL -o "$tmp/source.tar.gz" "$base/archive/refs/tags/v$version.tar.gz"
curl -fsSL -o "$tmp/web.tar.gz" "$base/releases/download/v$version/merathon-web-$version.tar.gz"
"$here/digests.sh" "$tmp/source.tar.gz" "merathon-$version.tar.gz" > "$here/cross/merathon/digests"
"$here/digests.sh" "$tmp/web.tar.gz" "merathon_web-$version.tar.gz" > "$here/cross/merathon_web/digests"
sed -i "s/^PKG_VERS = .*/PKG_VERS = $version/" "$here/cross/merathon/Makefile" "$here/cross/merathon_web/Makefile"
sed -i "s/^SPK_VERS = .*/SPK_VERS = $version/" "$here/spk/merathon/Makefile"
echo "Recette mise à jour pour $version. Incrémentez SPK_REV (jamais remis à 1) et le CHANGELOG avant la pull request."
