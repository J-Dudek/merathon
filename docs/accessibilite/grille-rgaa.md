# Grille d'audit RGAA 4.1.2 — Merathon

Grille **pré-remplie** pour préparer l'audit de conformité de Merathon au [RGAA 4.1.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/). Elle ne remplace pas l'audit : les statuts « Conforme » ne valent que pour ce qui a été vérifié lors de l'évaluation du 15 octobre 2026, et chaque critère doit être confirmé par l'auditeur.

La même grille, au format tableur, est dans [`grille-rgaa.csv`](grille-rgaa.csv) : colonnes « Statut auditeur » et « Commentaire auditeur » à remplir. Les tests avec un lecteur d'écran suivent le [protocole Orca](protocole-orca.md).

## Synthèse

| Statut | Critères |
|---|---|
| Conforme (C) | 13 |
| Non conforme (NC) | 0 |
| Non applicable (NA) | 32 |
| Non testé (NT) | 61 |
| **Total** | **106** |

Taux de conformité au sens du RGAA (critères conformes ÷ critères applicables) : **non calculable** tant que des critères restent non testés.

## Légende et méthode

- **C** : conforme, vérifié (outil, code ou test manuel indiqué dans la colonne « Constat »).
- **NC** : non conforme, constaté dans le code ou en test.
- **NA** : non applicable à une application de bureau, ou aucun contenu concerné.
- **NT** : non testé ; la colonne « Constat » donne les éléments déjà connus et les pistes de vérification.
- Échantillon : les 23 vues listées dans la rubrique Accessibilité des préférences, en thème sombre et en thème clair.
- Intitulés résumés : le texte officiel de chaque critère, ses tests et ses cas particuliers sont accessibles par le lien du numéro.

