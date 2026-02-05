#!/usr/bin/env node

/**
 * @fileoverview Release Script
 * Automates the release process for OTPLUS addon.
 *
 * Usage:
 *   npm run release [patch|minor|major]
 *
 * Steps:
 *   1. Bump version in package.json
 *   2. Update CHANGELOG.md
 *   3. Build production assets
 *   4. Create git tag
 *   5. Create ZIP artifact
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

/**
 * Execute a shell command and return output
 * @param {string} cmd - Command to execute
 * @param {boolean} silent - Whether to suppress output
 * @returns {string} Command output
 */
function exec(cmd, silent = false) {
    try {
        const output = execSync(cmd, {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            stdio: silent ? 'pipe' : 'inherit'
        });
        return output?.trim() || '';
    } catch (error) {
        console.error(`Command failed: ${cmd}`);
        console.error(error.message);
        process.exit(1);
    }
}

/**
 * Read JSON file
 * @param {string} path - File path
 * @returns {object} Parsed JSON
 */
function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Write JSON file
 * @param {string} path - File path
 * @param {object} data - Data to write
 */
function writeJson(path, data) {
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Bump version number
 * @param {string} version - Current version
 * @param {string} type - Bump type (patch, minor, major)
 * @returns {string} New version
 */
function bumpVersion(version, type) {
    const [major, minor, patch] = version.split('.').map(Number);

    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

/**
 * Update CHANGELOG.md with new version
 * @param {string} version - New version
 */
function updateChangelog(version) {
    const changelogPath = join(ROOT_DIR, 'CHANGELOG.md');

    if (!existsSync(changelogPath)) {
        console.warn('CHANGELOG.md not found, skipping update');
        return;
    }

    const changelog = readFileSync(changelogPath, 'utf8');
    const date = new Date().toISOString().split('T')[0];

    // Get commit messages since last tag
    let commits = '';
    try {
        commits = exec('git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD', true);
    } catch {
        commits = exec('git log --oneline -20', true);
    }

    const commitList = commits
        .split('\n')
        .filter(Boolean)
        .map(line => `- ${line.substring(8)}`) // Remove commit hash
        .join('\n');

    // Insert new version section after header
    const headerEnd = changelog.indexOf('\n## ');
    const newSection = `\n## [${version}] - ${date}\n\n### Changes\n${commitList || '- No changes recorded'}\n`;

    const updatedChangelog = headerEnd > 0
        ? changelog.slice(0, headerEnd) + newSection + changelog.slice(headerEnd)
        : changelog + newSection;

    writeFileSync(changelogPath, updatedChangelog);
    console.log(`Updated CHANGELOG.md for version ${version}`);
}

/**
 * Main release function
 */
async function main() {
    const bumpType = process.argv[2] || 'patch';

    if (!['patch', 'minor', 'major'].includes(bumpType)) {
        console.error('Usage: npm run release [patch|minor|major]');
        process.exit(1);
    }

    console.log(`\n🚀 Starting ${bumpType} release...\n`);

    // Check for uncommitted changes
    const status = exec('git status --porcelain', true);
    if (status) {
        console.error('Error: Working directory has uncommitted changes');
        console.error('Please commit or stash your changes before releasing');
        process.exit(1);
    }

    // Read current version
    const packagePath = join(ROOT_DIR, 'package.json');
    const pkg = readJson(packagePath);
    const currentVersion = pkg.version;
    const newVersion = bumpVersion(currentVersion, bumpType);

    console.log(`📦 Bumping version: ${currentVersion} → ${newVersion}`);

    // Update package.json
    pkg.version = newVersion;
    writeJson(packagePath, pkg);

    // Update manifest.json if exists
    const manifestPath = join(ROOT_DIR, 'manifest.json');
    if (existsSync(manifestPath)) {
        const manifest = readJson(manifestPath);
        manifest.version = newVersion;
        writeJson(manifestPath, manifest);
        console.log('Updated manifest.json');
    }

    // Update changelog
    updateChangelog(newVersion);

    // Run tests
    console.log('\n🧪 Running tests...');
    exec('npm test');

    // Run linting
    console.log('\n🔍 Running lint...');
    exec('npm run lint');

    // Run type check
    console.log('\n📝 Running type check...');
    exec('npm run typecheck');

    // Build production
    console.log('\n🔨 Building production assets...');
    exec('npm run build:prod');

    // Create git commit and tag
    console.log('\n📋 Creating git commit and tag...');
    const filesToStage = ['package.json'];
    if (existsSync(join(ROOT_DIR, 'manifest.json'))) {
        filesToStage.push('manifest.json');
    }
    if (existsSync(join(ROOT_DIR, 'CHANGELOG.md'))) {
        filesToStage.push('CHANGELOG.md');
    }
    exec(`git add ${filesToStage.map((file) => `"${file}"`).join(' ')}`);
    exec(`git commit -m "chore: release v${newVersion}"`);
    exec(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

    // Create ZIP artifact
    console.log('\n📦 Creating ZIP artifact...');
    const zipName = `otplus-v${newVersion}.zip`;
    exec(`cd dist && zip -r ../${zipName} .`);

    console.log(`\n✅ Release v${newVersion} complete!`);
    console.log(`\nNext steps:`);
    console.log(`  1. Review the changes: git log -1`);
    console.log(`  2. Push to remote: git push && git push --tags`);
    console.log(`  3. Upload ${zipName} to Clockify Marketplace`);
    console.log('');
}

main().catch(error => {
    console.error('Release failed:', error);
    process.exit(1);
});
