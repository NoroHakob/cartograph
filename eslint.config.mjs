import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The parser takes a path and returns data. It runs from a plain script, so
  // it can't depend on the web framework, the UI, the database or the app.
  {
    files: ["src/parser/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*", "@xyflow/*", "server-only"],
              message: "The parser imports no web framework or UI library.",
            },
            { group: ["@supabase/*", "@clerk/*", "openai", "openai/*"], message: "The parser imports no database or service client." },
            { group: ["@/*"], message: "The parser doesn't depend on app code." },
          ],
        },
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
  ]),
]);

export default eslintConfig;
