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
        `  <footer class="version-footer" style="text-align:center;padding:8px;font-size:11px;color:var(--text-muted,#666);">OTPLUS v${VERSION}</footer>\n</body>`
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
        });
        console.log('  Built calc.worker.js');
    }

    if (isWatch) {
        // Watch mode
        const context = await esbuild.context(buildOptions);
        await context.watch();
        console.log('Watching for changes...');
    } else {
        // Single build
        await esbuild.build(buildOptions);
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

    // Copy manifest.json with updated version and optional baseUrl
    if (fs.existsSync('manifest.json')) {
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        manifest.version = VERSION;
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
