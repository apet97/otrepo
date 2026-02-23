import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
    js.configs.recommended,
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
                // Browser globals
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
                // Web Worker globals
                self: 'readonly',
                postMessage: 'readonly',
                onmessage: 'writable',
                importScripts: 'readonly'
            }
        },
        rules: {
            // TypeScript-specific rules
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'warn',

            // Security rules
            'security/detect-eval-with-expression': 'error',
            'security/detect-non-literal-regexp': 'warn',
            'security/detect-object-injection': 'off', // Too many false positives
            'security/detect-possible-timing-attacks': 'warn',

            // General best practices
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-script-url': 'error',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'prefer-const': 'error',
            'no-var': 'error',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'curly': ['error', 'multi-line'],
            'no-throw-literal': 'error',
            'prefer-promise-reject-errors': 'error',

            // Complexity metrics (P3: Code Quality)
            // Note: Thresholds are set to balance maintainability with complex business logic
            // Functions exceeding these limits should be reviewed for potential refactoring
            'complexity': ['warn', { max: 25 }], // Cyclomatic complexity threshold
            'max-depth': ['warn', { max: 5 }], // Maximum nesting depth
            'max-nested-callbacks': ['warn', { max: 4 }], // Maximum callback nesting
            'max-lines-per-function': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],

            // Import rules
            'import/no-duplicates': 'error',
            'import/no-self-import': 'error',
            'import/no-cycle': 'warn',
            'import/no-useless-path-segments': 'error',
            'import/first': 'error',
            'import/order': ['warn', {
                'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                'newlines-between': 'never'
            }]
        }
    },
    {
        // Test file specific rules
        files: ['**/__tests__/**/*.{js,ts}', '**/*.test.{js,ts}', '**/__mocks__/**/*.{js,ts}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
            '@typescript-eslint/no-unused-vars': 'off'
        }
    },
    {
        // Ignore patterns
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
