# Protocole de test de Merathon avec le lecteur d'écran Orca

Ce protocole vérifie, dans l'application elle-même (WebKitGTK sous Linux), ce que les outils automatiques ne voient pas : ce qu'un lecteur d'écran annonce et ce qu'on peut faire au clavier seul. Chaque scénario renvoie aux critères de la [grille RGAA](grille-rgaa.md) qu'il permet de trancher.

Durée indicative : 2 h à 3 h. Les résultats se reportent dans le tableau de chaque scénario, puis dans la colonne « Statut auditeur » de [`grille-rgaa.csv`](grille-rgaa.csv).

## 1. Préparation

### Environnement

À noter en tête du compte rendu :

| Élément | Valeur | Commande |
|---|---|---|
| Distribution et bureau | | `cat /etc/os-release`, `echo $XDG_CURRENT_DESKTOP` |
| Version d'Orca | | `orca --version` |
| Version de WebKitGTK | | `dpkg -l 'libwebkit2gtk-4.1*'` (Debian, Ubuntu) |
| Version de Merathon | | Préférences › À propos |
| Thème testé | | Préférences › Apparence |

### Activer l'accessibilité et Orca

1. Activer la prise en charge de l'accessibilité par les applications GTK (nécessaire pour que WebKitGTK expose l'interface à Orca) :
   `gsettings set org.gnome.desktop.interface toolkit-accessibility true`
2. Vérifier que la variable `NO_AT_BRIDGE` n'est pas définie dans l'environnement qui lance Merathon (`env | grep NO_AT_BRIDGE` ne doit rien afficher).
3. Lancer Orca (sous GNOME : Super+Alt+S, ou `orca` dans un terminal), puis lancer Merathon.
4. Repérer la touche Orca : Insert (disposition « ordinateur de bureau ») ou Verr. Maj (disposition « ordinateur portable »), réglable dans les préférences d'Orca (Orca+Espace).
5. Garder sous la main l'[aide d'Orca](https://help.gnome.org/users/orca/stable/) ; Orca+H active le mode apprentissage (les touches sont décrites sans être exécutées).

### Dépôt de test jetable

Les scénarios extraient des branches et créent des commits : ne pas les jouer sur un vrai dépôt.

```bash
rm -rf /tmp/merathon-a11y && mkdir /tmp/merathon-a11y && cd /tmp/merathon-a11y
git init -q -b main
git config user.name "Test Accessibilité" && git config user.email "a11y@example.com"
for i in 1 2 3 4 5; do echo "ligne $i" >> fichier.txt; git add .; git commit -qm "Commit $i"; done
git branch fix/footer HEAD~2 && git branch feat/panier HEAD~1
echo "modification" >> fichier.txt && echo "nouveau" > nouveau.txt
```

Ouvrir `/tmp/merathon-a11y` dans Merathon (Ctrl+O).

### Règles de notation

- **OK** : l'annonce est complète et compréhensible (nom, rôle, état ou valeur), l'action fonctionne au clavier seul.
- **Partiel** : l'action fonctionne, mais l'annonce est incomplète ou ambiguë.
- **KO** : action impossible au clavier, piège, ou information absente de l'annonce.
- Noter **l'annonce entendue mot pour mot** : c'est elle qui permet de corriger.
- Ne pas utiliser la souris, sauf indication contraire.

## 2. Scénarios

### S1. Lancement et titre de la fenêtre — critères 8.5, 8.6

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Donner le focus à la fenêtre (Alt+Tab) | Le titre de la fenêtre est annoncé (« Merathon… ») | | |
| Commande « Où suis-je ? » d'Orca (Entrée du pavé numérique ; Orca+Entrée en disposition portable) | Titre de la fenêtre et élément actif annoncés | | |

### S2. Accueil — critères 7.1, 11.9

Fermer tous les onglets (Ctrl+W) pour afficher l'accueil.

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab jusqu'aux boutons Ouvrir, Cloner, Initialiser | Chaque bouton annoncé avec son nom et son rôle | | |
| Entrée sur « Cloner » | La boîte de clonage s'ouvre, son titre est annoncé, le focus est dedans | | |
| Échap | La boîte se ferme, le focus revient sur « Cloner » | | |

### S3. Onglets des dépôts — critères 7.1, 12.8

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab jusqu'aux onglets | Zone « Dépôts ouverts » annoncée ; l'onglet courant est annoncé comme page actuelle | | |
| Entrée sur un autre onglet | L'onglet s'active | | |
| Ctrl+T puis Ctrl+W | Nouvel onglet créé puis fermé, le focus reste dans l'application | | |

### S4. Barre latérale (branches) — critères 7.1, 7.3, 9.1, 12.8

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab jusqu'à la section « Local » | Titre de section annoncé comme titre (connu non conforme : 9.1) | | |
| Tab jusqu'à `fix/footer` | « fix/footer, bouton », indication « local » ou avance / retard | | |
| Espace | La branche est sélectionnée ; le graphe affiche son commit | | |
| Maj+F10 (ou touche Menu) | Menu annoncé, premier choix « Checkout fix/footer » lu | | |
| Flèche bas, Fin, Origine | Chaque choix lu ; les choix désactivés annoncés comme indisponibles | | |
| Échap | Menu fermé, focus rendu à `fix/footer` | | |
| Entrée | Extraction de `fix/footer` ; un message de réussite est annoncé (7.5) | | |
| Revenir sur `main` (Entrée) | Extraction de `main` | | |

### S5. Graphe des commits — critères 7.1, 7.3, 1.1, 1.6

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab jusqu'au graphe | « Historique des commits, liste » | | |
| Flèche bas | Commit annoncé (message, auteur, hash, date) avec sa position (« 1 sur 5 ») | | |
| Flèche bas, Fin, Origine, Page suiv. | Chaque commit annoncé ; le détail à droite suit | | |
| Maj+F10 | Menu du commit (« Checkout ce commit… ») ; Échap rend le focus au graphe | | |
| Sur un commit de fusion | L'information « fusion » ou ses parents est-elle accessible ? (topologie : 1.1, 1.6) | | |

### S6. Indexation et commit — critères 11.1, 11.2, 11.9, 7.5

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab jusqu'à « Non indexé » | Titre de section (connu non conforme : 9.1) | | |
| Tab sur `fichier.txt` | Nom du fichier et son état (modifié) | | |
| Tout indexer | Les fichiers passent dans « Indexé » ; changement annoncé (7.5) | | |
| Tab jusqu'au champ de résumé | Étiquette du champ annoncée (connu non conforme : 11.1, seul un texte d'exemple existe) | | |
| Saisir « Commit de test » puis Tab jusqu'au bouton Commiter, Entrée | Commit créé, message de réussite annoncé | | |

