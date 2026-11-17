#!/usr/bin/env python3
"""Contrôle que la chaîne « paquet Synology → release GitHub » de .github/workflows/release.yml est complète.

    check-release-workflow.py

Les workflows ne s'essaient que sur GitHub : une étape supprimée par erreur (ici, le dépôt des artefacts du job `nas`) ne se voit alors qu'à la
première release, quand le .spk manque. Ce contrôle, lancé par la CI, attrape ces oublis avant.
"""
import sys
import yaml

raw = open(".github/workflows/release.yml").read()
wf = yaml.safe_load(raw)
jobs = wf["jobs"]
problems = []

def steps(job):
    return jobs[job]["steps"]

# 1. Le job nas dépose ses artefacts (paquets-nas-<arch>), avant toute étape qui peut échouer pour une raison étrangère au paquet (ghcr.io).
nas = steps("nas")
uploads = [i for i, s in enumerate(nas) if str(s.get("uses", "")).startswith("actions/upload-artifact")]
if not uploads:
    problems.append("nas : aucune étape actions/upload-artifact : le .spk n'arriverait jamais dans la release")
else:
    upload = nas[uploads[0]]
    if not str(upload["with"]["name"]).startswith("paquets-"):
        problems.append(f"nas : l'artefact s'appelle {upload['with']['name']!r} ; le job release ne télécharge que paquets-*")
    for i, s in enumerate(nas):
        if "ghcr.io" in str(s.get("name", "")) and "publication" in str(s.get("name", "")) and i < uploads[0]:
            problems.append("nas : la publication ghcr.io précède le dépôt des artefacts")
    for s in nas[uploads[0] + 1:]:
        if "publication" in str(s.get("name", "")) and not s.get("continue-on-error"):
            problems.append(f"nas : {s['name']!r} doit être continue-on-error (canal secondaire)")

# 2. La release attend nas, télécharge paquets-*, et joint les .spk et l'archive de l'interface.
if "nas" not in jobs["release"]["needs"]:
    problems.append("release : doit dépendre du job nas")
downloads = [s for s in steps("release") if str(s.get("uses", "")).startswith("actions/download-artifact")]
if not downloads or downloads[0]["with"].get("pattern") != "paquets-*":
    problems.append("release : doit télécharger le motif paquets-*")
for glob in ("merathon-*.spk", "merathon-web-*.tar.gz"):
    if glob not in raw:
        problems.append(f"release : {glob} n'est pas joint à la release")

# 3. La publication (dépôt public) reprend tous les fichiers de la release, et construit la source de paquets depuis les .spk.
for needle in ("make-source.py", "assets/merathon-*.spk", '--repo "$PUBLIC_REPO"'):
    if needle not in raw:
        problems.append(f"publish : {needle!r} absent")

# 4. Le multi-architecture de l'image ne doit pas bloquer la publication de la release.
for s in steps("publish"):
    if "multi-architecture" in str(s.get("name", "")) and not s.get("continue-on-error"):
        problems.append("publish : l'étiquette multi-architecture doit être continue-on-error")

# 5. Le paquet NAS ne bloque jamais la release ni la publication du bureau et d'Android.
for job in ("release", "publish"):
    condition = str(jobs[job].get("if", ""))
    if "!cancelled()" not in condition or "needs.nas" in condition:
        problems.append(f"{job} : un échec du job nas ne doit pas bloquer la release du bureau et d'Android (if: !cancelled() … sans needs.nas)")
for needed in ("needs.tests.result == 'success'", "needs.build.result == 'success'", "needs.android.result == 'success'"):
    if needed not in str(jobs["release"].get("if", "")):
        problems.append(f"release : doit continuer d'exiger {needed}")
if "shopt -s nullglob" not in raw:
    problems.append("release/publish : sans paquet NAS, les motifs de fichiers doivent disparaître (shopt -s nullglob)")

if problems:
    print("\n".join(f"ERREUR : {p}" for p in problems), file=sys.stderr)
    sys.exit(1)
print("OK : chaîne paquet Synology → release complète")
