import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname, recommendedConfig: js.configs.recommended });

export default defineConfig([
    globalIgnores(["dist/**", "node_modules/**", "**/*.test.ts"]),
    {
        extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),
        plugins: { "@typescript-eslint": typescriptEslint },
        languageOptions: { globals: { ...globals.node }, parser: tsParser, sourceType: "module" },
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            indent: ["error", 4],
            "no-console": ["error"],
        },
    }]);

