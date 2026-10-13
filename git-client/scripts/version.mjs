#!/usr/bin/env node
// Versionnage automatique à partir des messages de commit (Conventional Commits).
//
//   node scripts/version.mjs next    → affiche la prochaine version (rien si aucune release n'est nécessaire)
//   node scripts/version.mjs apply X.Y.Z → écrit la version dans tous les fichiers applicatifs
//   node scripts/version.mjs changelog X.Y.Z → ajoute la section de X.Y.Z en tête de CHANGELOG.md
//                                              et affiche ses notes (corps de la release GitHub)
//
// Règles : « feat!: » / « BREAKING CHANGE » → majeure ; « feat: » → mineure ;
// « fix: », « perf: », « refactor: », « build: », « revert: » ou message libre → correctif ;
// uniquement « docs: », « ci: », « test: », « chore: », « style: » → pas de release.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const NO_RELEASE = new Set(["docs", "ci", "test", "chore", "style"]);
const RANK = { patch: 1, minor: 2, major: 3 };
const CHANGELOG_TITLE = "# Changelog\n\nToutes les évolutions notables de Merathon, générées à partir des messages de commit.\n";
/** Rubriques du changelog, dans l'ordre d'affichage ; les autres types vont dans « Autres changements ». */
const SECTIONS = [
  ["breaking", "⚠ Changements incompatibles"],
  ["feat", "Nouveautés"],
  ["fix", "Corrections"],
  ["perf", "Performances"],
  ["other", "Autres changements"],
];

/** Type de version imposé par un message de commit (null : aucune release). */
export function bumpForCommit(message) {
  const [header = "", ...body] = message.trim().split("\n");
  if (/^BREAKING[ -]CHANGE:/m.test(body.join("\n"))) return "major";
  const match = header.match(/^(\w+)(\([^)]*\))?(!)?:\s/);
  if (!match) return header.trim() ? "patch" : null;
  const [, type, , bang] = match;
  if (bang) return "major";
  if (type === "feat") return "minor";
  if (NO_RELEASE.has(type)) return null;
  return "patch";
}

/** Le plus fort des types de version demandés par une liste de commits. */
export function bumpForCommits(messages) {
  let best = null;
  for (const message of messages) {
    const bump = bumpForCommit(message);
    if (bump && (!best || RANK[bump] > RANK[best])) best = bump;
  }
  return best;
}

export function incrementVersion(version, bump) {
  const match = version.match(SEMVER);
  if (!match) throw new Error(`Version invalide : ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Type de version inconnu : ${bump}`);
}

/** La plus grande des deux versions. */
export function maxVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? a : b;
  return a;
}

