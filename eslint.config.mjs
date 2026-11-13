// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "storage/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: "./tsconfig.typecheck.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Unhandled promises are a frequent source of silent failures in Express handlers.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // supertest responses are untyped (any) by design.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Mocks and fakes often implement async interfaces synchronously.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // CLI script: console output is its interface.
    files: ["prisma/seed.ts"],
    rules: { "no-console": "off" },
  },
  { files: ["**/*.mjs", "**/*.mts"], ...tseslint.configs.disableTypeChecked },
  prettier
);
