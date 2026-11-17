#!/bin/sh
# Assemble le paquet Synology (.spk).
#
#   build-spk.sh <version> <arch> <binaire merathon-server> <dossier de l'interface> [numéro de build]
#
# <arch> : x86_64 ou armv8 (noms de Synology). Sortie : dist/merathon-<version>-<arch>.spk (dossier OUT pour en changer).
# Un .spk est une archive tar : INFO, package.tgz (le contenu installé), scripts, conf, assistant d'installation, icônes.

set -eu

[ $# -ge 4 ] || { sed -n '2,8p' "$0" >&2; exit 2; }
version=$1
arch=$2
binary=$3
web=$4
build=${5:-0001}

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${OUT:-$here/dist}

# `arch` de l'INFO : les plateformes de Synology (processeurs) qui acceptent ce binaire, pas un nom d'architecture. Listes de
# SynoCommunity/spksrc (mk/spksrc.common/archs.mk, plateformes de DSM 7.2) : à relire à chaque nouvelle génération de NAS.
case "$arch" in
    x86_64) platforms="apollolake avoton braswell broadwell broadwellnk broadwellnkv2 broadwellntbap bromolow denverton epyc7002 epyc7003 epyc7003ntb geminilake geminilakenk grantley icelaked kvmx64 purley r1000 r1000nk v1000 v1000nk" ;;
    armv8) platforms="rtd1296 rtd1619b armada37xx" ;;
    *) echo "architecture inconnue : $arch (x86_64 ou armv8)" >&2; exit 2 ;;
esac
[ -x "$binary" ] || { echo "binaire introuvable ou non exécutable : $binary" >&2; exit 2; }
[ -f "$web/index.html" ] || { echo "interface introuvable (index.html) : $web" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/pkg/bin" "$work/pkg/web" "$work/spk" "$out"
# Chemin absolu : l'archive finale est écrite depuis un autre dossier.
out=$(cd "$out" && pwd)

# package.tgz : ce que DSM installe dans /var/packages/Merathon/target.
cp -R "$here/package/." "$work/pkg/"
install -m 755 "$binary" "$work/pkg/bin/merathon-server"
cp -R "$web/." "$work/pkg/web/"
cp "$root/LICENSE" "$work/pkg/LICENSE"
cp "$root/packaging/THIRD_PARTY.md" "$work/pkg/THIRD_PARTY.md"
(cd "$work/pkg" && tar --owner=0 --group=0 --numeric-owner -czf "$work/spk/package.tgz" .)

checksum=$(md5sum "$work/spk/package.tgz" | cut -d' ' -f1)
sed -e "s|@VERSION@|$version-$build|" -e "s|@ARCH@|$platforms|" -e "s|@CHECKSUM@|$checksum|" "$here/INFO.in" > "$work/spk/INFO"

cp -R "$here/scripts" "$here/conf" "$here/WIZARD_UIFILES" "$work/spk/"
cp "$here/PACKAGE_ICON.PNG" "$here/PACKAGE_ICON_256.PNG" "$work/spk/"
cp "$root/LICENSE" "$work/spk/LICENSE"
chmod 755 "$work"/spk/scripts/*

spk="$out/merathon-$version-$arch.spk"
(cd "$work/spk" && tar --owner=0 --group=0 --numeric-owner -cf "$spk" INFO package.tgz scripts conf WIZARD_UIFILES PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG LICENSE)
echo "$spk"
