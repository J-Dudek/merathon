// Analyse statique du front : règles TypeScript recommandées, règles SonarJS (les mêmes que Sonar)
// et règles des hooks React. Lancée en CI avec `npm run lint`.
import sonarjs from "eslint-plugin-sonarjs";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    extends: [tseslint.configs.recommended, sonarjs.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
