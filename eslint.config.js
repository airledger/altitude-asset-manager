import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // The live app at the repo root and the edge function (Deno) are linted separately after the rebuild.
  { ignores: ["**/dist/**", "**/node_modules/**", "*.js", "!eslint.config.js", "supabase/functions/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
