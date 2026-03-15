/**
 * ESLint 9 flat config for OTPLUS.
 * Extends recommended JS and TypeScript rules, adds security plugin
 * for XSS/injection prevention, and import plugin for dependency hygiene.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
    // Base: ESLint recommended rules for plain JavaScript
    js.configs.recommended,
    // Layer: typescript-eslint recommended rules (type-aware linting)
    ...tseslint.configs.recommended,
    {
        plugins: {
            security: security,
            import: importPlugin
        },
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                // Browser globals — declared here because we target browser platform
                // without a full "browser" env (flat config has no env shorthand)
                window: 'readonly',
                document: 'readonly',
                localStorage: 'readonly',
                fetch: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                FormData: 'readonly',
                Blob: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                Headers: 'readonly',
                Request: 'readonly',
                Response: 'readonly',
                Worker: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                performance: 'readonly',
                navigator: 'readonly',
                Intl: 'readonly',
                // Web Worker globals (calc.worker.ts runs in a dedicated worker context)
                self: 'readonly',
                postMessage: 'readonly',
                onmessage: 'writable',    // Worker assigns its own message handler
                importScripts: 'readonly'
            }
        },
        rules: {
            // --- TypeScript rules ---
            // Allow unused vars when prefixed with underscore (common pattern for
            // intentionally ignored parameters, e.g. (_event, index) => ...)
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            // Return types are inferred; explicit annotations add noise in this codebase
            '@typescript-eslint/explicit-function-return-type': 'off',
            // Warn on `any` to encourage proper typing without blocking development
            '@typescript-eslint/no-explicit-any': 'warn',
            // Non-null assertions (!) can mask null bugs; warn to encourage safe access
            '@typescript-eslint/no-non-null-assertion': 'warn',

            // --- Security rules (XSS / injection prevention) ---
            // Block eval-like patterns that could execute attacker-controlled strings
            'security/detect-eval-with-expression': 'error',
            // Warn on dynamic RegExp (potential ReDoS vector)
            'security/detect-non-literal-regexp': 'warn',
            // Disabled: bracket notation on objects fires too many false positives
            'security/detect-object-injection': 'off',
            // Warn on comparisons that could leak timing info (e.g. token equality)
            'security/detect-possible-timing-attacks': 'warn',

            // --- General best practices ---
            // Prevent code execution from strings (eval, setTimeout("string"), new Function)
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            // Block javascript: URLs in href attributes
            'no-script-url': 'error',
            // Allow only console.warn and console.error; other logging should use logger.ts
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            // Modern JS style enforcement
            'prefer-const': 'error',
            'no-var': 'error',
            // Require strict equality; null comparisons exempted for idiomatic null checks
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            // Require braces for multi-line blocks to prevent dangling-else bugs
            'curly': ['error', 'multi-line'],
            // Only throw Error objects (preserves stack traces)
            'no-throw-literal': 'error',
            // Only reject with Error objects (consistent error handling)
            'prefer-promise-reject-errors': 'error',

            // --- Complexity metrics (P3: Code Quality) ---
            // Note: Thresholds are set to balance maintainability with complex business logic
            // Functions exceeding these limits should be reviewed for potential refactoring
            'complexity': ['warn', { max: 25 }], // Cyclomatic complexity threshold
            'max-depth': ['warn', { max: 5 }], // Maximum nesting depth
            'max-nested-callbacks': ['warn', { max: 4 }], // Maximum callback nesting
            'max-lines-per-function': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],

            // --- Import rules (dependency hygiene) ---
            // Prevent duplicate import statements for the same module
            'import/no-duplicates': 'error',
            // Prevent a module from importing itself (usually a typo)
            'import/no-self-import': 'error',
            // Detect circular dependencies that can cause runtime issues
            'import/no-cycle': 'warn',
            // Remove unnecessary "./" or "../" segments in import paths
            'import/no-useless-path-segments': 'error',
            // Imports must appear before any other statements
            'import/first': 'error',
            // Enforce consistent import ordering: builtin > external > internal > relative
            'import/order': ['warn', {
                'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                'newlines-between': 'never'
            }]
        }
    },
    {
        // Test file overrides — relax rules that are unnecessarily strict in tests:
        // - `any` is common in mocks and test fixtures
        // - console.log is used for debugging test output
        // - unused vars occur in destructuring and intentionally ignored returns
        files: ['**/__tests__/**/*.{js,ts}', '**/*.test.{js,ts}', '**/__mocks__/**/*.{js,ts}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
            '@typescript-eslint/no-unused-vars': 'off'
        }
    },
    {
        // Ignore patterns — skip linting for:
        // - node_modules: third-party code
        // - dist: build output (generated)
        // - coverage: test coverage reports (generated)
        // - *.min.js: pre-minified vendor files
        // - build.js: the build script itself (plain JS, not part of the app)
        // - app.bundle.js / .map: esbuild output checked in for GitHub Pages
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            '*.min.js',
            'build.js',
            'js/app.bundle.js',
            'js/app.bundle.js.map'
        ]
    }
);
