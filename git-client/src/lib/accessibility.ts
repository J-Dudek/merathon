/**
 * Compte rendu d'accessibilité et déclaration d'accessibilité (rubrique « Accessibilité » des préférences).
 * Une seule source pour l'affichage et pour l'export Markdown : à mettre à jour à chaque nouvelle évaluation.
 */

import { REPO_URL } from "./about";

export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;
/** Documents d'audit, publiés avec chaque release dans le dépôt public (docs/accessibilite). */
export const RGAA_GRID_URL = `${REPO_URL}/blob/main/docs/accessibilite/grille-rgaa.md`;
export const RGAA_GRID_CSV_URL = `${REPO_URL}/blob/main/docs/accessibilite/grille-rgaa.csv`;
export const ORCA_PROTOCOL_URL = `${REPO_URL}/blob/main/docs/accessibilite/protocole-orca.md`;

/** Vues évaluées et leur score Lighthouse (en %) en thème sombre puis en thème clair. */
export const EVALUATED_VIEWS: { name: string; dark: number; light: number }[] = [
  { name: "Accueil (aucun dépôt ouvert)", dark: 100, light: 100 },
  { name: "Dépôt : graphe des commits et indexation", dark: 100, light: 100 },
  { name: "Détail d'un commit", dark: 100, light: 100 },
  { name: "Diff d'un fichier de commit", dark: 100, light: 100 },
  { name: "Diff de la copie de travail", dark: 100, light: 100 },
  { name: "Menu contextuel d'une branche", dark: 100, light: 100 },
  { name: "Création de branche", dark: 100, light: 100 },
  { name: "Recherche", dark: 100, light: 100 },
  { name: "Journal", dark: 100, light: 100 },
  { name: "Terminal", dark: 100, light: 100 },
  { name: "Comptes", dark: 100, light: 100 },
  { name: "Clonage", dark: 100, light: 100 },
  { name: "Préférences : Apparence", dark: 100, light: 100 },
  { name: "Préférences : Terminal", dark: 100, light: 100 },
  { name: "Préférences : Synchronisation", dark: 100, light: 100 },
  { name: "Préférences : Raccourcis", dark: 100, light: 100 },
  { name: "Préférences : Mon activité", dark: 100, light: 100 },
  { name: "Préférences : Accessibilité", dark: 100, light: 100 },
  { name: "Préférences : À propos", dark: 100, light: 100 },
  { name: "Mémo Git", dark: 100, light: 100 },
  { name: "Rebase interactif", dark: 100, light: 100 },
  { name: "Confirmation et notifications", dark: 100, light: 100 },
  { name: "Célébration d'un palier", dark: 100, light: 100 },
];

export interface Finding {
  title: string;
  detail: string;
  /** Critère WCAG 2.1 concerné. */
  criterion: string;
  /** Critère RGAA 4.1.2 correspondant, s'il y a lieu. */
  rgaa?: string;
}

/** Statuts de la grille RGAA pré-remplie (docs/accessibilite/grille-rgaa.csv) : un test vérifie la concordance. */
export type RgaaStatus = "C" | "NC" | "NA" | "NT";

