/**
 * Custom Jest resolver that maps .js imports to .ts files
 * Only for project files, not node_modules
 */

const { resolve, join, dirname, basename } = require('path');
const { existsSync } = require('fs');

/**
 * Resolve module path, mapping .js to .ts for project files
 * @param {string} request - The module request
 * @param {object} options - Resolver options
 * @returns {string} Resolved path
 */
module.exports = function customResolver(request, options) {
    const { basedir, defaultResolver } = options;

    // Only transform relative imports ending with .js
    if (request.startsWith('.') && request.endsWith('.js')) {
        // Resolve the full path
        const resolvedPath = resolve(basedir, request);

        // Only transform if not in node_modules
        if (!resolvedPath.includes('node_modules')) {
            // Handle special case: ui.js → ui/index.ts
            const fileName = basename(request, '.js');
            const dirPath = dirname(resolve(basedir, request));

            if (fileName === 'ui') {
                const uiIndexPath = join(dirPath, 'ui', 'index.ts');
                if (existsSync(uiIndexPath)) {
                    return uiIndexPath;
                }
            }

            // Try .ts version first
            const tsPath = request.replace(/\.js$/, '.ts');
            const fullTsPath = resolve(basedir, tsPath);

            if (existsSync(fullTsPath)) {
                return fullTsPath;
            }
        }
    }

    // Default resolution
    return defaultResolver(request, {
        ...options,
        packageFilter: pkg => {
            // Fix for ESM packages
            if (pkg.exports) {
                delete pkg.exports;
            }
            return pkg;
        }
    });
};
