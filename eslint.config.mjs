import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Claude Code skills: third-party example and template files that
    // live on disk but are gitignored, so they are never part of this repo.
    // Without this, `npm run lint` fails locally on code nobody here wrote
    // while CI -- which checks out without them -- passes, and the two
    // disagreeing is worse than either being wrong.
    ".claude/**",
  ]),
]);

export default eslintConfig;