export const AUDIT = {
  date: "2026-10-16",
  standard: "RGAA 4.1.2 (WCAG 2.1 niveau AA)",
  tools: [
    "Revue des 106 critères du RGAA dans le code et dans l'interface (grille publiée)",
    "axe-core 4.10.2 (règles WCAG 2.0, 2.1 A / AA et bonnes pratiques) sur 35 états de l'interface, dans deux moteurs et deux thèmes",
    "Lighthouse 12.2.1, catégorie Accessibilité (moteur axe-core)",
    "html-validate sur le DOM généré (critère 8.2)",
    "Parcours clavier automatisé (Playwright) : ordre de tabulation et visibilité du focus de chaque vue",
    "Fenêtres de 640 × 400 et 320 × 256 px (zoom 200 % et 400 %), espacement du texte WCAG, feuilles de style désactivées",
  ],
  environment:
    "Chromium (moteur de WebView2) et WebKit 27 (moteur de WebKitGTK et de WKWebView), pilotés par Playwright sous Linux, fenêtre de 1280 × 800 px. L'interface est rendue avec un backend simulé (dépôt fictif, compte GitHub fictif avec pull requests et issues, fusion en conflit), en thème sombre et en thème clair.",
  /** Score Lighthouse moyen avant corrections, en %. */
  scoreBefore: 87.4,
  fixes: [
    { title: "Onglets des dépôts", detail: "Chaque onglet est un vrai bouton, dans une zone de navigation nommée « Dépôts ouverts » : ils deviennent utilisables au clavier.", criterion: "1.3.1, 4.1.2" },
    { title: "Contrastes du texte", detail: "Couleur d'accent dédiée au texte, gris secondaire éclairci (sombre) ou foncé (clair), nuances foncées pour le vert, le rouge et le bleu du thème clair, numéros de ligne des diffs à pleine opacité : 4,5:1 au moins sur toutes les surfaces, y compris survolées ou sélectionnées.", criterion: "1.4.3" },
    { title: "Texte blanc sur l'accent", detail: "Fond d'accent assombri sous le texte blanc (branche courante, pastilles, badge « nouveau »).", criterion: "1.4.3" },
    { title: "Zones de clic", detail: "24 px au moins pour les flèches de Pull et Push, les en-têtes de la barre latérale, l'effacement de la recherche et les flèches du rebase interactif ; cases à cocher plus espacées.", criterion: "2.5.8 (WCAG 2.2)" },
    { title: "Curseurs des préférences", detail: "Chaque réglette annonce son nom et sa valeur (« Taille de l'interface, 110 % »).", criterion: "4.1.2" },
    { title: "Bouton d'effacement de la recherche", detail: "Nommé « Effacer la recherche » (il n'avait pas de nom).", criterion: "4.1.2" },
    { title: "Célébrations", detail: "Annonce par une zone de statut permanente, fermeture par Échap, emojis et animations masqués aux lecteurs d'écran, scintillement ramené sous 3 Hz, mouvement supprimé si le système demande de réduire les animations.", criterion: "2.2.2, 2.3.1, 4.1.3" },
    { title: "Graphe des commits", detail: "Liste utilisable au clavier : flèches, Origine / Fin et Page préc. / suiv. pour changer de commit, touche Menu ou Maj+F10 pour son menu ; le commit actif est annoncé (descendant actif), position comprise.", criterion: "2.1.1, 4.1.2" },
    { title: "Barre latérale", detail: "Branches, tags, stashes et sous-modules atteignables au clavier : Espace sélectionne (Ctrl / Maj compris), Entrée fait l'action du double clic, touche Menu ou Maj+F10 ouvre le menu ; le badge de PR est un bouton à part.", criterion: "2.1.1, 4.1.2" },
    { title: "Menus contextuels", detail: "Ouverts au clavier partout (touche Menu ou Maj+F10) ; le premier choix prend le focus, flèches et Origine / Fin pour naviguer, Échap ou Tab pour fermer, le focus revient à l'élément d'origine.", criterion: "2.1.1, 2.4.3" },
    { title: "Terminal intégré", detail: "Mode lecteur d'écran de xterm.js activé : la sortie est restituée aux technologies d'assistance.", criterion: "1.3.1, 4.1.3" },
    { title: "Étiquettes des champs", detail: "Chaque champ qui n'avait qu'un texte d'exemple a une étiquette (aria-label doublé d'un title) ; nom et e-mail de l'identité Git avec autocomplete.", criterion: "1.3.1, 3.3.2, 4.1.2, 1.3.5", rgaa: "11.1, 11.13" },
    { title: "Titres", detail: "Titre de niveau 1 invisible, niveau 2 pour les sections des panneaux et les titres des fenêtres, niveaux 3 à 5 dans les préférences et le mémo ; sections de la barre latérale dépliables avec leur état (aria-expanded).", criterion: "1.3.1, 2.4.6", rgaa: "9.1" },
    { title: "Sortie du terminal", detail: "Ctrl+Maj+J rend le focus à l'onglet « Terminal » : plus de piège au clavier. La touche est annoncée dans le nom du terminal et documentée dans les raccourcis.", criterion: "2.1.2", rgaa: "12.9" },
    { title: "Infobulles", detail: "Masquées avec Échap, survolables sans disparaître ; l'infobulle du graphe se masque aussi avec Échap.", criterion: "1.4.13", rgaa: "10.13" },
    { title: "Tableau du diff", detail: "En-têtes de colonnes déclarés (masqués visuellement) : sélection, commentaire, ancienne ligne, nouvelle ligne, contenu.", criterion: "1.3.1", rgaa: "5.6, 5.7" },
    { title: "Boîtes de dialogue", detail: "Fenêtres déclarées comme boîtes de dialogue modales, nommées par leur titre.", criterion: "4.1.2", rgaa: "7.1" },
    { title: "Mon activité", detail: "Badges atteignables au clavier, avec un nom complet (« 10ᵉ commit, obtenu le … ») et l'infobulle au focus ; barres de progression annoncées.", criterion: "2.1.1, 1.1.1, 4.1.2" },
    { title: "Symboles", detail: "Les symboles décoratifs (⎇ ☁ ⇣ ⟳ ▾ …) sont masqués aux lecteurs d'écran ; la nature des étiquettes (branche courante, branche distante, tag), les compteurs (en avance, en retard, stashes, erreurs) et les commits de fusion sont dits en toutes lettres.", criterion: "1.1.1, 1.3.1", rgaa: "1.2, 13.5" },
    { title: "Boutons à symbole", detail: "Les boutons qui n'affichent qu'un symbole (+, −, ↺, ✕, ⋯, ↻) sont nommés par leur action et leur objet (« Indexer src/index.html », « Fermer l'onglet site-vitrine »).", criterion: "4.1.2, 2.4.6", rgaa: "11.9" },
    { title: "Fichiers et dossiers au clavier", detail: "Fichiers de l'indexation, du détail d'un commit, d'une comparaison et d'une PR, dossiers de l'arborescence, PR / MR, issues, versions d'un conflit et lignes du diff (sélection pour l'indexation partielle) deviennent atteignables et activables au clavier, avec leur état (modifié, ajouté, vu, sélectionné…).", criterion: "2.1.1, 4.1.2", rgaa: "7.3" },
    { title: "États des boutons", detail: "Onglets Dépôt / Comptes, Terminal / Journal, rubriques des préférences et du mémo, thème, densité, mode du rebase, versions d'un conflit et dossiers dépliables annoncent leur état (enfoncé, page courante, déplié) ; le menu du thème est une liste de choix exclusifs.", criterion: "4.1.2", rgaa: "7.1" },
    { title: "Information par la couleur", detail: "État d'une PR, d'une issue et d'un check donné par la forme de l'icône (et en toutes lettres pour les lecteurs d'écran) ; branches masquées signalées par un œil barré au lieu d'une transparence.", criterion: "1.4.1", rgaa: "3.1" },
    { title: "Contrastes", detail: "Fond plein sous le texte blanc des boutons principaux, du bouton Résoudre et du bandeau de rebase ; nombres de lignes supprimées et étiquettes distantes plus foncés ; bordures des champs à 3:1 ; texte des fichiers vus et des branches masquées sans transparence ; textes de chargement sans clignotement.", criterion: "1.4.3, 1.4.11, 2.2.2", rgaa: "3.2, 3.3, 13.8" },
    { title: "Structure", detail: "Lien d'évitement « Aller au contenu principal », panneaux latéraux en régions nommées, titre de la page avec le dépôt ouvert, intertitres de la PR et du mémo en vrais titres, liste des commits du rebase et des checks en listes.", criterion: "2.4.1, 1.3.1, 2.4.2", rgaa: "12.6, 12.7, 8.6, 9.1, 9.3" },
    { title: "Messages de statut", detail: "Opération en cours (Fetch…, Push…), nombre de commits trouvés par la recherche, de fiches du mémo, déplacement d'un commit du rebase et copie de la déclaration annoncés par des zones de statut.", criterion: "4.1.3", rgaa: "7.5" },
    { title: "Notifications", detail: "Les erreurs restent affichées jusqu'à leur fermeture ; les autres notifications ne disparaissent pas tant que la souris ou le focus est dessus.", criterion: "2.2.1", rgaa: "13.1" },
    { title: "Zones défilantes et redimensionnement", detail: "Diff, contenu des préférences et du mémo atteignables au clavier pour défiler ; poignées de redimensionnement des panneaux et de l'arbre des branches utilisables aux flèches.", criterion: "2.1.1", rgaa: "7.3" },
    { title: "Focus visible", detail: "Contour d'accent sur les champs au focus clavier (leur bordure teintée était trop discrète), focus visible sur les lignes de fichiers, de PR et du diff.", criterion: "2.4.7", rgaa: "10.7" },
    { title: "Contenus au survol", detail: "Les boutons qui n'apparaissent qu'au survol (fermer un onglet, ajouter un remote, options d'un compte, retirer un dépôt récent, actions des fichiers) apparaissent aussi au focus clavier ; les infobulles, redondantes avec le nom des boutons, sont masquées aux lecteurs d'écran.", criterion: "1.4.13, 2.1.1", rgaa: "10.14, 10.8" },
    { title: "Zoom et réagencement", detail: "Sous 760 px de large (zoom 200 % sur une petite fenêtre), la barre d'outils passe à la ligne et les panneaux s'empilent avec un défilement vertical ; plus de contenu tronqué ni de défilement horizontal.", criterion: "1.4.4, 1.4.10", rgaa: "10.4, 10.11" },
    { title: "Formulaires", detail: "Champs obligatoires déclarés (création, clonage), suggestions des relecteurs / assignés / labels en liste de choix au clavier, choix et fermeture des fenêtres au relâchement du clic plutôt qu'à l'appui.", criterion: "3.3.2, 4.1.2, 2.5.2", rgaa: "11.10, 7.1, 13.11" },
  ] satisfies Finding[],
  manualChecks: [
    "Arbre d'accessibilité de chaque vue (noms, rôles, états) dans Chromium et WebKit.",
    "Tabulation de chaque vue et de chaque fenêtre : ordre logique, focus toujours visible, aucun piège.",
    "Rendu à 640 × 400 et 320 × 256 px, avec l'espacement du texte WCAG, et sans feuilles de style.",
    "Ordre de tabulation des préférences et de « Mon activité ».",
    "Infobulles affichées au focus clavier, sans rester affichées après un clic souris.",
    "Texte annoncé par la zone de statut des célébrations.",
    "Fermeture des célébrations par Échap.",
    "Contrastes du texte posé sur les animations et sur les fonds semi-transparents.",
    "Navigation au clavier du graphe, de la barre latérale et des menus contextuels (flèches, Espace, Entrée, Maj+F10, Échap, Tab), focus rendu à la fermeture des menus.",
    "Présence de la zone de restitution du terminal pour les lecteurs d'écran.",
    "Sortie du terminal au clavier (Ctrl+Maj+J) et nom annoncé du terminal.",
    "Infobulles : affichage au focus, masquage par Échap, survol de l'infobulle.",
    "Étiquettes de tous les champs, en-têtes du diff, titres et boîtes de dialogue dans le DOM.",
  ],
  /** Écrans vérifiés en plus des vues notées par Lighthouse (compte GitHub et conflit simulés). */
  extraViews: [
    "Pull requests : liste, détail, fichiers modifiés et commentaires, création",
    "Mes PR et issues (onglet Comptes)",
    "Résolution d'un conflit de fusion",
    "Menus contextuels d'un commit, du dépôt, du thème et de Pull",
    "Diff d'un fichier de commit sélectionné, recherche, mise de côté (stash), suppression confirmée",
  ],
  /** Non-conformités connues, non corrigées : la déclaration les reprend (mêmes critères que les « NC » de la grille). */
  nonCompliant: [] as Finding[],
  /** Synthèse de la grille RGAA pré-remplie, par statut (106 critères). */
  rgaaGrid: { C: 66, NC: 0, NA: 38, NT: 2 } satisfies Record<RgaaStatus, number>,
  notEvaluated: [
    "Restitution par un lecteur d'écran réel (Orca) dans l'application : critères 7.1 et 7.5, à vérifier avec le protocole Orca.",
    "Moteurs embarqués eux-mêmes (WebKitGTK, WebView2, WKWebView) : les tests ont été faits dans Chromium et WebKit, leurs moteurs.",
    "Écrans propres à GitLab (merge requests) : mêmes composants que pour GitHub, testés avec un compte GitHub simulé.",
  ],
};

