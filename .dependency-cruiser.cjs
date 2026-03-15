/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        // ============================================================================
        // ARCHITECTURAL RULES
        // ============================================================================

        // Rule 1: No circular dependencies
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Circular dependencies make code hard to maintain and can cause runtime issues',
            from: {},
            to: {
                circular: true,
            },
        },

        // Rule 2: calc.ts must be pure (no side effects)
        // calc.ts should not import state, api, or UI modules (type-only imports are allowed)
        {
            name: 'calc-must-be-pure',
            severity: 'error',
            comment: 'Calculation engine must remain pure - no side effects or external dependencies',
            from: {
                path: '^js/calc\\.ts$',
            },
            to: {
                path: '^js/(state|api|ui|main|error-reporting)\\.ts$',
                dependencyTypesNot: ['type-only'],
            },
        },

        // Rule 3: UI modules should not directly access API
        // UI should go through state or main for data
        {
            name: 'ui-no-direct-api',
            severity: 'warn',
            comment: 'UI modules should not directly call API - use state/main as intermediary',
            from: {
                path: '^js/ui/',
            },
            to: {
                path: '^js/api\\.ts$',
            },
        },

        // Rule 4: No orphan modules (unused files)
        {
            name: 'no-orphans',
            severity: 'warn',
            comment: 'Unused modules should be removed to keep codebase clean',
            from: {
                orphan: true,
                pathNot: [
                    // Allow test files to be "orphans" (not imported by main code)
                    '(^|/)__tests__/',
                    '(^|/)__mocks__/',
                    // Allow entry points
                    '^js/main\\.ts$',
                    '^js/calc\\.worker\\.ts$',
                    // Allow ambient type declarations for optional dependencies
                    '^js/sentry\\.d\\.ts$',
                ],
            },
            to: {},
        },

        // Rule 5: No dependencies on test utilities from production code
        {
            name: 'no-test-deps-in-prod',
            severity: 'error',
            comment: 'Production code must not depend on test utilities',
            from: {
                pathNot: ['(^|/)__tests__/', '(^|/)__mocks__/'],
            },
            to: {
                path: ['(^|/)__tests__/', '(^|/)__mocks__/', 'jest', '@jest'],
            },
        },

        // Rule 6: constants.ts should have no dependencies on other app modules
        {
            name: 'constants-standalone',
            severity: 'error',
            comment: 'Constants module should be standalone with no app dependencies',
            from: {
                path: '^js/constants\\.ts$',
            },
            to: {
                path: '^js/(?!types)',
            },
        },

        // Rule 7: types.ts should have no dependencies
        {
            name: 'types-standalone',
            severity: 'error',
            comment: 'Types module should have no runtime dependencies',
            from: {
                path: '^js/types\\.ts$',
            },
            to: {
                path: '^js/',
            },
        },

        // Rule 8: No importing from node_modules that aren't declared
        {
            name: 'no-undeclared-deps',
            severity: 'error',
            comment: 'All npm dependencies must be declared in package.json',
            from: {
                pathNot: ['(^|/)__mocks__/'],
            },
            to: {
                dependencyTypes: ['npm-no-pkg', 'npm-unknown'],
            },
        },

        // Rule 9: Prefer peer dependencies for @sentry/browser
        {
            name: 'sentry-isolation',
            severity: 'warn',
            comment: 'Sentry should only be imported from error-reporting.ts',
            from: {
                pathNot: ['^js/error-reporting\\.ts$'],
            },
            to: {
                path: '@sentry',
            },
        },

        // Rule 10: Logger should be self-contained
        {
            name: 'logger-minimal-deps',
            severity: 'warn',
            comment: 'Logger should have minimal dependencies',
            from: {
                path: '^js/logger\\.ts$',
            },
            to: {
                pathNot: ['^js/(constants|types)\\.ts$'],
            },
        },
    ],

    options: {
        doNotFollow: {
            path: 'node_modules',
        },
        tsPreCompilationDeps: true,
        tsConfig: {
            fileName: './tsconfig.json',
        },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default'],
        },
        reporterOptions: {
            dot: {
                collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
            },
            text: {
                highlightFocused: true,
            },
        },
    },
};
