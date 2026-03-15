#!/usr/bin/env node
/**
 * @fileoverview Build script using esbuild for OTPLUS
 * Bundles TypeScript/JavaScript source files, copies static assets,
 * and generates production-ready output in dist/
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read package.json for version
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const VERSION = packageJson.version;

// Build configuration
const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

console.log(`Building OTPLUS v${VERSION} (${isProduction ? 'production' : 'development'})...`);

/**
 * Copy a file or directory recursively
 */
function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        for (const file of fs.readdirSync(src)) {
            copyRecursive(path.join(src, file), path.join(dest, file));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

/**
 * Process index.html for production
 */
function processIndexHtml() {
    let html = fs.readFileSync('index.html', 'utf8');

    // Update script reference to use bundled output
    html = html.replace(
        /<script type="module" src="js\/main\.js[^"]*"><\/script>/,
        `<script type="module" src="js/app.bundle.js?v=${VERSION}"></script>`
    );

    // Inject version into page
    html = html.replace(
        '</body>',
        `  <footer class="version-footer">OTPLUS v${VERSION}</footer>\n</body>`
    );

    return html;
}

/**
 * Main build function
 */
async function build() {
    // Clean dist directory
    if (fs.existsSync('dist')) {
        fs.rmSync('dist', { recursive: true });
    }
    fs.mkdirSync('dist', { recursive: true });
    fs.mkdirSync('dist/js', { recursive: true });
    fs.mkdirSync('dist/css', { recursive: true });

    // Determine entry point (prefer .ts if exists, fallback to .js)
    const entryPoint = fs.existsSync('js/main.ts') ? 'js/main.ts' : 'js/main.js';

    // Build options
    const buildOptions = {
        entryPoints: [entryPoint],
        bundle: true,
        outfile: 'dist/js/app.bundle.js',
        format: 'esm',
        platform: 'browser',
        target: ['es2020'],
        sourcemap: isProduction ? 'external' : 'linked',
        minify: isProduction,
        // Replace unused Sentry sub-packages with empty modules to save ~181KB.
        // These are re-exported by @sentry/browser's barrel but our code only uses
        // core APIs (init, captureException, withScope, etc.) via a SentryLike interface.
        plugins: [{
            name: 'sentry-treeshake',
            setup(build) {
                const emptyPkgs = [
                    '@sentry-internal/replay',
                    '@sentry-internal/replay-canvas',
                    '@sentry-internal/feedback',
                ];
                const filter = new RegExp(`^(${emptyPkgs.map(p => p.replace(/[/\\-]/g, '\\$&')).join('|')})$`);
                build.onResolve({ filter }, (args) => ({
                    path: args.path,
                    namespace: 'sentry-empty',
                }));
                const stubs = {
                    '@sentry-internal/replay':
                        'export const getReplay = () => {}; export const replayIntegration = () => ({});',
                    '@sentry-internal/replay-canvas':
                        'export const replayCanvasIntegration = () => ({});',
                    '@sentry-internal/feedback':
                        'export const getFeedback = () => {}; export const sendFeedback = () => {}; export const buildFeedbackIntegration = () => ({}); export const feedbackScreenshotIntegration = () => ({}); export const feedbackModalIntegration = () => ({});',
                };
                build.onLoad({ filter: /.*/, namespace: 'sentry-empty' }, (args) => ({
                    contents: stubs[args.path] || 'export {}',
                    loader: 'js',
                }));
            },
        }],
        define: {
            'process.env.VERSION': JSON.stringify(VERSION),
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN || ''),
        },
        banner: {
            // Use SOURCE_DATE_EPOCH for reproducible builds if set, otherwise current time
            js: `// OTPLUS v${VERSION} - Built ${process.env.SOURCE_DATE_EPOCH ? new Date(parseInt(process.env.SOURCE_DATE_EPOCH, 10) * 1000).toISOString() : new Date().toISOString()}\n`,
        },
        logLevel: 'info',
    };

    // Build Web Worker if it exists
    const workerPath = fs.existsSync('js/calc.worker.ts') ? 'js/calc.worker.ts' : 'js/calc.worker.js';
    if (fs.existsSync(workerPath)) {
        await esbuild.build({
            entryPoints: [workerPath],
            bundle: true,
            outfile: 'dist/js/calc.worker.js',
            format: 'iife',
            platform: 'browser',
            target: ['es2020'],
            minify: isProduction,
            sourcemap: isProduction ? 'external' : 'linked',
            define: {
                'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            },
        });
        console.log('  Built calc.worker.js');
    }

    if (isWatch) {
        // Watch mode
        const context = await esbuild.context(buildOptions);
        await context.watch();
        console.log('Watching for changes...');
    } else {
        // Single build with metafile for bundle analysis
        const result = await esbuild.build({ ...buildOptions, metafile: true });
        if (isProduction && result.metafile) {
            fs.writeFileSync('dist/meta.json', JSON.stringify(result.metafile));
            const text = await esbuild.analyzeMetafile(result.metafile, { verbose: false });
            console.log('\nBundle analysis:\n' + text);
        }
    }

    // Copy static assets
    console.log('Copying static assets...');

    // Copy and process index.html
    const processedHtml = processIndexHtml();
    fs.writeFileSync('dist/index.html', processedHtml);

    // Copy CSS
    if (fs.existsSync('css')) {
        copyRecursive('css', 'dist/css');
    }

    // Copy addon icon
    if (fs.existsSync('icon.svg')) {
        fs.copyFileSync('icon.svg', 'dist/icon.svg');
    }

    // Copy manifest.json with optional baseUrl override
    if (fs.existsSync('manifest.json')) {
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        if (process.env.MANIFEST_BASE_URL) {
            manifest.baseUrl = process.env.MANIFEST_BASE_URL;
        }
        fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
    }

    console.log(`Build complete! Output in dist/`);
    console.log(`  Version: ${VERSION}`);
    console.log(`  Mode: ${isProduction ? 'production (minified)' : 'development'}`);
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
