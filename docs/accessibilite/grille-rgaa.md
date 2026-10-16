# Grille d'audit RGAA 4.1.2 — Merathon

Grille de l'audit interne de conformité de Merathon au [RGAA 4.1.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/), mené le 16 octobre 2026 sur les 106 critères. Chaque statut est justifié dans la colonne « Constat » ; les deux critères qui restent à tester demandent un lecteur d'écran dans l'application elle-même.

La même grille, au format tableur, est dans [`grille-rgaa.csv`](grille-rgaa.csv) : colonnes « Statut auditeur » et « Commentaire auditeur » à remplir. Les tests avec un lecteur d'écran suivent le [protocole Orca](protocole-orca.md).

## Synthèse

| Statut | Critères |
|---|---|
| Conforme (C) | 66 |
| Non conforme (NC) | 0 |
| Non applicable (NA) | 38 |
| Non testé (NT) | 2 |
| **Total** | **106** |

Taux de conformité au sens du RGAA (critères conformes ÷ critères applicables) : **non calculable** tant que des critères restent non testés. Les deux critères restants (7.1 et 7.5) se vérifient avec le [protocole Orca](protocole-orca.md) : s'ils sont conformes, le taux sera de 68 / 68, soit 100 %.

## Légende et méthode

- **C** : conforme, vérifié (outil, code ou test manuel indiqué dans la colonne « Constat »).
- **NC** : non conforme, constaté dans le code ou en test.
- **NA** : non applicable à une application de bureau, ou aucun contenu concerné.
- **NT** : non testé ; la colonne « Constat » donne les éléments déjà connus et les pistes de vérification.
- Échantillon : les 23 vues listées dans la rubrique Accessibilité des préférences et les écrans des pull requests, des issues et de la résolution de conflit (35 états), en thème sombre et en thème clair.
- Environnement : Chromium (moteur de WebView2) et WebKit (moteur de WebKitGTK et de WKWebView) pilotés par Playwright, backend simulé (dépôt fictif, compte GitHub fictif, fusion en conflit). Outils : axe-core 4.10.2, html-validate, parcours clavier automatisé (tabulation et focus visible), fenêtres de 640 × 400 et 320 × 256 px, espacement du texte WCAG, feuilles de style désactivées, revue du code.
- Intitulés résumés : le texte officiel de chaque critère, ses tests et ses cas particuliers sont accessibles par le lien du numéro.

## 1. Images

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [1.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.1) | Chaque image porteuse d'information a-t-elle une alternative textuelle ? | **C** | Images porteuses d'information : logo de l'accueil (alt « Merathon — Git Repository Manager »), verdicts des relecteurs (role=img et nom : « a approuvé »…). Icônes d'état (PR, issue, check, fichier) doublées d'un texte pour les lecteurs d'écran. Graphe (canvas) masqué : branches, fusions et parents sont donnés en texte (étiquettes de chaque ligne, « commit de fusion », parents dans le détail du commit). |
| [1.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.2) | Chaque image de décoration est-elle correctement ignorée par les technologies d'assistance ? | **C** | Logos à côté du nom en alt="", icônes Lucide en aria-hidden, symboles typographiques (⎇ ☁ ⌂ ⊟ ⇣ ⟳ ▾ ✕ ↺…) en aria-hidden, canvas du graphe, aperçus de densité (SVG) et emojis masqués. Vérifié dans l'arbre d'accessibilité de chaque vue (Chromium et WebKit). |
| [1.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.3) | Pour chaque image porteuse d'information ayant une alternative textuelle, cette alternative est-elle pertinente ? | **C** | Alternatives vérifiées : logo, verdicts (« a approuvé », « demande des changements », « en attente »), état des PR (« PR ouverte »), des issues, des checks (« réussi », « en échec »), statut des fichiers (« modifié », « ajouté »…). |
| [1.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.4) | Image CAPTCHA ou image-test : l'alternative permet-elle d'en identifier la nature et la fonction ? | **NA** | Aucun CAPTCHA ni image-test. |
| [1.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.5) | Image CAPTCHA : une solution d'accès alternatif est-elle présente ? | **NA** | Aucun CAPTCHA. |
| [1.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.6) | Chaque image porteuse d'information a-t-elle, si nécessaire, une description détaillée ? | **NA** | Aucune image ne nécessite de description détaillée : le graphe des commits est masqué et son information est donnée en texte (voir 1.1). |
| [1.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.7) | Chaque description détaillée est-elle pertinente ? | **NA** | Aucune description détaillée. |
| [1.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.8) | Chaque image texte porteuse d'information est-elle remplacée par du texte stylé (hors cas particuliers) ? | **C** | Seul texte en image : le logotype (cas particulier). |
| [1.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.9) | Chaque légende d'image est-elle correctement reliée à l'image ? | **NA** | Aucune légende d'image. |

