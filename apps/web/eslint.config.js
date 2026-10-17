import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "playwright-report", "test-results", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.{ts,tsx}"], plugins: { "react-hooks": hooks, "react-refresh": refresh }, rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true, allowExportNames: ["cn"] }],
  } },
);