## 1. Images

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [1.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.1) | Chaque image porteuse d'information a-t-elle une alternative textuelle ? | **NT** | Logos en alt="" à côté du nom de l'application ; icônes Lucide et emojis à passer en revue ; le graphe (canvas) est masqué aux technologies d'assistance : vérifier que la topologie (branches, fusions) est disponible autrement (parents dans le détail du commit, étiquettes de branches). |
| [1.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.2) | Chaque image de décoration est-elle correctement ignorée par les technologies d'assistance ? | **NT** | Canvas du graphe, emojis des célébrations et de « Mon activité » masqués (aria-hidden) ; reste à vérifier les icônes des boutons et des menus. |
| [1.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.3) | Pour chaque image porteuse d'information ayant une alternative textuelle, cette alternative est-elle pertinente ? | **NT** |  |
| [1.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.4) | Image CAPTCHA ou image-test : l'alternative permet-elle d'en identifier la nature et la fonction ? | **NA** | Aucun CAPTCHA ni image-test. |
| [1.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.5) | Image CAPTCHA : une solution d'accès alternatif est-elle présente ? | **NA** | Aucun CAPTCHA. |
| [1.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.6) | Chaque image porteuse d'information a-t-elle, si nécessaire, une description détaillée ? | **NT** | Graphe des commits : décider si la topologie nécessite une description détaillée. |
| [1.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.7) | Chaque description détaillée est-elle pertinente ? | **NT** |  |
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
| [3.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.1) | L'information n'est-elle pas donnée uniquement par la couleur ? | **NT** | États des fichiers : lettre (M, A, D…) en plus de la couleur ; diffs : préfixe + / − en plus de la couleur ; à vérifier sur les badges de CI, de relecture et les branches masquées (opacité). |
| [3.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.2) | Le contraste entre le texte et son arrière-plan est-il suffisamment élevé ? | **C** | Lighthouse : 46 vues sur 46 sans défaut de contraste ; calculs manuels sur fonds semi-transparents et animations (4,5:1 au moins, thèmes sombre et clair). |
| [3.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#3.3) | Les couleurs des composants d'interface et des éléments graphiques porteurs d'information sont-elles suffisamment contrastées ? | **NT** | Barres de progression 3,1 à 3,9:1 ; bordures des badges et du cadenas 1,5 à 2,6:1 jugées non porteuses d'information ; à confirmer pour les anneaux de focus, cases à cocher et voies du graphe. |

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
| [5.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.4) | Pour chaque tableau de données ayant un titre, le titre est-il correctement associé au tableau ? | **NT** | Le tableau du diff n'a pas de titre associé (le nom du fichier est affiché au-dessus). |
| [5.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.5) | Pour chaque tableau de données ayant un titre, celui-ci est-il pertinent ? | **NT** |  |
| [5.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.6) | Pour chaque tableau de données, chaque en-tête de colonne et de ligne est-il correctement déclaré ? | **C** | Seul tableau de données : le diff. En-têtes de colonnes déclarés (th) et masqués visuellement : Sélection, Commentaire (revue de PR), Ancienne ligne, Nouvelle ligne, Contenu. |
| [5.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.7) | Pour chaque tableau de données, la technique appropriée associe-t-elle chaque cellule à ses en-têtes ? | **C** | Tableau simple : en-têtes en scope="col". |
| [5.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#5.8) | Chaque tableau de mise en forme ne doit pas utiliser d'éléments propres aux tableaux de données. Est-ce respecté ? | **NA** |  |

## 6. Liens

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [6.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#6.1) | Chaque lien est-il explicite ? | **NT** | Liens de la déclaration d'accessibilité : l'adresse est affichée en entier ; liens des PR / MR et de « À propos » à vérifier. |
| [6.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#6.2) | Chaque lien a-t-il un intitulé ? | **NT** |  |

## 7. Scripts

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [7.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.1) | Chaque script est-il, si nécessaire, compatible avec les technologies d'assistance ? | **NT** | Vérifié dans le navigateur : graphe (liste à descendant actif), menus contextuels, barre latérale, célébrations, « Mon activité », fenêtres déclarées comme boîtes de dialogue (role=dialog, aria-modal, titre associé). À confirmer avec Orca dans l'application (voir le protocole). |
| [7.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.2) | Pour chaque script ayant une alternative, cette alternative est-elle pertinente ? | **NT** | Glisser-déposer du rebase interactif : alternative par les boutons Monter / Descendre. |
| [7.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.3) | Chaque script est-il contrôlable par le clavier et par tout dispositif de pointage ? | **NT** | Graphe, barre latérale, menus contextuels, onglets, préférences vérifiés au clavier ; reste notamment le redimensionnement des panneaux, la résolution de conflits et les écrans de PR / MR. La sélection de lignes du diff (indexation partielle) se fait à la souris ; alternative au clavier : boutons Indexer / Annuler le bloc. |
| [7.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.4) | Pour chaque script qui initie un changement de contexte, l'utilisateur est-il averti ou en a-t-il le contrôle ? | **NT** |  |
| [7.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#7.5) | Les messages de statut sont-ils correctement restitués par les technologies d'assistance ? | **NT** | Notifications (role alert / status) et célébrations (zone de statut permanente) en place ; indicateur d'opération en cours (« Push… ») à vérifier. |

## 8. Éléments obligatoires

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [8.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.1) | Chaque page web est-elle définie par un type de document ? | **C** | &lt;!doctype html&gt; dans index.html. |
| [8.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.2) | Le code source généré est-il valide selon le type de document ? | **NT** | À contrôler avec un validateur sur le DOM généré. |
| [8.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.3) | La langue par défaut est-elle présente ? | **C** | &lt;html lang="fr"&gt;. |
| [8.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.4) | Le code de langue par défaut est-il valide et pertinent ? | **C** | fr : interface en français. |
| [8.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.5) | Chaque page web a-t-elle un titre de page ? | **C** | &lt;title&gt;Merathon — Git Repository Manager&lt;/title&gt;. |
| [8.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.6) | Le titre de page est-il pertinent ? | **NT** | Titre fixe : envisager d'y ajouter le dépôt ouvert. |
| [8.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.7) | Chaque changement de langue est-il indiqué dans le code source ? | **NT** | Termes anglais de Git (Pull, Push, Fetch, Stash, commit…) : décider s'ils relèvent de l'usage courant. |
| [8.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.8) | Le code de langue de chaque changement de langue est-il valide et pertinent ? | **NT** |  |
| [8.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.9) | Les balises ne doivent pas être utilisées uniquement à des fins de présentation. Est-ce respecté ? | **NT** |  |
| [8.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.10) | Les changements du sens de lecture sont-ils signalés ? | **NA** | Aucun texte de droite à gauche. |

## 9. Structuration de l'information

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [9.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.1) | L'information est-elle structurée par l'utilisation appropriée de titres ? | **NT** | Corrigé : titre de niveau 1 invisible « Merathon », niveau 2 pour les sections des panneaux (barre latérale, indexation, détail du commit, comptes) et les titres des fenêtres, niveaux 3 à 5 dans les préférences et le mémo. Pertinence de la hiérarchie à confirmer. |
| [9.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.2) | La structure du document est-elle cohérente ? | **NT** | Zones header (barre d'outils), nav (onglets), aside (barre latérale), main présentes ; à vérifier dans leur ensemble. |
| [9.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.3) | Chaque liste est-elle correctement structurée ? | **NT** | Barre latérale en ul / li ; autres listes à vérifier. |
| [9.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#9.4) | Chaque citation est-elle correctement indiquée ? | **NT** | Descriptions et commentaires de PR / MR en Markdown : vérifier le rendu des citations. |

## 10. Présentation de l'information

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [10.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.1) | Des feuilles de styles sont-elles utilisées pour contrôler la présentation ? | **C** | Mise en forme par CSS (Tailwind). |
| [10.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.2) | Le contenu visible porteur d'information reste-t-il présent lorsque les feuilles de styles sont désactivées ? | **NT** |  |
| [10.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.3) | L'information reste-t-elle compréhensible lorsque les feuilles de styles sont désactivées ? | **NT** |  |
| [10.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.4) | Le texte reste-t-il lisible lorsque la taille des caractères est augmentée jusqu'à 200 % au moins ? | **NT** | Zoom intégré jusqu'à 200 % (Ctrl+=) : vérifier l'absence de perte de contenu. |
| [10.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.5) | Les déclarations CSS de couleurs de fond et de police sont-elles correctement utilisées ? | **NT** |  |
| [10.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.6) | Chaque lien dont la nature n'est pas évidente est-il visible par rapport au texte environnant ? | **NT** | Liens de la déclaration soulignés. |
| [10.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.7) | Pour chaque élément recevant le focus, la prise de focus est-elle visible ? | **NT** | Anneau de focus ajouté au graphe, à la barre latérale, aux badges et aux menus ; à vérifier sur tous les autres éléments. |
| [10.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.8) | Les contenus cachés ont-ils vocation à être ignorés par les technologies d'assistance ? | **NT** |  |
| [10.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.9) | L'information ne doit pas être donnée uniquement par la forme, la taille ou la position. Est-ce respecté ? | **NT** |  |
| [10.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.10) | L'information ne doit pas être donnée par la forme, la taille ou la position uniquement : est-ce implémenté de façon pertinente ? | **NT** |  |
| [10.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.11) | Les contenus peuvent-ils être présentés sans perte d'information ni défilement dans deux dimensions (320 px de large) ? | **NT** | Application de bureau : vérifier la taille minimale de la fenêtre et le comportement au zoom 200 % / 400 %. |
| [10.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.12) | Les propriétés d'espacement du texte peuvent-elles être redéfinies sans perte de contenu ? | **NT** |  |
| [10.13](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.13) | Les contenus additionnels apparaissant à la prise de focus ou au survol sont-ils contrôlables par l'utilisateur ? | **NT** | Corrigé : les infobulles se masquent avec Échap et peuvent être survolées sans disparaître. À confirmer : l'infobulle du graphe, qui suit la souris (Échap la masque). Les infobulles natives (title) ne sont pas concernées. |
| [10.14](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.14) | Les contenus additionnels apparaissant via CSS uniquement peuvent-ils être rendus visibles au clavier et au pointeur ? | **NT** | Boutons masqués jusqu'au survol (fermeture d'onglet, ajout de remote) : vérifier leur affichage au focus. |

## 11. Formulaires

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [11.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.1) | Chaque champ de formulaire a-t-il une étiquette ? | **C** | Tous les champs ont une étiquette : élément label, ou aria-label doublé d'un title pour ceux qui n'ont qu'un texte d'exemple (test 11.1.3). Vérifié dans le code et dans le navigateur. |
| [11.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2) | Chaque étiquette associée à un champ est-elle pertinente ? | **NT** | Après correction du 11.1. |
| [11.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.3) | Les étiquettes des champs ayant la même fonction sont-elles cohérentes ? | **NT** |  |
| [11.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.4) | Chaque étiquette de champ et son champ associé sont-ils accolés ? | **NT** |  |
| [11.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.5) | Les champs de même nature sont-ils regroupés, si nécessaire ? | **NT** | Préférences : groupes de notifications. |
| [11.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.6) | Chaque regroupement de champs de même nature a-t-il une légende ? | **NT** |  |
| [11.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.7) | Chaque légende associée à un regroupement est-elle pertinente ? | **NT** |  |
| [11.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.8) | Les items de même nature d'une liste de choix sont-ils regroupés de manière pertinente ? | **NT** |  |
| [11.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.9) | L'intitulé de chaque bouton est-il pertinent ? | **NT** | Boutons à icône seule nommés (Options Pull, Fermer l'onglet, Effacer la recherche…) ; à vérifier partout. |
| [11.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.10) | Le contrôle de saisie est-il utilisé de manière pertinente ? | **NT** |  |
| [11.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.11) | Le contrôle de saisie est-il accompagné, si nécessaire, de suggestions facilitant la correction ? | **NT** |  |
| [11.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.12) | Pour chaque formulaire qui modifie ou supprime des données, les données saisies peuvent-elles être modifiées, mises à jour ou récupérées ? | **NT** | Confirmations avant suppression de branche, reset hard, force push : à vérifier de façon systématique. |
| [11.13](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.13) | La finalité d'un champ de saisie peut-elle être déduite pour faciliter le remplissage automatique ? | **C** | Seuls champs de données personnelles : nom et e-mail de l'identité Git, avec autocomplete="name" et "email". |

## 12. Navigation

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [12.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.1) | Chaque ensemble de pages dispose-t-il de deux systèmes de navigation différents, au moins ? | **NA** | Application à vue unique, sans ensemble de pages. |
| [12.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.2) | Le menu et les barres de navigation sont-ils toujours à la même place ? | **NA** | Application à vue unique. |
| [12.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.3) | La page « plan du site » est-elle pertinente ? | **NA** | Application à vue unique. |
| [12.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.4) | La page « plan du site » est-elle atteignable de manière identique ? | **NA** | Application à vue unique. |
| [12.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.5) | Le moteur de recherche est-il atteignable de manière identique ? | **NA** | Application à vue unique. |
| [12.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.6) | Les zones de regroupement de contenus peuvent-elles être atteintes ou évitées ? | **NT** | Zones balisées (header, nav, aside, main) ; à vérifier avec la navigation par repères d'Orca. |
| [12.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.7) | Un lien d'évitement ou d'accès rapide à la zone de contenu principal est-il présent ? | **NT** |  |
| [12.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.8) | L'ordre de tabulation est-il cohérent ? | **NT** | Vérifié dans les préférences et « Mon activité ». |
| [12.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.9) | La navigation ne doit pas contenir de piège au clavier. Est-ce respecté ? | **NT** | Corrigé : Ctrl+Maj+J sort du terminal intégré (annoncé dans son nom, documenté dans les raccourcis). Aucun autre piège constaté dans les parcours testés ; à confirmer sur l'ensemble. |
| [12.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.10) | Les raccourcis clavier n'utilisant qu'une seule touche sont-ils contrôlables par l'utilisateur ? | **NT** | Aucun raccourci à touche caractère unique relevé. |
| [12.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#12.11) | Les contenus additionnels apparaissant au survol, au focus ou à l'activation sont-ils atteignables au clavier ? | **NT** | Infobulles affichées aussi au focus clavier ; infobulle du graphe (auteur au survol d'un point) : l'auteur figure aussi dans la ligne du commit. |

## 13. Consultation

| Critère | Intitulé (résumé) | Statut | Constat et pistes |
|---|---|---|---|
| [13.1](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.1) | L'utilisateur a-t-il le contrôle de chaque limite de temps modifiant le contenu ? | **NT** | Notifications masquées après 4 s (10 s pour les erreurs) ; les opérations restent consultables dans le journal. |
| [13.2](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.2) | L'ouverture d'une nouvelle fenêtre ne doit pas être déclenchée sans action de l'utilisateur. Est-ce respecté ? | **NT** |  |
| [13.3](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.3) | Chaque document bureautique en téléchargement possède-t-il, si nécessaire, une version accessible ? | **NA** | Aucun document bureautique. |
| [13.4](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.4) | La version accessible d'un document bureautique offre-t-elle la même information ? | **NA** | Aucun document bureautique. |
| [13.5](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.5) | Chaque contenu cryptique a-t-il une alternative ? | **NT** | Symboles ⎇ ☁ ⌂ ⊟, hashes de commit, emojis. |
| [13.6](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.6) | Pour chaque contenu cryptique ayant une alternative, celle-ci est-elle pertinente ? | **NT** |  |
| [13.7](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.7) | Les changements brusques de luminosité ou les effets de flash sont-ils correctement utilisés ? | **C** | Scintillement des feux d'artifice ramené sous 3 Hz ; petites surfaces. |
| [13.8](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.8) | Chaque contenu en mouvement ou clignotant est-il contrôlable par l'utilisateur ? | **C** | Célébrations : Échap ou clic pour arrêter, 7,5 s au plus, mouvement supprimé si le système demande de réduire les animations. |
| [13.9](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.9) | Le contenu est-il consultable quelle que soit l'orientation de l'écran ? | **NA** | Application de bureau. |
| [13.10](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.10) | Les fonctionnalités utilisables par un geste complexe le sont-elles aussi par un geste simple ? | **NT** | Glisser-déposer du rebase : alternative Monter / Descendre ; redimensionnement des panneaux à vérifier. |
| [13.11](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.11) | Les actions déclenchées par un dispositif de pointage sur un point unique peuvent-elles être annulées ? | **NT** |  |
| [13.12](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#13.12) | Les fonctionnalités qui impliquent un mouvement de l'appareil peuvent-elles être accomplies autrement ? | **NA** | Aucune fonctionnalité liée au mouvement de l'appareil. |