### S7. Diff — critères 5.4, 5.6, 5.7, 3.1

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Ouvrir le diff d'un fichier modifié | Le focus ou la lecture arrive sur le diff | | |
| Mode navigation (Orca+A), touche T (tableau) puis flèches | En-têtes de colonnes annoncés (connu non conforme : 5.6) | | |
| Lignes ajoutées et supprimées | Le préfixe + / − est lu : l'information ne passe pas que par la couleur (3.1) | | |
| Échap | Retour au graphe | | |

### S8. Boîtes de dialogue et confirmations — critères 7.1, 11.12, 12.8, 12.9

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Menu de `feat/panier` › Supprimer | Boîte de confirmation : titre et message lus, focus dans la boîte | | |
| Tab dans la boîte | Le focus reste dans la boîte (pas de sortie vers l'arrière-plan) | | |
| Échap | Annulation, focus rendu à la branche | | |

### S9. Notifications — critère 7.5

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Provoquer une erreur (Push sans remote) | Message d'erreur annoncé automatiquement, sans déplacer le focus | | |
| Provoquer une réussite (Fetch) | Message de réussite annoncé | | |

### S10. Célébration — critères 7.5, 13.7, 13.8

Atteindre un palier : créer une branche (la première déclenche une célébration) ou, en build de développement, utiliser le bouton « 🎉 dev ».

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Déclencher la célébration | Titre, raison et prochain palier annoncés une seule fois | | |
| Échap | Animation arrêtée, focus inchangé | | |

### S11. Préférences — critères 7.1, 11.1, 11.5, 11.6, 12.8

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Ctrl+, | Fenêtre « Préférences » annoncée, focus dedans | | |
| Tab dans le menu des rubriques | Rubriques lues ; « Mon activité, nouvelles récompenses » si nouveautés | | |
| Apparence › réglette de taille | « Taille de l'interface, 100 % » ; flèches : valeur annoncée | | |
| Synchronisation › cases à cocher | Nom et état coché / non coché | | |
| Mon activité › Tab sur les badges | « 10ᵉ commit, obtenu le … » ; barres de progression lues avec leur valeur | | |
| Accessibilité › mode navigation, touche H | Rubriques de la déclaration parcourues titre par titre | | |
| Échap | Fermeture, focus rendu | | |

### S12. Terminal intégré — critères 12.9, 7.1

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Ctrl+J puis onglet Terminal | Le terminal reçoit le focus | | |
| Saisir `echo bonjour` puis Entrée | La sortie « bonjour » est lue | | |
| Tenter de sortir du terminal au clavier (Tab, Maj+Tab, Ctrl+J) | Le focus quitte le terminal (connu non conforme : 12.9, piège au clavier) | | |

### S13. Infobulles — critères 10.13, 12.11

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Tab sur un bouton de la barre d'outils à infobulle (thème) | Infobulle affichée au focus et lue | | |
| Échap | L'infobulle se masque sans déplacer le focus (connu non conforme : 10.13) | | |

### S14. Repères et structure — critères 9.2, 12.6, 12.7

| Étape | Attendu | Résultat | Annonce entendue |
|---|---|---|---|
| Mode navigation, touche M (repère suivant) | Barre d'outils, onglets, barre latérale, zone principale atteignables | | |
| Touche H (titre suivant) | Titres présents et hiérarchisés (connu non conforme : 9.1) | | |

## 3. Après les tests

1. Reporter chaque résultat dans `grille-rgaa.csv` (colonnes « Statut auditeur » et « Commentaire auditeur »), en citant le scénario.
2. Ouvrir un ticket par défaut constaté, avec l'annonce entendue : <https://github.com/J-Dudek/merathon/issues/new/choose>.
3. Mettre à jour `git-client/src/lib/accessibility.ts` (non-conformités, vérifications manuelles, date) : la rubrique Accessibilité des préférences et la déclaration suivent.
4. Rejouer le protocole avec NVDA sous Windows (WebView2) : les annonces diffèrent d'un lecteur d'écran à l'autre.
