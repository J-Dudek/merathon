/** Une opération git du mémo : ce qu'elle fait, un cas d'usage, et comment la faire dans l'application. */
export interface MemoEntry {
  title: string;
  /** Commande git équivalente. */
  command: string;
  summary: string;
  /** Cas d'usage concret. */
  example: string;
  /** Marche à suivre dans l'application. */
  steps: string[];
  /** Mise en garde (perte de données, historique réécrit…). */
  warning?: string;
}

export interface MemoGroup {
  id: string;
  label: string;
  entries: MemoEntry[];
}

export const GIT_MEMO: MemoGroup[] = [
  {
    id: "start",
    label: "Démarrer",
    entries: [
      {
        title: "Créer un dépôt",
        command: "git init",
        summary: "Transforme un dossier en dépôt git : l'historique est stocké dans son sous-dossier .git.",
        example: "Tu as un dossier de scripts jamais versionné et tu veux commencer à suivre ses modifications.",
        steps: ["Ouvre le menu du dépôt (logo en haut à gauche).", "Choisis « Initialiser… » puis sélectionne le dossier."],
      },
      {
        title: "Cloner un dépôt",
        command: "git clone <url>",
        summary: "Télécharge un dépôt distant avec tout son historique et le relie à son remote « origin ».",
        example: "Tu rejoins un projet hébergé sur GitHub ou GitLab et tu veux une copie de travail sur ta machine.",
        steps: [
          "Menu du dépôt → « Cloner… ».",
          "Colle l'URL, ou choisis un dépôt dans la liste d'un compte connecté.",
          "Choisis le dossier parent et le nom du dossier, puis valide.",
        ],
      },
      {
        title: "Ouvrir un dépôt existant",
        command: "cd <dossier>",
        summary: "Un dépôt déjà présent sur le disque s'ouvre tel quel, dans l'onglet courant ou un nouvel onglet.",
        example: "Tu travailles sur deux projets en parallèle et tu veux passer de l'un à l'autre sans les refermer.",
        steps: [
          "Menu du dépôt → « Ouvrir… » (Ctrl+O), ou un dépôt de la liste « Récents ».",
          "Ctrl+T ouvre un nouvel onglet, Ctrl+Maj+N une nouvelle fenêtre.",
        ],
      },
    ],
  },
  {
    id: "changes",
    label: "Modifications",
    entries: [
      {
        title: "Voir l'état de la copie de travail",
        command: "git status",
        summary: "Liste les fichiers modifiés, ajoutés, supprimés ou non suivis, et ceux déjà indexés pour le prochain commit.",
        example: "Avant de commiter, tu vérifies que seuls les fichiers attendus ont changé.",
        steps: [
          "Le panneau de droite affiche en permanence « Non indexé » et « Indexé ».",
          "La lettre devant chaque fichier donne son état : M modifié, A ajouté, D supprimé, R renommé, ? non suivi, ! en conflit.",
          "F5 force un rafraîchissement.",
        ],
      },
      {
        title: "Voir les différences d'un fichier",
        command: "git diff · git diff --staged",
        summary: "Montre ligne par ligne ce qui a changé, par rapport à l'index (non indexé) ou au dernier commit (indexé).",
        example: "Tu ne te souviens plus de ce que tu as touché dans un fichier avant de l'indexer.",
        steps: ["Clique sur le fichier dans le panneau de droite : le diff s'affiche au centre.", "Échap revient au graphe."],
      },
      {
        title: "Indexer des fichiers",
        command: "git add <fichier> · git add -A",
        summary: "Place des modifications dans l'index : seul ce qui est indexé fera partie du prochain commit.",
        example: "Tu as corrigé un bug et retouché la doc : tu indexes d'abord le correctif pour en faire un commit à part.",
        steps: [
          "Survole un fichier de « Non indexé » et clique sur le bouton plus (« Indexer »), ou clic droit → « Indexer ».",
          "« Tout indexer » dans l'en-tête de la section prend tous les fichiers.",
          "Ctrl + clic ou Maj + clic sélectionne plusieurs fichiers ; en arborescence, le « + » d'un dossier indexe tout son contenu.",
        ],
      },
      {
        title: "Indexer une partie d'un fichier",
        command: "git add -p",
        summary: "Indexe seulement certains blocs ou certaines lignes d'un fichier, le reste restant non indexé.",
        example: "Un même fichier contient un correctif et un essai en cours : tu ne veux commiter que le correctif.",
        steps: [
          "Clique sur le fichier pour afficher son diff.",
          "« Indexer le bloc » prend un bloc entier.",
          "Pour quelques lignes, clique sur les lignes voulues (Maj + clic pour une plage) puis « Indexer les lignes ».",
        ],
      },
      {
        title: "Désindexer",
        command: "git restore --staged <fichier>",
        summary: "Retire des modifications de l'index sans les perdre : elles redeviennent « non indexées ».",
        example: "Tu as indexé un fichier de configuration locale par erreur.",
        steps: [
          "Survole le fichier dans « Indexé » et clique sur le bouton moins (« Désindexer »), ou clic droit → « Désindexer ».",
          "« Tout désindexer » vide l'index ; depuis le diff, « Désindexer le bloc » ou « Désindexer les lignes ».",
        ],
      },
      {
        title: "Annuler des modifications",
        command: "git restore <fichier>",
        summary: "Remet un fichier dans l'état de l'index : les modifications non indexées sont abandonnées.",
        example: "Tu as fait des essais dans un fichier et tu veux repartir de la dernière version propre.",
        steps: [
          "Survole le fichier dans « Non indexé » et clique sur la flèche de retour (« Annuler les modifications »), ou clic droit → « Annuler les modifications… ».",
          "Depuis le diff, « Annuler le bloc » n'abandonne qu'une partie du fichier.",
        ],
        warning: "Irréversible : les modifications sont perdues et un fichier non suivi est supprimé du disque.",
      },
      {
        title: "Ignorer des fichiers",
        command: "echo <motif> >> .gitignore",
        summary: "Les fichiers correspondant à un motif du .gitignore n'apparaissent plus comme non suivis.",
        example: "Ton éditeur crée un dossier de cache ou des fichiers .log que tu ne veux jamais commiter.",
        steps: [
          "Clic droit sur un fichier non suivi (« ? ») dans « Non indexé ».",
          "« Ajouter au .gitignore » ignore ce fichier, « Ignorer cette extension » tous ceux du même type, « Ignorer ce dossier » son dossier.",
          "Pense à commiter le .gitignore modifié.",
        ],
        warning: "Sans effet sur un fichier déjà suivi : il faut d'abord le retirer de l'index (git rm --cached, dans le terminal).",
      },
      {
        title: "Commiter",
        command: "git commit -m <message>",
        summary: "Enregistre le contenu de l'index comme un nouveau commit sur la branche courante.",
        example: "Ton correctif est indexé et testé : tu l'enregistres avec un message qui explique pourquoi.",
        steps: [
          "Indexe les fichiers voulus.",
          "Saisis le résumé (et une description si besoin) en bas du panneau de droite.",
          "Clique sur « Commiter », ou Ctrl+Entrée depuis le champ de saisie.",
        ],
      },
      {
        title: "Modifier le dernier commit",
        command: "git commit --amend",
        summary: "Remplace le dernier commit par un nouveau : message corrigé, fichiers ajoutés ou retirés.",
        example: "Tu viens de commiter et tu remarques une faute dans le message, ou un fichier oublié.",
        steps: [
          "Indexe les éventuels fichiers oubliés.",
          "Coche « Modifier le dernier commit (amend) » : le message précédent est repris.",
          "Corrige le message puis valide.",
        ],
        warning: "Réécrit l'historique : si le commit est déjà poussé, il faudra un push forcé.",
      },
    ],
  },
  {
    id: "branches",
    label: "Branches",
    entries: [
      {
        title: "Créer une branche",
        command: "git switch -c <branche>",
        summary: "Crée une nouvelle ligne de développement à partir d'un commit, sans toucher aux autres branches.",
        example: "Tu démarres une fonctionnalité et tu veux l'isoler de main jusqu'à ce qu'elle soit prête.",
        steps: [
          "Bouton « Branche » de la barre d'outils : la branche part du commit courant.",
          "Pour partir d'ailleurs : clic droit sur un commit du graphe → « Créer une branche ici… », ou clic droit sur une branche → « Créer une branche depuis… ».",
          "La case « Basculer sur la nouvelle branche » la rend courante aussitôt.",
        ],
      },
      {
        title: "Changer de branche",
        command: "git switch <branche>",
        summary: "Met la copie de travail dans l'état d'une autre branche, qui devient la branche courante.",
        example: "Tu dois corriger un bug urgent sur main alors que tu travailles sur une fonctionnalité.",
        steps: [
          "Double-clique sur la branche dans « Local » (panneau de gauche), ou clic droit → « Checkout ».",
          "Pour une branche distante : clic droit → « Checkout (branche locale de suivi) ».",
        ],
      },
      {
        title: "Renommer une branche",
        command: "git branch -m <ancien> <nouveau>",
        summary: "Change le nom d'une branche locale sans modifier ses commits.",
        example: "Ta branche s'appelle « test » et tu veux un nom qui décrive le travail avant de la publier.",
        steps: ["Clic droit sur la branche dans « Local » → « Renommer… »."],
      },
      {
        title: "Supprimer une branche",
        command: "git branch -D <branche> · git push origin --delete <branche>",
        summary: "Retire une branche locale ou distante ; les commits déjà fusionnés ailleurs restent dans l'historique.",
        example: "Ta pull request est mergée, la branche de travail ne sert plus.",
        steps: [
          "Locale : clic droit sur la branche → « Supprimer ». Ctrl + clic en sélectionne plusieurs à supprimer d'un coup.",
          "Distante : clic droit sur la branche dans « Distant » → « Supprimer la branche distante ».",
        ],
        warning: "Les commits qui n'existent que sur cette branche ne sont plus accessibles depuis l'interface.",
      },
      {
        title: "Lier une branche à une branche distante",
        command: "git branch --set-upstream-to=origin/<branche>",
        summary: "Définit la branche distante suivie : c'est elle que visent pull et push, et le compteur d'avance / retard.",
        example: "Tu as créé ta branche en local et un collègue l'a déjà publiée sous le même nom.",
        steps: [
          "Clic droit sur la branche locale → « Définir la branche suivie… » puis saisis « origin/branche ».",
          "« Ne plus suivre de branche distante » retire le lien.",
        ],
      },
      {
        title: "Se placer sur un ancien commit",
        command: "git switch --detach <commit>",
        summary: "Met la copie de travail dans l'état d'un commit précis, sans branche (« HEAD détaché »).",
        example: "Tu veux relancer l'application telle qu'elle était la semaine dernière pour reproduire un bug.",
        steps: [
          "Clic droit sur le commit dans le graphe → « Checkout ce commit (HEAD détaché) ».",
          "Pour revenir, double-clique sur une branche de « Local ».",
        ],
        warning: "Des commits créés en HEAD détaché sont perdus de vue dès que tu changes de branche : crée une branche pour les garder.",
      },
    ],
  },
  {
    id: "sync",
    label: "Synchroniser",
    entries: [
      {
        title: "Ajouter un remote",
        command: "git remote add <nom> <url>",
        summary: "Déclare un dépôt distant avec lequel échanger des commits.",
        example: "Tu as créé ton dépôt en local et tu veux maintenant le publier sur GitHub.",
        steps: [
          "Dans le panneau de gauche, clique sur le « + » de la section « Distant ».",
          "Saisis le nom (« origin » en général) puis l'URL.",
          "Clic droit sur un remote → « Supprimer le remote » pour le retirer.",
        ],
      },
      {
        title: "Récupérer les nouveautés sans les intégrer",
        command: "git fetch",
        summary: "Télécharge les commits et branches du remote sans modifier ta branche ni tes fichiers.",
        example: "Tu veux voir ce que l'équipe a poussé avant de décider de l'intégrer.",
        steps: [
          "Bouton « Fetch » de la barre d'outils.",
          "Clic droit sur un remote dans « Distant » → « Fetch <remote> » pour n'en interroger qu'un.",
          "Les compteurs à côté des branches indiquent ensuite l'avance et le retard.",
        ],
      },
      {
        title: "Intégrer les nouveautés du remote",
        command: "git pull · git pull --rebase",
        summary: "Récupère les commits distants et les intègre à la branche courante, par merge ou par rebase.",
        example: "Un collègue a poussé sur la même branche que toi : tu te mets à jour avant de continuer.",
        steps: [
          "Bouton « Pull » : avance rapide si possible, sinon merge.",
          "La petite flèche à côté (« Options Pull ») propose « Pull (rebase) », qui rejoue tes commits par-dessus ceux du remote et garde un historique linéaire.",
          "Clic droit sur une autre branche locale → « Pull » la met à jour sans y basculer.",
        ],
      },
      {
        title: "Publier ses commits",
        command: "git push · git push -u origin <branche>",
        summary: "Envoie les commits de la branche courante vers le remote ; au premier push, la branche y est créée.",
        example: "Ta fonctionnalité est commitée en local et tu veux ouvrir une pull request.",
        steps: ["Bouton « Push » de la barre d'outils : le badge indique le nombre de commits à envoyer."],
      },
      {
        title: "Forcer un push",
        command: "git push --force",
        summary: "Remplace la branche distante par ta version locale, même si leurs historiques ont divergé.",
        example: "Tu as réécrit les commits de ta branche de travail (amend, rebase, squash) déjà publiée.",
        steps: ["Petite flèche à côté de « Push » (« Options Push ») → « Push forcé… », puis confirme."],
        warning: "Les commits distants absents de ta version locale sont perdus : à réserver à tes propres branches.",
      },
    ],
  },
  {
    id: "integrate",
    label: "Intégrer",
    entries: [
      {
        title: "Fusionner une branche",
        command: "git merge <branche>",
        summary: "Intègre les commits d'une autre branche dans la branche courante, avec un commit de merge si nécessaire.",
        example: "Ta fonctionnalité est terminée et tu veux l'intégrer à main.",
        steps: [
          "Bascule sur la branche qui reçoit (main).",
          "Clic droit sur la branche à intégrer → « Merger <branche> dans <branche courante> ».",
          "Un commit précis peut aussi être mergé : clic droit dans le graphe → « Merger ce commit dans… ».",
        ],
      },
      {
        title: "Rebaser une branche",
        command: "git rebase <branche>",
        summary: "Rejoue les commits de la branche courante par-dessus une autre, pour un historique linéaire.",
        example: "main a avancé pendant ton travail : tu remets ta branche à jour avant de la proposer.",
        steps: [
          "Bascule sur ta branche de travail.",
          "Clic droit sur la branche cible → « Rebaser <branche courante> sur <branche> ».",
          "En cas de conflit, résous-le puis clique sur « Continuer » dans le bandeau du panneau de droite.",
        ],
        warning: "Réécrit les commits de ta branche : si elle est déjà publiée, il faudra un push forcé.",
      },
      {
        title: "Résoudre un conflit",
        command: "git add <fichier> (après édition)",
        summary: "Quand deux branches modifient les mêmes lignes, git s'arrête et te demande quelle version garder.",
        example: "Pendant un merge, un collègue et toi avez modifié la même fonction.",
        steps: [
          "Les fichiers concernés apparaissent dans la section « Conflits » du panneau de droite.",
          "Clique sur un fichier : chaque bloc montre « Actuel (HEAD) » et « Entrant » côte à côte.",
          "Clique sur la version à garder, ou « Garder les deux », puis « Résoudre et indexer ».",
          "Une fois tous les conflits résolus, commite (merge) ou clique sur « Continuer » (rebase).",
        ],
      },
      {
        title: "Abandonner un merge ou un rebase",
        command: "git merge --abort · git rebase --abort",
        summary: "Annule l'opération en cours et remet la branche dans l'état d'avant.",
        example: "Les conflits sont plus nombreux que prévu et tu préfères en discuter avant de continuer.",
        steps: ["Dans le bandeau en haut du panneau de droite, clique sur « Annuler l'opération » ou « Annuler le rebase »."],
      },
      {
        title: "Reprendre un commit d'une autre branche",
        command: "git cherry-pick <commit>",
        summary: "Copie les modifications d'un commit précis sur la branche courante.",
        example: "Un correctif fait sur la branche de développement doit aussi partir sur la branche de release.",
        steps: ["Bascule sur la branche qui reçoit.", "Clic droit sur le commit dans le graphe → « Cherry-pick dans <branche> »."],
      },
      {
        title: "Annuler un commit publié",
        command: "git revert <commit>",
        summary: "Crée un nouveau commit qui défait les modifications d'un ancien, sans réécrire l'historique.",
        example: "Un commit déjà poussé sur main casse la production : tu l'annules proprement.",
        steps: ["Clic droit sur le commit dans le graphe → « Revert ce commit »."],
      },
      {
        title: "Ouvrir une pull request",
        command: "gh pr create · glab mr create",
        summary: "Propose les commits d'une branche à la relecture sur GitHub (pull request) ou GitLab (merge request).",
        example: "Ta branche est poussée et tu veux la faire relire avant de l'intégrer.",
        steps: [
          "Pousse la branche.",
          "Clic droit sur la branche → « Créer une pull request GitHub… » ou « Créer une merge request GitLab… » (un compte de la forge doit être connecté).",
        ],
      },
    ],
  },
  {
    id: "history",
    label: "Réécrire l'historique",
    entries: [
      {
        title: "Rebase interactif",
        command: "git rebase -i <commit>",
        summary: "Réorganise une série de commits : réordonner, renommer, fusionner, modifier ou supprimer.",
        example: "Avant d'ouvrir ta pull request, tu regroupes les commits « wip » et corriges les messages.",
        steps: [
          "Clic droit sur le commit le plus ancien à retoucher → « Rebase interactif de <branche> depuis ce commit… ».",
          "Choisis une action par commit : Garder, Renommer, Modifier, Fusionner, Fixup ou Supprimer.",
          "Glisse les lignes pour changer l'ordre, puis clique sur « Lancer le rebase ».",
          "Si le rebase s'arrête (conflit ou « Modifier »), le bandeau du panneau de droite propose « Continuer ».",
        ],
        warning: "Réécrit l'historique : à éviter sur des commits que d'autres ont déjà récupérés.",
      },
      {
        title: "Regrouper des commits",
        command: "git rebase -i (squash)",
        summary: "Fusionne plusieurs commits en un seul, à la place du plus ancien.",
        example: "Trois petits commits de mise au point ne forment en réalité qu'un seul changement.",
        steps: [
          "Dans le graphe, sélectionne les commits avec Ctrl + clic ou Maj + clic.",
          "Clic droit → « Squasher les N commits sélectionnés… ».",
          "Ajuste le message du commit obtenu puis valide.",
        ],
        warning: "Réécrit l'historique de la branche.",
      },
      {
        title: "Revenir à un commit antérieur",
        command: "git reset --soft | --mixed | --hard <commit>",
        summary: "Déplace la branche courante sur un autre commit. Soft garde tout indexé, mixed garde les fichiers modifiés, hard efface tout.",
        example: "Tu as commité trop tôt : un reset soft sur le commit précédent te rend les modifications, prêtes à être recommitées.",
        steps: ["Clic droit sur le commit cible dans le graphe → « Reset <branche> ici — soft », « mixed » ou « hard »."],
        warning: "Le reset hard supprime les modifications locales et rend les commits suivants inaccessibles.",
      },
    ],
  },
  {
    id: "stash",
    label: "Mettre de côté",
    entries: [
      {
        title: "Mettre de côté ses modifications",
        command: "git stash push -u -m <message>",
        summary: "Range les modifications en cours dans une réserve et remet la copie de travail au propre.",
        example: "Tu dois changer de branche pour une urgence alors que ton travail n'est pas prêt à être commité.",
        steps: [
          "Bouton « Stash » de la barre d'outils.",
          "Donne un message si tu veux le retrouver facilement, et coche « Inclure les fichiers non suivis » au besoin.",
        ],
      },
      {
        title: "Reprendre un stash",
        command: "git stash pop · git stash apply",
        summary: "Réapplique des modifications mises de côté ; « pop » les retire aussi de la réserve.",
        example: "L'urgence est traitée, tu reviens sur ta branche et reprends là où tu en étais.",
        steps: [
          "Bouton « Pop » : réapplique le stash le plus récent et le supprime.",
          "Pour un autre : section « Stashes » du panneau de gauche, clic droit → « Appliquer » ou « Appliquer et supprimer (pop) ».",
        ],
      },
      {
        title: "Supprimer un stash",
        command: "git stash drop",
        summary: "Retire un stash de la réserve sans l'appliquer.",
        example: "Un vieil essai mis de côté ne servira finalement pas.",
        steps: ["Section « Stashes », clic droit sur le stash → « Supprimer »."],
        warning: "Les modifications qu'il contenait sont perdues.",
      },
    ],
  },
  {
    id: "tags",
    label: "Tags",
    entries: [
      {
        title: "Créer un tag",
        command: "git tag -a <nom> -m <message>",
        summary: "Pose une étiquette fixe sur un commit, en général pour marquer une version.",
        example: "La version 1.2.0 est prête : tu marques le commit qui a été livré.",
        steps: ["Clic droit sur le commit dans le graphe → « Créer un tag ici… ».", "Saisis le nom (v1.2.0) puis, si tu veux, un message."],
      },
      {
        title: "Publier un tag",
        command: "git push origin <tag>",
        summary: "Les tags ne partent pas avec un push ordinaire : ils se poussent explicitement.",
        example: "Ta chaîne de publication se déclenche à l'arrivée d'un tag « v* » sur le remote.",
        steps: ["Section « Tags » du panneau de gauche, clic droit sur le tag → « Push vers <remote> »."],
      },
      {
        title: "Supprimer un tag",
        command: "git tag -d <tag> · git push origin --delete <tag>",
        summary: "Retire un tag en local, et séparément sur le remote.",
        example: "Tu as tagué le mauvais commit.",
        steps: ["Section « Tags », clic droit sur le tag → « Supprimer » (local) ou « Supprimer sur <remote> »."],
      },
    ],
  },
  {
    id: "explore",
    label: "Explorer",
    entries: [
      {
        title: "Parcourir l'historique",
        command: "git log --graph --all",
        summary: "Affiche les commits et la façon dont les branches se séparent et se rejoignent.",
        example: "Tu cherches quand une fonctionnalité a été mergée et par qui.",
        steps: [
          "Le graphe occupe le centre de la fenêtre.",
          "Le champ de recherche en haut à droite filtre par message, auteur ou hash.",
        ],
      },
      {
        title: "Voir le contenu d'un commit",
        command: "git show <commit>",
        summary: "Affiche le message, l'auteur et les fichiers modifiés par un commit.",
        example: "Tu veux comprendre ce qu'un commit a réellement changé avant de le reprendre ailleurs.",
        steps: [
          "Clique sur le commit dans le graphe : ses détails et ses fichiers s'affichent à droite.",
          "Clique sur un fichier pour voir son diff au centre.",
          "Clic droit sur le commit → « Copier le hash complet », « Copier le hash court » ou « Copier le message ».",
        ],
      },
      {
        title: "Voir les commandes exécutées",
        command: "—",
        summary: "Chaque action de l'application est consignée avec la commande git équivalente.",
        example: "Tu veux apprendre la commande correspondant à ce que tu viens de faire, ou retrouver une erreur.",
        steps: ["Ouvre le panneau du bas (Ctrl+J) puis l'onglet « Journal »."],
      },
      {
        title: "Tout le reste, en ligne de commande",
        command: "git blame · git bisect · git reflog · git clean …",
        summary: "Les commandes sans bouton dédié restent accessibles dans le terminal intégré, ouvert dans le dépôt.",
        example: "Tu veux savoir qui a écrit une ligne (blame) ou retrouver un commit perdu après un reset (reflog).",
        steps: ["Ouvre le panneau du bas (Ctrl+J) puis l'onglet « Terminal ».", "F5 rafraîchit l'affichage après une commande."],
      },
    ],
  },
  {
    id: "advanced",
    label: "Sous-modules et LFS",
    entries: [
      {
        title: "Initialiser et mettre à jour les sous-modules",
        command: "git submodule update --init",
        summary: "Récupère les dépôts imbriqués au commit enregistré par le dépôt parent.",
        example: "Tu viens de cloner un projet dont une bibliothèque est fournie en sous-module : son dossier est vide.",
        steps: [
          "Section « Sous-modules » du panneau de gauche : le « + » les initialise et les met tous à jour.",
          "Clic droit sur un sous-module pour le mettre à jour seul ou l'ouvrir dans un nouvel onglet.",
        ],
      },
      {
        title: "Suivre de gros fichiers avec Git LFS",
        command: "git lfs track <motif>",
        summary: "Stocke les fichiers volumineux hors de l'historique, qui n'en garde qu'un pointeur.",
        example: "Ton dépôt contient des maquettes .psd de plusieurs centaines de Mo.",
        steps: [
          "Section « LFS » du panneau de gauche : le « + » ajoute un motif (*.psd).",
          "Ou clic droit sur un fichier non suivi → « Suivre les fichiers *.ext avec Git LFS ».",
          "Commite le .gitattributes modifié avec les fichiers.",
        ],
        warning: "Git LFS doit être installé sur la machine.",
      },
      {
        title: "Récupérer les fichiers LFS",
        command: "git lfs pull",
        summary: "Télécharge le contenu réel des fichiers LFS de la révision courante.",
        example: "Après un clone, tes images ne font que quelques octets : ce sont encore des pointeurs.",
        steps: ["Section « LFS », clic droit sur un motif → « Récupérer les fichiers LFS »."],
      },
    ],
  },
];

/** Texte comparable : minuscules, sans accents. */
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Groupes réduits aux opérations contenant tous les mots de la recherche (hors casse et accents). */
export function filterMemo(groups: MemoGroup[], query: string): MemoGroup[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((e) => {
        const text = normalize([e.title, e.command, e.summary, e.example, ...e.steps, e.warning ?? ""].join(" "));
        return words.every((w) => text.includes(w));
      }),
    }))
    .filter((group) => group.entries.length > 0);
}
