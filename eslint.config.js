import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "research/**", "node_modules/**", "**/*.js", "**/test-results/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
