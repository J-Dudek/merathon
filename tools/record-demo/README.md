# Enregistrement de la démo

Génère `docs/demo-en.gif`, le GIF de `README.en.md`.

C'est la vraie interface, compilée depuis `git-client/` et affichée en anglais dans Chromium. Le backend Tauri est remplacé par `mock.js` : les dépôts, le compte, les PR et le terminal sont fictifs, et rien ne touche à git, au réseau ni à la configuration de la machine.

## Lancer

Prérequis : les dépendances de `git-client/` sont installées (`npm install`).

```bash
cd tools/record-demo
npm install
npx playwright install chromium
npm run demo
```

Comptez environ trois minutes. Pour utiliser un autre navigateur Chromium : `CHROME=/chemin/vers/chrome npm run demo`.

Les étapes se lancent aussi séparément :

| Commande | Effet |
| --- | --- |
| `npm run build` | Compile le frontend dans `dist/` |
| `npm run record` | Joue les scènes et écrit les images dans `frames/` (PNG et `delays.json`) |
| `npm run encode` | Assemble `frames/` dans `docs/demo-en.gif` |

## Modifier

- **`record.cjs`** : les scènes, une fonction par scène, jouées dans l'ordre. `hold(ms)` capture une image affichée `ms` millisecondes. Les libellés passent par `t("texte français")`, qui lit `git-client/src/i18n/en.ts` et échoue si la clé n'existe plus.
- **`mock.js`** : les données et les réponses du backend. Une commande inconnue répond `null` et s'affiche en `MOCK-UNKNOWN` dans la console.
- **`encode.cjs`** : la palette et l'assemblage du GIF.

Quand une scène échoue, l'enregistrement s'arrête et laisse une capture `fail-<scène>.png`. Après une évolution de l'interface, relisez les images de `frames/` et mettez à jour le texte alternatif du GIF dans `README.en.md` si les scènes ont changé.

## Limite

Seule la version anglaise est prise en charge : `docs/demo.gif`, le GIF français, n'est pas généré par cet outil. Il faudrait traduire les données de `mock.js` et les quelques libellés écrits en dur dans `record.cjs`.