const scores = () => EVALUATED_VIEWS.flatMap((v) => [v.dark, v.light]);

/** Score Lighthouse moyen après corrections, en %. */
export const scoreAfter = () => scores().reduce((sum, s) => sum + s, 0) / scores().length;

/** Nombre de vues (une par thème) à 100 %. */
export const viewsAtFullScore = () => scores().filter((s) => s === 100).length;

export interface DeclarationBlock {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

const formatDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${iso}T12:00:00`));

/** « 1 critère reste », « 2 critères restent ». */
const remaining = (n: number) => (n > 1 ? `${n} critères restent` : `${n} critère reste`);

export interface Conformity {
  /** « totalement conforme », « partiellement conforme » ou « non conforme ». */
  status: string;
  /** Taux de conformité (critères conformes ÷ critères applicables), en % ; null tant que des critères restent à tester. */
  rate: number | null;
}

/**
 * État de conformité au sens du RGAA d'après la grille : le taux n'existe que si chaque critère a un statut.
 * 100 % : totalement conforme ; 50 % au moins : partiellement conforme ; sinon, ou audit incomplet : non conforme.
 */
export function conformity(grid: Record<RgaaStatus, number> = AUDIT.rgaaGrid): Conformity {
  const applicable = grid.C + grid.NC;
  if (grid.NT > 0 || applicable === 0) return { status: "non conforme", rate: null };
  const rate = (grid.C / applicable) * 100;
  if (rate === 100) return { status: "totalement conforme", rate };
  return { status: rate >= 50 ? "partiellement conforme" : "non conforme", rate };
}

/**
 * Déclaration d'accessibilité, sur le modèle du RGAA 4.1.2.
 * L'état de conformité découle de la grille d'audit : tant qu'un critère reste à tester, il est « non conforme ».
 */
export function declaration(nonCompliant: Finding[] = AUDIT.nonCompliant, grid: Record<RgaaStatus, number> = AUDIT.rgaaGrid): DeclarationBlock[] {
  const date = formatDate(AUDIT.date);
  const { status, rate } = conformity(grid);
  const counts = `${grid.C} critères conformes, ${grid.NC} non conformes et ${grid.NA} non applicables sur les 106 du référentiel`;
  return [
    {
      heading: "Engagement",
      paragraphs: [
        "Julien Dudek, auteur de Merathon, s'engage à rendre l'application accessible.",
        "Cette déclaration suit, à titre volontaire, le modèle prévu par l'article 47 de la loi n° 2005-102 du 11 février 2005 et par le référentiel général d'amélioration de l'accessibilité (RGAA 4.1.2).",
        `Elle s'applique à l'application de bureau Merathon, dans la version évaluée le ${date}.`,
      ],
    },
    {
      heading: "État de conformité",
      paragraphs: [
        rate === null
          ? `Merathon est non conforme avec le RGAA 4.1.2 : l'audit n'est pas terminé, ${remaining(grid.NT)} à vérifier.`
          : `Merathon est ${status} avec le RGAA 4.1.2.`,
      ],
    },
    {
      heading: "Résultats des tests",
      paragraphs: [
        rate === null
          ? `L'audit interne mené le ${date} compte ${counts} ; ${grid.NT} restent à vérifier avec un lecteur d'écran. Le taux de conformité sera calculé quand tous les critères auront été testés.`
          : `L'audit interne mené le ${date} révèle que ${formatPercent(rate)} des critères du RGAA version 4.1.2 sont respectés : ${counts}.`,
        `Le score d'accessibilité Lighthouse moyen est de ${formatPercent(scoreAfter())} (${viewsAtFullScore()} vues sur ${EVALUATED_VIEWS.length * 2} à 100 %) ; il ne contrôle qu'une partie des critères et ne constitue pas un taux de conformité.`,
        `Grille d'audit détaillée, critère par critère : ${RGAA_GRID_URL}`,
      ],
    },
    nonCompliant.length
      ? {
          heading: "Contenus non accessibles",
          paragraphs: ["Non-conformités connues :"],
          list: nonCompliant.map((f) => `${f.title} : ${f.detail.charAt(0).toLowerCase()}${f.detail.slice(1)} (${criteria(f)})`),
        }
      : {
          heading: "Contenus non accessibles",
          paragraphs: [
            rate === null
              ? "Aucune non-conformité n'est connue à ce jour. Les critères qui restent à vérifier (voir le compte rendu, rubrique « Non évalué ») peuvent en révéler."
              : "Aucune non-conformité n'a été relevée lors de l'audit.",
          ],
        },
    {
      heading: "Dérogations",
      paragraphs: ["Aucune dérogation n'est invoquée."],
    },
    {
      heading: "Établissement de cette déclaration",
      paragraphs: [`Cette déclaration a été établie le ${date}.`],
      list: [
        "Technologies utilisées : HTML, CSS, JavaScript (React), WAI-ARIA, dans une application Tauri (WebKitGTK sous Linux, WebView2 sous Windows, WKWebView sous macOS).",
        `Environnement de test : ${AUDIT.environment}`,
        `Outils d'évaluation : ${AUDIT.tools.join(" ; ")}.`,
        `Vues vérifiées : ${[...EVALUATED_VIEWS.map((v) => v.name), ...AUDIT.extraViews].join(", ")}.`,
        `Grille d'audit RGAA : ${RGAA_GRID_URL} (format tableur : ${RGAA_GRID_CSV_URL}).`,
        `Protocole de test avec le lecteur d'écran Orca : ${ORCA_PROTOCOL_URL}.`,
      ],
    },
    {
      heading: "Retour d'information et contact",
      paragraphs: [
        `Si vous n'arrivez pas à accéder à un contenu ou à une fonctionnalité de Merathon, signalez-le en ouvrant un ticket : ${ISSUES_URL}. Une alternative accessible ou une correction vous sera proposée.`,
      ],
    },
    {
      heading: "Voies de recours",
      paragraphs: [
        "Si vous avez signalé un défaut d'accessibilité qui vous empêche d'accéder à un contenu ou à une fonctionnalité et que vous n'avez pas obtenu de réponse satisfaisante, vous pouvez :",
      ],
      list: [
        "écrire un message au Défenseur des droits : https://formulaire.defenseurdesdroits.fr/ ;",
        "contacter le délégué du Défenseur des droits dans votre région : https://www.defenseurdesdroits.fr/saisir/delegues ;",
        "envoyer un courrier par la poste (gratuit, ne pas mettre de timbre) : Défenseur des droits, Libre réponse 71120, 75342 Paris CEDEX 07.",
      ],
    },
  ];
}

/** Critères d'une non-conformité : « RGAA 11.1, WCAG 1.3.1 ». */
export function criteria(f: Finding): string {
  return f.rgaa ? `RGAA ${f.rgaa}, WCAG ${f.criterion}` : `WCAG ${f.criterion}`;
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Déclaration au format Markdown, à publier (README, site) ou à joindre. */
export function declarationMarkdown(): string {
  const blocks = declaration().map((b) =>
    [`## ${b.heading}`, ...(b.paragraphs ?? []), ...(b.list?.length ? [b.list.map((l) => `- ${l}`).join("\n")] : [])].join("\n\n"),
  );
  return ["# Déclaration d'accessibilité de Merathon", ...blocks].join("\n\n") + "\n";
}