/** Remplace la version du paquet `git-client` dans Cargo.toml / Cargo.lock. */
export function setCargoVersion(content, version, { lock = false } = {}) {
  if (lock) {
    const re = /(\[\[package\]\]\nname = "git-client"\nversion = ")[^"]+(")/;
    if (!re.test(content)) throw new Error("Paquet git-client introuvable dans Cargo.lock");
    return content.replace(re, `$1${version}$2`);
  }
  const re = /(\[package\][^[]*?\nversion = ")[^"]+(")/;
  if (!re.test(content)) throw new Error("Version introuvable dans la section [package] de Cargo.toml");
  return content.replace(re, `$1${version}$2`);
}

/** Décompose un message Conventional Commits : type, portée, sujet, changement incompatible. */
export function parseCommit(message) {
  const [header = "", ...body] = message.trim().split("\n");
  const match = header.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s(.*)$/);
  const breaking = /^BREAKING[ -]CHANGE:/m.test(body.join("\n")) || !!match?.[3];
  if (!match) return { type: null, scope: null, subject: header.trim(), breaking };
  return { type: match[1].toLowerCase(), scope: match[2] || null, subject: match[4].trim(), breaking };
}

/**
 * Notes de version (Markdown, sans titre) : commits regroupés par rubrique.
 * Les commits sans impact applicatif (docs, ci, chore…) et les merges sont omis.
 * `commits` : [{ hash, message }] ; `repoUrl` (optionnel) ajoute un lien vers chaque commit.
 */
export function releaseNotes(commits, { repoUrl } = {}) {
  const groups = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const { hash, message } of commits) {
    if (/^Merge (pull request|branch|remote-tracking branch) /.test(message)) continue;
    if (!bumpForCommit(message)) continue;
    const commit = parseCommit(message);
    const scope = commit.scope ? `**${commit.scope} :** ` : "";
    const short = hash.slice(0, 7);
    const ref = repoUrl ? `[${short}](${repoUrl}/commit/${hash})` : short;
    let key = groups.has(commit.type) ? commit.type : "other";
    if (commit.breaking) key = "breaking";
    groups.get(key).push(`- ${scope}${commit.subject} (${ref})`);
  }
  const parts = SECTIONS.filter(([key]) => groups.get(key).length).map(
    ([key, title]) => `### ${title}\n\n${groups.get(key).join("\n")}\n`,
  );
  return parts.length ? parts.join("\n") : "Maintenance interne, sans changement visible.\n";
}

/** Section complète d'une version : titre (avec lien de comparaison si possible), date, notes. */
export function changelogSection(version, date, notes, { repoUrl, previousTag } = {}) {
  const title = repoUrl && previousTag ? `[${version}](${repoUrl}/compare/${previousTag}...v${version})` : version;
  return `## ${title} (${date})\n\n${notes}`;
}

/** Insère la section en tête du changelog (sous le titre), en créant le fichier s'il n'existe pas. */
export function prependChangelog(content, section) {
  // Sections déjà publiées : tout ce qui suit le premier titre de version.
  const first = content.search(/^## /m);
  const rest = first >= 0 ? content.slice(first) : "";
  return [CHANGELOG_TITLE, section, rest].filter(Boolean).join("\n");
}

const files = {
  packageJson: join(ROOT, "package.json"),
  packageLock: join(ROOT, "package-lock.json"),
  cargoToml: join(ROOT, "src-tauri", "Cargo.toml"),
  cargoLock: join(ROOT, "src-tauri", "Cargo.lock"),
  tauriConf: join(ROOT, "src-tauri", "tauri.conf.json"),
  changelog: join(ROOT, "..", "CHANGELOG.md"),
};

function updateJson(path, update) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  update(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function applyVersion(version) {
  if (!SEMVER.test(version)) throw new Error(`Version invalide : ${version}`);
  updateJson(files.packageJson, (d) => (d.version = version));
  updateJson(files.packageLock, (d) => {
    d.version = version;
    if (d.packages?.[""]) d.packages[""].version = version;
  });
  updateJson(files.tauriConf, (d) => (d.version = version));
  writeFileSync(files.cargoToml, setCargoVersion(readFileSync(files.cargoToml, "utf8"), version));
  writeFileSync(files.cargoLock, setCargoVersion(readFileSync(files.cargoLock, "utf8"), version, { lock: true }));
}

function git(...args) {
  // git est cherché dans le PATH du runner de CI (pas de shell, arguments fixes) : chemin absolu impossible à fixer.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Dernier tag vX.Y.Z et commits depuis ce tag (tout l'historique s'il n'y en a pas). */
function commitsSinceLastTag() {
  let lastTag = "";
  try {
    lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*");
  } catch {
    // Aucun tag : tout l'historique compte.
  }
  const range = lastTag ? [`${lastTag}..HEAD`] : ["HEAD"];
  const log = git("log", "--format=%H%x1f%B%x1e", ...range);
  const commits = log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, message = ""] = entry.split("\x1f");
      return { hash, message: message.trim() };
    });
  return { lastTag, commits };
}

/** URL web du dépôt sur GitHub Actions (liens vers les commits), sinon rien. */
function repoUrl() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo } = process.env;
  return server && repo ? `${server}/${repo}` : undefined;
}

/** Écrit la section de `version` en tête de CHANGELOG.md et renvoie ses notes. */
export function writeChangelog(version, date = new Date().toISOString().slice(0, 10)) {
  const { lastTag, commits } = commitsSinceLastTag();
  const url = repoUrl();
  const notes = releaseNotes(commits, { repoUrl: url });
  const section = changelogSection(version, date, notes, { repoUrl: url, previousTag: lastTag || undefined });
  const current = existsSync(files.changelog) ? readFileSync(files.changelog, "utf8") : "";
  writeFileSync(files.changelog, prependChangelog(current, section));
  return notes;
}

/** Prochaine version d'après les commits depuis le dernier tag vX.Y.Z (chaîne vide si rien à publier). */
export function nextVersion() {
  const { lastTag, commits } = commitsSinceLastTag();
  const bump = bumpForCommits(commits.map((c) => c.message));
  if (!bump) return "";

  const current = JSON.parse(readFileSync(files.packageJson, "utf8")).version;
  const base = lastTag ? maxVersion(lastTag.slice(1), current) : current;
  return incrementVersion(base, bump);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [command, arg] = process.argv.slice(2);
  if (command === "next") {
    process.stdout.write(nextVersion());
  } else if (command === "apply" && arg) {
    applyVersion(arg);
    process.stdout.write(`Version ${arg} appliquée\n`);
  } else if (command === "changelog" && arg) {
    process.stdout.write(writeChangelog(arg));
  } else {
    console.error("Usage : node scripts/version.mjs next | apply X.Y.Z | changelog X.Y.Z");
    process.exit(1);
  }
}
