#!/usr/bin/env node
// Contrôle des traductions, lancé avant chaque build (npm run build) : échoue si un texte de l'interface n'est pas traduit.
//
//   1. chaque texte passé à tr() / trn() a sa traduction dans src/i18n/en.ts ;
//   2. une traduction garde les mêmes paramètres {x} que le texte français ;
//   3. aucune traduction ne reste sans usage ;
//   4. aucun texte français n'est écrit en dur hors de tr() / trn() (détection par heuristique).
//
// Un texte identique dans les deux langues (« Push », « Merathon »…) ou volontairement non traduit va dans ALLOWED.
// Les messages du backend Rust n'ont pas besoin de ce contrôle : tr!("fr", "en") exige les deux textes à la compilation.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Attributs JSX affichés à l'utilisateur. */
const UI_ATTRIBUTES = new Set(["title", "label", "aria-label", "placeholder", "description", "subtitle", "alt", "hint", "message", "confirmLabel", "cancelLabel", "emptyText", "heading", "text", "tooltip"]);
const ACCENT = /[À-ÖØ-öø-ÿ]/;
const COMMON_WORDS = new Set(["le", "la", "les", "des", "du", "une", "un", "et", "ou", "est", "dans", "pour", "sur", "pas", "sans", "avec", "ton", "ta", "tes", "vos", "votre", "aucun", "aucune"]);
/** Une phrase française : un accent, ou un mot courant suivi d'un autre mot. */
const looksFrench = (text) => ACCENT.test(text) || text.toLowerCase().split(/\s+/).slice(0, -1).some((word) => COMMON_WORDS.has(word));
const LETTER = /\p{L}/u;

const ALLOWED = new Set([
  // Termes identiques dans les deux langues
  "Email", "Logs", "OAuth", "Options", "Terminal", "URL", "Commit", "commits", "Emojis", "merge", "CI", "CI ·", "px", "Notifications", "Checkout", "Labels", "Fetch",
  "draft", "base", "Tags", "Worktrees", "LFS", "Stashes", "Remote", "solo", "(ed25519)", "Pull", "Push", "Stash", "Pop", "WIP",
  // Noms propres et commandes
  "Merathon", "Merathon — Git Repository Manager", "j6n@merathon", "$ git status", "v", "🎉 dev",
  // Fenêtre de choix de la langue : ses textes existent dans les deux langues, sans passer par tr()
  "Français", "Langue / Language", "Vous pourrez la changer à tout moment dans les préférences.",
  // Titre recherché dans les notes de version, écrites en français : ce n'est pas un texte affiché
  "### Téléchargements",
]);

const scriptKind = (path) => (path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

/** Le catalogue `en` de src/i18n/en.ts, lu sans l'exécuter. */
export function parseCatalog(text) {
  const catalog = new Map();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer) && (ts.isStringLiteralLike(node.name) || ts.isIdentifier(node.name))) {
      catalog.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse("en.ts", text));
  return catalog;
}

const isTranslationCall = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "tr" || node.expression.text === "trn");

/** Appel de console : ces messages restent en français, pour les développeurs. */
const isConsoleCall = (node) => ts.isCallExpression(node) && /^console\./.test(node.expression.getText());

/** Une chaîne affichée à l'utilisateur : le nom d'une propriété n'en est pas une. */
function isHardcodedLiteral(node) {
  const parent = node.parent;
  if (!LETTER.test(node.text) || (ts.isPropertyAssignment(parent) && parent.name === node)) return false;
  return (ts.isJsxAttribute(parent) && UI_ATTRIBUTES.has(parent.name.getText())) || looksFrench(node.text);
}

const isTemplatePart = (node) => ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/** Textes traduits et textes français en dur d'un fichier source. */
export function scanSource(path, text) {
  const sf = parse(path, text);
  const keys = [];
  const hardcoded = [];
  const report = (node, value) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!ALLOWED.has(clean)) hardcoded.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: clean });
  };
  // Dans tr(texte, params) et trn(n, un, plusieurs, params), seuls les textes sont des clés : le reste est du code ordinaire.
  const visitTranslationCall = (node) => {
    const firstKey = node.expression.text === "trn" ? 1 : 0;
    const lastKey = node.expression.text === "trn" ? 2 : 0;
    node.arguments.forEach((arg, i) => {
      if (i >= firstKey && i <= lastKey && ts.isStringLiteralLike(arg)) keys.push(arg.text);
      else visit(arg);
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node) || isConsoleCall(node)) return;
    if (isTranslationCall(node)) visitTranslationCall(node);
    else if (ts.isJsxText(node)) {
      const value = node.text.replace(/&\w+;/g, "");
      if (LETTER.test(value)) report(node, value);
    } else if (ts.isStringLiteralLike(node)) {
      if (isHardcodedLiteral(node)) report(node, node.text);
    } else if (isTemplatePart(node)) {
      if (looksFrench(node.text)) report(node, node.text);
    } else ts.forEachChild(node, visit);
  };
  visit(sf);
  return { keys, hardcoded };
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const isSource = /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") && !entry.name.endsWith(".d.ts") && entry.name !== "en.ts";
    return isSource ? [path] : [];
  });
}

/** Problèmes de traduction du projet, sous forme de lignes à afficher. */
export function findIssues(root = ROOT) {
  const catalog = parseCatalog(readFileSync(join(root, "src/i18n/en.ts"), "utf8"));
  const used = new Set();
  const issues = [];
  for (const path of sourceFiles(join(root, "src"))) {
    const { keys, hardcoded } = scanSource(path, readFileSync(path, "utf8"));
    const file = relative(root, path);
    for (const key of keys) {
      used.add(key);
      if (!catalog.has(key)) issues.push(`${file} : traduction manquante dans en.ts : ${JSON.stringify(key)}`);
    }
    for (const { line, text } of hardcoded) issues.push(`${file}:${line} : texte en dur, à passer dans tr() : ${JSON.stringify(text)}`);
  }
  for (const [key, value] of catalog) {
    if (!used.has(key)) issues.push(`en.ts : traduction sans usage : ${JSON.stringify(key)}`);
    if (placeholders(key) !== placeholders(value)) issues.push(`en.ts : paramètres différents : ${JSON.stringify(key)} → ${JSON.stringify(value)}`);
  }
  return issues;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = findIssues();
  if (issues.length) {
    console.error(`Traductions : ${issues.length} problème(s)\n\n${issues.join("\n")}\n`);
    process.exit(1);
  }
  console.log("Traductions : aucun problème");
}
