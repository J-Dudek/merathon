#!/usr/bin/env python3
"""Fichier de source de paquets pour le Centre de paquets de DSM (Paramètres > Sources de paquets).

    make-source.py --base-url https://github.com/J-Dudek/merathon/releases/download/v2.17.0 \\
        dist/merathon-2.17.0-x86_64.spk dist/merathon-2.17.0-armv8.spk > packages.json

Une entrée par .spk (architecture) : DSM ne retient que celle de son processeur. Le fichier est publié avec la release ;
son adresse stable (…/releases/latest/download/packages.json) est celle que l'utilisateur saisit dans DSM.
"""
import argparse
import hashlib
import json
import os
import sys
import tarfile


def spk_info(path):
    with tarfile.open(path) as spk:
        text = spk.extractfile("INFO").read().decode()
    info = {}
    for line in text.splitlines():
        key, _, value = line.partition("=")
        info[key] = value.strip('"')
    return info


def entry(path, base_url, thumbnail):
    info = spk_info(path)
    with open(path, "rb") as f:
        data = f.read()
    return {
        "package": info["package"],
        "version": info["version"],
        "dname": info["displayname"],
        "desc": info["description"],
        "link": f"{base_url.rstrip('/')}/{os.path.basename(path)}",
        "md5": hashlib.md5(data).hexdigest(),
        "size": len(data),
        "arch": info["arch"].split(),
        "thumbnail": [thumbnail],
        "maintainer": info["maintainer"],
        "maintainer_url": info.get("maintainer_url", ""),
        "distributor": info.get("distributor", ""),
        "distributor_url": info.get("distributor_url", ""),
        "beta": False,
        "qinst": False,
        "qupgrade": False,
        "qstart": False,
        "download_count": 0,
        "recent_download_count": 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("spk", nargs="+")
    parser.add_argument("--base-url", required=True, help="adresse du dossier où les .spk sont téléchargeables")
    parser.add_argument("--thumbnail", default="https://raw.githubusercontent.com/J-Dudek/merathon/main/packaging/synology/PACKAGE_ICON_256.PNG")
    args = parser.parse_args()
    packages = [entry(path, args.base_url, args.thumbnail) for path in sorted(args.spk)]
    json.dump({"packages": packages, "keyrings": []}, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
