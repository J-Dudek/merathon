#!/usr/bin/env python3
"""Contrôle la structure d'un paquet Synology (.spk) produit par build-spk.sh.

    verify-spk.py merathon-2.17.0-x86_64.spk

Ce n'est pas la validation de Synology (pkgscripts-ng, ou une installation dans DSM) : ce sont les erreurs que le
paquet ne doit jamais avoir, détectées sans NAS : checksum faux, script non exécutable, JSON invalide, fichier
référencé absent.
"""
import hashlib
import io
import json
import re
import sys
import tarfile

REQUIRED_INFO = ["package", "version", "arch", "os_min_ver", "displayname", "description", "maintainer", "checksum", "dsmuidir"]
# Plateformes de Synology (processeurs), d'après SynoCommunity/spksrc, mk/spksrc.common/archs.mk.
X64_PLATFORMS = (
    "apollolake avoton braswell broadwell broadwellnk broadwellnkv2 broadwellntbap bromolow cedarview denverton dockerx64 epyc7002 "
    "epyc7003 epyc7003ntb geminilake geminilakenk grantley icelaked kvmx64 purley r1000 r1000nk v1000 v1000nk"
).split()
ARMV8_PLATFORMS = "rtd1296 rtd1619b armada37xx".split()
SCRIPTS = ["start-stop-status", "postinst", "preinst", "preuninst", "postuninst", "preupgrade", "postupgrade"]


def fail(message):
    print(f"ERREUR : {message}", file=sys.stderr)
    sys.exit(1)


def parse_info(text):
    info = {}
    for line in text.splitlines():
        match = re.fullmatch(r'([a-z_]+)="(.*)"', line)
        if not match:
            fail(f"ligne INFO invalide : {line!r}")
        info[match.group(1)] = match.group(2)
    return info


def main(path):
    with tarfile.open(path) as spk:
        members = {m.name: m for m in spk.getmembers()}

        def read(name):
            if name not in members:
                fail(f"{name} absent du .spk")
            return spk.extractfile(members[name]).read()

        info = parse_info(read("INFO").decode())
        for key in REQUIRED_INFO:
            if not info.get(key):
                fail(f"INFO : clé {key} absente ou vide")
        if not re.fullmatch(r"\d+\.\d+\.\d+-\d+", info["version"]):
            fail(f"INFO : version {info['version']!r} (attendu x.y.z-NNNN)")
        platforms = info["arch"].split()
        known = set(X64_PLATFORMS) | set(ARMV8_PLATFORMS)
        if not platforms or not set(platforms) <= known:
            fail(f"INFO : plateformes inconnues {sorted(set(platforms) - known)} (arch doit lister des plateformes Synology)")
        if not (set(platforms) <= set(X64_PLATFORMS) or set(platforms) <= set(ARMV8_PLATFORMS)):
            fail("INFO : un paquet ne mélange pas processeurs x86 et ARM")
        if "@" in read("INFO").decode():
            fail("INFO : marqueur @…@ non remplacé")

        package = read("package.tgz")
        if hashlib.md5(package).hexdigest() != info["checksum"]:
            fail("INFO : checksum différent du md5 de package.tgz")

        for script in SCRIPTS:
            member = members.get(f"scripts/{script}")
            if member is None:
                fail(f"scripts/{script} absent")
            if not member.mode & 0o111:
                fail(f"scripts/{script} n'est pas exécutable")
            if not read(f"scripts/{script}").startswith(b"#!/bin/sh"):
                fail(f"scripts/{script} : première ligne attendue #!/bin/sh")

        for name in ["conf/privilege", "conf/resource", "WIZARD_UIFILES/install_uifile", "WIZARD_UIFILES/install_uifile_fre"]:
            try:
                json.loads(read(name))
            except ValueError as e:
                fail(f"{name} : JSON invalide ({e})")
        privilege = json.loads(read("conf/privilege"))
        if privilege.get("defaults", {}).get("run-as") != "package":
            fail("conf/privilege : DSM 7 interdit root, run-as doit valoir package")
        for icon in ["PACKAGE_ICON.PNG", "PACKAGE_ICON_256.PNG"]:
            if not read(icon).startswith(b"\x89PNG"):
                fail(f"{icon} n'est pas un PNG")

    with tarfile.open(fileobj=io.BytesIO(package), mode="r:gz") as pkg:
        names = {m.name.removeprefix("./"): m for m in pkg.getmembers()}
        binary = names.get("bin/merathon-server")
        if binary is None or not binary.mode & 0o111:
            fail("package.tgz : bin/merathon-server absent ou non exécutable")
        for name in ["web/index.html", "app/config", "LICENSE", "THIRD_PARTY.md"]:
            if name not in names:
                fail(f"package.tgz : {name} absent")
        shortcut = json.loads(pkg.extractfile(names["app/config"]).read())
        icon = next(iter(shortcut[".url"].values()))["icon"]
        if info.get("dsmappname") not in shortcut[".url"]:
            fail("INFO : dsmappname doit être l'identifiant de l'application de app/config (sinon DSM n'affiche pas l'icône)")
        launcher = next(iter(shortcut[".url"].values()))["url"]
        prefix = f"/webman/3rdparty/{info['package']}/"
        if not launcher.startswith(prefix) or f"app/{launcher[len(prefix):]}" not in names:
            fail(f"app/config : url {launcher!r} doit désigner une page de app/ servie par DSM ({prefix}…)")
        for name in ["app/open.js", "app/open.css", "app/address.js"]:
            if name not in names:
                fail(f"package.tgz : {name} absent (page ouverte par l'icône)")
        for size in (16, 24, 32, 48, 64, 72, 256):
            if f"app/{icon.replace('{0}', str(size))}" not in names:
                fail(f"package.tgz : icône {size} px absente")
        if info["dsmuidir"] != "app":
            fail("INFO : dsmuidir doit valoir app (là où package.tgz range config et images)")
        resource = json.loads(open_member(path, "conf/resource"))
        share = resource.get("data-share", {}).get("shares", [{}])[0]
        if share.get("permission", {}).get("rw") != [privilege["username"]]:
            fail("conf/resource : data-share doit donner les droits rw à l'utilisateur du paquet")
        protocol = resource.get("port-config", {}).get("protocol-file")
        if protocol and protocol not in names:
            fail(f"conf/resource : {protocol} absent de package.tgz")

    print(f"OK : {path} ({info['package']} {info['version']}, {len(platforms)} plateformes)")


def open_member(path, name):
    with tarfile.open(path) as spk:
        return spk.extractfile(name).read()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage : verify-spk.py <fichier.spk>")
    main(sys.argv[1])
