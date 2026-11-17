#!/bin/sh
# Écrit le fichier `digests` d'un paquet spksrc, dans le format qu'il attend (une ligne par somme de contrôle).
#
#   digests.sh <archive> <nom attendu par spksrc, ex. merathon-2.17.0.tar.gz> > cross/merathon/digests
set -eu
[ $# -eq 2 ] || { sed -n '2,5p' "$0" >&2; exit 2; }
file=$1
name=$2
printf '%s SHA1 %s\n' "$name" "$(sha1sum "$file" | cut -d' ' -f1)"
printf '%s SHA256 %s\n' "$name" "$(sha256sum "$file" | cut -d' ' -f1)"
printf '%s MD5 %s\n' "$name" "$(md5sum "$file" | cut -d' ' -f1)"