## 2. Cadres

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [2.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#2.1) | Chaque cadre a-t-il un titre de cadre ? | **NA** | Aucun cadre (iframe). |
| [2.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#2.2) | Chaque titre de cadre est-il pertinent ? | **NA** | Aucun cadre (iframe). |

## 3. Couleurs

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [3.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.1) | L'information n'est-elle pas donnée uniquement par la couleur ? | **C** | Statut des fichiers : lettre (M, A, D…) et texte ; diffs : préfixe + / − et « Ajoutée / Supprimée » ; PR, issues et checks : icônes de formes différentes ; PR non lue : titre en gras ; branches masquées : œil barré (au lieu d'une transparence) ; conflit : libellés « Actuel (HEAD) » / « Entrant » et coche. Sélection : fond teinté doublé du détail affiché dans le panneau de droite. |
| [3.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.2) | Le contraste entre le texte et son arrière-plan est-il suffisamment élevé ? | **C** | axe-core sur 35 états de l'interface, en Chromium et WebKit, thèmes sombre et clair : aucun défaut de contraste (corrigé : boutons principaux, bouton Résoudre, bandeau de rebase, lignes supprimées, étiquettes distantes en thème clair). Lighthouse : 46 vues sur 46 ; calculs manuels sur fonds semi-transparents et animations. |
| [3.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.3) | Les couleurs des composants d'interface et des éléments graphiques porteurs d'information sont-elles suffisamment contrastées ? | **C** | Bordures des champs à 3:1 au moins (corrigé), contour de focus en couleur d'accent, cases à cocher natives, barres de progression 3,1 à 3,9:1, icônes d'état sur fond uni ; bordures des badges et du cadenas non porteuses d'information. |

## 4. Multimédia

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [4.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.1) | Chaque média temporel pré-enregistré a-t-il, si nécessaire, une transcription textuelle ou une audiodescription ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.2) | Pour chaque média temporel pré-enregistré ayant une transcription ou une audiodescription, celle-ci est-elle pertinente ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.3) | Chaque média temporel synchronisé pré-enregistré a-t-il, si nécessaire, des sous-titres synchronisés ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.4) | Pour chaque média temporel ayant des sous-titres synchronisés, ceux-ci sont-ils pertinents ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.5) | Chaque média temporel pré-enregistré a-t-il, si nécessaire, une audiodescription synchronisée ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.6) | Pour chaque média temporel ayant une audiodescription synchronisée, celle-ci est-elle pertinente ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.7) | Chaque média temporel est-il clairement identifiable ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.8) | Chaque média non temporel a-t-il, si nécessaire, une alternative ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.9) | Pour chaque média non temporel ayant une alternative, celle-ci est-elle pertinente ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.10) | Chaque son déclenché automatiquement est-il contrôlable par l'utilisateur ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.11) | La consultation de chaque média temporel est-elle contrôlable par le clavier et tout dispositif de pointage ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.12) | La consultation de chaque média non temporel est-elle contrôlable par le clavier et tout dispositif de pointage ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |
| [4.13](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#4.13) | Chaque média temporel et non temporel est-il compatible avec les technologies d'assistance ? | **NA** | Aucun média (audio, vidéo, animation porteuse d'information) ; les animations de célébration relèvent du 13.8. |

## 5. Tableaux

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [5.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.1) | Chaque tableau de données complexe a-t-il un résumé ? | **NA** | Le diff n'est pas un tableau complexe. |
| [5.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.2) | Pour chaque tableau de données complexe ayant un résumé, celui-ci est-il pertinent ? | **NA** |  |
| [5.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.3) | Pour chaque tableau de mise en forme, le contenu linéarisé reste-t-il compréhensible ? | **NA** | Le diff est traité comme un tableau de données. |
| [5.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.4) | Pour chaque tableau de données ayant un titre, le titre est-il correctement associé au tableau ? | **NA** | Le tableau du diff n'a pas de titre (le nom du fichier est affiché au-dessus, la zone défilante qui le contient est nommée « Différences de … »). |
| [5.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.5) | Pour chaque tableau de données ayant un titre, celui-ci est-il pertinent ? | **NA** | Aucun tableau avec titre. |
| [5.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.6) | Pour chaque tableau de données, chaque en-tête de colonne et de ligne est-il correctement déclaré ? | **C** | Seul tableau de données : le diff. En-têtes de colonnes déclarés (th) et masqués visuellement : Sélection, Commentaire (revue de PR), Ancienne ligne, Nouvelle ligne, Contenu. |
| [5.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.7) | Pour chaque tableau de données, la technique appropriée associe-t-elle chaque cellule à ses en-têtes ? | **C** | Tableau simple : en-têtes en scope="col". |
| [5.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.8) | Chaque tableau de mise en forme ne doit pas utiliser d'éléments propres aux tableaux de données. Est-ce respecté ? | **NA** |  |

## 6. Liens

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [6.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#6.1) | Chaque lien est-il explicite ? | **C** | Liens : issues (« Issue ouverte : titre #numéro · auteur ») et adresses de la déclaration d'accessibilité, explicites par leur intitulé et leur contexte. Les autres ouvertures du navigateur sont des boutons nommés (« Ouvrir sur GitHub », « Signaler un problème d'accessibilité »). |
| [6.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#6.2) | Chaque lien a-t-il un intitulé ? | **C** | Chaque lien a un intitulé (arbre d'accessibilité vérifié). |

## 7. Scripts

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [7.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.1) | Chaque script est-il, si nécessaire, compatible avec les technologies d'assistance ? | **NT** | Vérifié dans le DOM (Chromium et WebKit) : graphe en liste à descendant actif, menus (menuitem, menuitemradio, groupes nommés), boîtes de dialogue modales nommées, boutons à état (aria-pressed, aria-expanded, aria-current), suggestions en combobox / listbox, poignées en séparateurs à valeur. Reste à confirmer la restitution avec Orca dans l'application (protocole Orca). |
| [7.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.2) | Pour chaque script ayant une alternative, cette alternative est-elle pertinente ? | **C** | Glisser-déposer du rebase : boutons « Monter / Descendre <hash> » sur chaque commit, nouvelle position annoncée ; la poignée réservée à la souris est masquée aux lecteurs d'écran. |
| [7.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.3) | Chaque script est-il contrôlable par le clavier et par tout dispositif de pointage ? | **C** | Parcours clavier automatisé de chaque vue : graphe (flèches, Origine / Fin), barre latérale, menus (Maj+F10), fichiers de l'indexation, du commit et des PR, dossiers, PR et issues, versions d'un conflit, lignes du diff (Espace, Maj+Espace), suggestions (flèches, Entrée), poignées de redimensionnement (flèches), zones défilantes (diff, préférences, mémo). Clic droit sur une étiquette de branche du graphe : mêmes actions dans la barre latérale. |
| [7.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.4) | Pour chaque script qui initie un changement de contexte, l'utilisateur est-il averti ou en a-t-il le contrôle ? | **C** | Aucun changement de contexte sans action de l'utilisateur : les filtres et réglages (thème, état des PR) s'appliquent sur place ; les fenêtres s'ouvrent sur demande. |
| [7.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.5) | Les messages de statut sont-ils correctement restitués par les technologies d'assistance ? | **NT** | Zones de statut en place (vérifiées dans le DOM) : opération en cours, nombre de commits trouvés, fiches du mémo, déplacement d'un commit du rebase, copie de la déclaration, notifications (status / alert), célébrations. Reste à confirmer leur annonce avec Orca dans l'application. |

## 8. Éléments obligatoires

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [8.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.1) | Chaque page web est-elle définie par un type de document ? | **C** | &lt;!doctype html&gt; dans index.html. |
| [8.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.2) | Le code source généré est-il valide selon le type de document ? | **C** | html-validate sur le DOM de 11 états (graphe, diffs, préférences, mémo, PR, comptes, menu) : aucune erreur après correction (aria-label sur des éléments génériques). Rôles et attributs ARIA valides selon axe-core. |
| [8.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.3) | La langue par défaut est-elle présente ? | **C** | &lt;html lang="fr"&gt;. |
| [8.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.4) | Le code de langue par défaut est-il valide et pertinent ? | **C** | fr : interface en français. |
| [8.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.5) | Chaque page web a-t-elle un titre de page ? | **C** | <title> présent (voir 8.6). |
| [8.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.6) | Le titre de page est-il pertinent ? | **C** | Titre « <dépôt> — Merathon » avec le dépôt de l'onglet actif, « Merathon — Git Repository Manager » sans dépôt (corrigé : il était fixe). |
| [8.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.7) | Chaque changement de langue est-il indiqué dans le code source ? | **C** | Termes de Git (Pull, Push, Fetch, Stash, commit, merge, rebase…) : jargon du domaine passé dans l'usage ; messages de commit, noms de branches et contenus des forges : contenus des utilisateurs dont la langue ne peut être déterminée (cas particuliers du critère). |
| [8.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.8) | Le code de langue de chaque changement de langue est-il valide et pertinent ? | **NA** | Aucun changement de langue indiqué (voir 8.7). |
| [8.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.9) | Les balises ne doivent pas être utilisées uniquement à des fins de présentation. Est-ce respecté ? | **C** | Pas de balise utilisée à des fins de présentation : intertitres des PR et du mémo passés en titres (h3, h5), listes en ul / ol ou role=list. |
| [8.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.10) | Les changements du sens de lecture sont-ils signalés ? | **NA** | Aucun texte de droite à gauche. |

## 9. Structuration de l'information

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [9.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.1) | L'information est-elle structurée par l'utilisation appropriée de titres ? | **C** | h1 (sans être affiché : « Merathon — <dépôt> »), h2 pour les sections des panneaux et les titres des fenêtres, h3 à h5 dans les préférences, le mémo et le détail d'une PR (Relecteurs, Assignés, CI, Description, Conversation). Hiérarchie vérifiée dans chaque vue. |
| [9.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.2) | La structure du document est-elle cohérente ? | **C** | header (barre d'outils), nav (onglets), deux aside nommés (« Dépôt : branches, tags et stashes » ou « Comptes » ; « Modifications en cours », « Détail du commit » ou « Comparaison »), main ; le titre de niveau 1 est dans l'en-tête. |
| [9.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.3) | Chaque liste est-elle correctement structurée ? | **C** | Barre latérale en ul / li, mémo en ol, commits du rebase et checks en listes, déclaration en ul. |
| [9.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.4) | Chaque citation est-elle correctement indiquée ? | **NA** | Aucune citation : descriptions et commentaires des PR / MR sont affichés en texte brut, sans interprétation du Markdown. |

## 10. Présentation de l'information

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [10.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.1) | Des feuilles de styles sont-elles utilisées pour contrôler la présentation ? | **C** | Mise en forme par CSS (Tailwind). |
| [10.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.2) | Le contenu visible porteur d'information reste-t-il présent lorsque les feuilles de styles sont désactivées ? | **C** | Feuilles de style désactivées : tout le texte reste présent, symboles compris, et les textes réservés aux lecteurs d'écran deviennent visibles. |
| [10.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.3) | L'information reste-t-elle compréhensible lorsque les feuilles de styles sont désactivées ? | **C** | Sans styles, l'ordre du contenu suit celui de l'interface (barre d'outils, onglets, panneau de gauche, graphe, panneau de droite) et reste compréhensible. |
| [10.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.4) | Le texte reste-t-il lisible lorsque la taille des caractères est augmentée jusqu'à 200 % au moins ? | **C** | Zoom intégré jusqu'à 200 % (Ctrl+=) testé à 640 × 400 px : la barre d'outils passe à la ligne, les panneaux s'empilent sous 760 px de large (corrigé : le graphe disparaissait et la barre d'outils était coupée). |
| [10.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.5) | Les déclarations CSS de couleurs de fond et de police sont-elles correctement utilisées ? | **C** | Couleurs de fond et de texte déclarées ensemble par le thème (variables CSS) sur la page et les surfaces. |
| [10.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.6) | Chaque lien dont la nature n'est pas évidente est-il visible par rapport au texte environnant ? | **C** | Liens des issues : blocs distincts ; liens de la déclaration soulignés. |
| [10.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.7) | Pour chaque élément recevant le focus, la prise de focus est-elle visible ? | **C** | Tabulation automatisée de chaque vue (Chromium et WebKit) : chaque élément a un indicateur de focus (contour ou anneau). Corrigé : contour d'accent sur les champs, focus des lignes de fichiers, de PR, du diff et des poignées. |
| [10.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.8) | Les contenus cachés ont-ils vocation à être ignorés par les technologies d'assistance ? | **C** | Contenus cachés : textes réservés aux lecteurs d'écran (sr-only) voulus ; infobulles masquées aux lecteurs d'écran car redondantes avec le nom des boutons ; boutons au survol rendus visibles au focus. |
| [10.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.9) | L'information ne doit pas être donnée uniquement par la forme, la taille ou la position. Est-ce respecté ? | **C** | Aucune information donnée par la forme, la taille ou la position seules : formes d'icônes doublées d'un texte, ordre du rebase indiqué en toutes lettres (« du plus ancien au plus récent »). |
| [10.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.10) | L'information ne doit pas être donnée par la forme, la taille ou la position uniquement : est-ce implémenté de façon pertinente ? | **C** | Voir 10.9 : alternatives textuelles restituées. |
| [10.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.11) | Les contenus peuvent-ils être présentés sans perte d'information ni défilement dans deux dimensions (320 px de large) ? | **C** | Fenêtre de 320 × 256 px : panneaux empilés, défilement vertical seulement, aucun défilement horizontal (corrigé). Auteur, hash et date du commit sont lus et affichés dans le détail du commit. Cas particuliers : lignes de code du diff et graphe (présentation en deux dimensions). |
| [10.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.12) | Les propriétés d'espacement du texte peuvent-elles être redéfinies sans perte de contenu ? | **C** | Espacement du texte WCAG (interligne 1,5, paragraphes 2 em, lettres 0,12 em, mots 0,16 em) : aucun texte coupé ni chevauchant ; les textes tronqués par des points de suspension gardent leur infobulle. |
| [10.13](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.13) | Les contenus additionnels apparaissant à la prise de focus ou au survol sont-ils contrôlables par l'utilisateur ? | **C** | Infobulles masquées par Échap et survolables ; infobulle du graphe (auteur) masquée par Échap. |
| [10.14](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.14) | Les contenus additionnels apparaissant via CSS uniquement peuvent-ils être rendus visibles au clavier et au pointeur ? | **C** | Boutons masqués jusqu'au survol (fermer un onglet, ajouter un remote, initialiser les sous-modules, options d'un compte, retirer un dépôt récent, actions des fichiers et dossiers, commenter une ligne) : visibles au focus (corrigé). |

## 11. Formulaires

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [11.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.1) | Chaque champ de formulaire a-t-il une étiquette ? | **C** | Tous les champs ont une étiquette : élément label, ou aria-label doublé d'un title pour ceux qui n'ont qu'un texte d'exemple (test 11.1.3). Vérifié dans le code et dans le navigateur. |
| [11.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2) | Chaque étiquette associée à un champ est-elle pertinente ? | **C** | Étiquettes pertinentes (« Résumé du commit », « Relecteurs : ajouter », « Action pour le commit <hash> »…). |
| [11.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.3) | Les étiquettes des champs ayant la même fonction sont-elles cohérentes ? | **C** | Champs de même fonction étiquetés de la même façon (recherche, ajout de relecteurs / assignés / labels). |
| [11.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.4) | Chaque étiquette de champ et son champ associé sont-ils accolés ? | **C** | Étiquettes visibles accolées à leur champ (au-dessus ou à droite des cases à cocher). |
| [11.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.5) | Les champs de même nature sont-ils regroupés, si nécessaire ? | **C** | Types de notifications regroupés (role=group). |
| [11.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.6) | Chaque regroupement de champs de même nature a-t-il une légende ? | **C** | Groupe nommé « Notifier pour ». |
| [11.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.7) | Chaque légende associée à un regroupement est-elle pertinente ? | **C** | Nom du groupe pertinent. |
| [11.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.8) | Les items de même nature d'une liste de choix sont-ils regroupés de manière pertinente ? | **C** | Listes de choix courtes (état des PR, mode de merge, jalon, action du rebase) : pas de regroupement nécessaire. |
| [11.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.9) | L'intitulé de chaque bouton est-il pertinent ? | **C** | Intitulés pertinents, contexte compris (« Indexer src/index.html », « Fermer l'onglet site-vitrine », « Monter 01a1b2c », « Fermer la PR »…). Corrigé : boutons nommés par un symbole (+, −, ↺, ✕, ⋯, ⧉) ou ambigus. |
| [11.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.10) | Le contrôle de saisie est-il utilisé de manière pertinente ? | **C** | Champs obligatoires déclarés (required) dans la création de branche, le stash nommé, le clonage ; bouton de validation inactif tant qu'ils sont vides ; erreurs signalées par une zone d'alerte qui reste affichée. |
| [11.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.11) | Le contrôle de saisie est-il accompagné, si nécessaire, de suggestions facilitant la correction ? | **C** | Les erreurs de git (nom de branche invalide, URL de clonage…) sont affichées en clair dans une zone d'alerte ; les relecteurs, assignés et labels sont choisis dans une liste de suggestions. |
| [11.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.12) | Pour chaque formulaire qui modifie ou supprime des données, les données saisies peuvent-elles être modifiées, mises à jour ou récupérées ? | **C** | Confirmation avant chaque suppression ou perte de données : branches (locale, distante, sélection), tags, remotes, stashes, comptes, modifications annulées, reset (hard signalé), push forcé, abandon d'un merge ou d'un rebase. |
| [11.13](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.13) | La finalité d'un champ de saisie peut-elle être déduite pour faciliter le remplissage automatique ? | **C** | Seuls champs de données personnelles : nom et e-mail de l'identité Git, avec autocomplete="name" et "email". |

## 12. Navigation

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [12.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.1) | Chaque ensemble de pages dispose-t-il de deux systèmes de navigation différents, au moins ? | **NA** | Application à vue unique, sans ensemble de pages. |
| [12.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.2) | Le menu et les barres de navigation sont-ils toujours à la même place ? | **NA** | Application à vue unique. |
| [12.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.3) | La page « plan du site » est-elle pertinente ? | **NA** | Application à vue unique. |
| [12.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.4) | La page « plan du site » est-elle atteignable de manière identique ? | **NA** | Application à vue unique. |
| [12.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.5) | Le moteur de recherche est-il atteignable de manière identique ? | **NA** | Application à vue unique. |
| [12.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.6) | Les zones de regroupement de contenus peuvent-elles être atteintes ou évitées ? | **C** | Zones atteignables par leurs repères (header, nav, aside nommés, main) et par les titres ; vérifié dans l'arbre d'accessibilité. |
| [12.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.7) | Un lien d'évitement ou d'accès rapide à la zone de contenu principal est-il présent ? | **C** | Lien d'évitement « Aller au contenu principal », premier arrêt de tabulation, visible au focus, qui place le focus dans le graphe (ajouté). |
| [12.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.8) | L'ordre de tabulation est-il cohérent ? | **C** | Ordre de tabulation vérifié dans chaque vue : barre d'outils, onglets, panneau de gauche, graphe, panneau du bas, panneau de droite ; dans les fenêtres, de haut en bas. |
| [12.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.9) | La navigation ne doit pas contenir de piège au clavier. Est-ce respecté ? | **C** | Aucun piège : Ctrl+Maj+J sort du terminal intégré ; les fenêtres modales gardent le focus et se ferment par Échap ; les menus se ferment par Échap ou Tab. |
| [12.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.10) | Les raccourcis clavier n'utilisant qu'une seule touche sont-ils contrôlables par l'utilisateur ? | **C** | Aucun raccourci à touche caractère unique : raccourcis avec Ctrl ; flèches, Origine / Fin et Page préc. / suiv. seulement dans le composant qui a le focus. |
| [12.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.11) | Les contenus additionnels apparaissant au survol, au focus ou à l'activation sont-ils atteignables au clavier ? | **C** | Menus, suggestions et infobulles atteignables au clavier (Maj+F10, flèches, focus). |

## 13. Consultation

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [13.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.1) | L'utilisateur a-t-il le contrôle de chaque limite de temps modifiant le contenu ? | **C** | Les erreurs restent affichées jusqu'à leur fermeture ; les autres notifications (5 s) restent tant que la souris ou le focus est dessus, et les opérations restent dans le journal (corrigé). |
| [13.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.2) | L'ouverture d'une nouvelle fenêtre ne doit pas être déclenchée sans action de l'utilisateur. Est-ce respecté ? | **C** | Le navigateur ne s'ouvre que sur une action de l'utilisateur (bouton, ou case « Ouvrir dans le navigateur après la création » cochée). |
| [13.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.3) | Chaque document bureautique en téléchargement possède-t-il, si nécessaire, une version accessible ? | **NA** | Aucun document bureautique. |
| [13.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.4) | La version accessible d'un document bureautique offre-t-elle la même information ? | **NA** | Aucun document bureautique. |
| [13.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.5) | Chaque contenu cryptique a-t-il une alternative ? | **C** | Symboles masqués et remplacés par du texte (voir 1.2) ; compteurs (↑1, pastilles) dits en toutes lettres ; hashes de commit présentés comme tels (« Commit 01a1b2c », « Parent : … »). |
| [13.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.6) | Pour chaque contenu cryptique ayant une alternative, celle-ci est-elle pertinente ? | **C** | Alternatives pertinentes : « 1 en avance », « 1 commit à envoyer », « uniquement en local », « branche distante origin/main »… |
| [13.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.7) | Les changements brusques de luminosité ou les effets de flash sont-ils correctement utilisés ? | **C** | Scintillement des feux d'artifice ramené sous 3 Hz ; petites surfaces. |
| [13.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.8) | Chaque contenu en mouvement ou clignotant est-il contrôlable par l'utilisateur ? | **C** | Célébrations : Échap ou clic pour arrêter, 7,5 s au plus, mouvement supprimé si le système demande de réduire les animations. |
| [13.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.9) | Le contenu est-il consultable quelle que soit l'orientation de l'écran ? | **NA** | Application de bureau. |
| [13.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.10) | Les fonctionnalités utilisables par un geste complexe le sont-elles aussi par un geste simple ? | **C** | Glisser-déposer du rebase : boutons Monter / Descendre ; redimensionnement des panneaux : simple glisser, aussi possible aux flèches du clavier. |
| [13.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.11) | Les actions déclenchées par un dispositif de pointage sur un point unique peuvent-elles être annulées ? | **C** | Actions déclenchées au relâchement (clic) ; corrigé : choix d'une suggestion et fermeture d'une fenêtre par le fond, qui se faisaient à l'appui. |
| [13.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.12) | Les fonctionnalités qui impliquent un mouvement de l'appareil peuvent-elles être accomplies autrement ? | **NA** | Aucune fonctionnalité liée au mouvement de l'appareil. |

