#!/usr/bin/env node

/**
 * Post-build syntax checker for AgentArena
 *
 * This script validates ALL JS modules in dist/ for syntax errors by running
 * `node --check` on each file. This catches errors like unescaped quotes in
 * Chinese strings that break ES module parsing.
 *
 * Usage: node scripts/check-syntax.js
 * Exit code: 0 if no issues, 1 if issues found
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIST_DIR = path.join(__dirname, '..', 'apps', 'web-report', 'dist');
const DIST_APP_JS = path.join(DIST_DIR, 'app.js');

console.log('🔍 Checking build output for syntax errors...\n');

if (!fs.existsSync(DIST_APP_JS)) {
  console.error(`❌ Build output not found: ${DIST_APP_JS}`);
  console.error('   Run `pnpm build` first.\n');
  process.exit(1);
}

const content = fs.readFileSync(DIST_APP_JS, 'utf8');

// Check for syntax errors in the built output (app.js only, legacy checks)
const checks = [
  {
    name: 'SyntaxError markers',
    test: () => {
      const patterns = [
        /SyntaxError:/i,
        /Unexpected token/i,
        /Unexpected identifier/i,
        /Unexpected character/i
      ];
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return `Found syntax error marker: ${pattern.source}`;
        }
      }
      return null;
    }
  },
  {
    name: 'Empty file',
    test: () => content.trim().length === 0 ? 'app.js is empty' : null
  },
  {
    name: 'File size',
    test: () => {
      const size = content.length;
      if (size < 1000) {
        return `app.js is suspiciously small (${size} bytes)`;
      }
      return null;
    }
  }
];

const errors = [];
for (const check of checks) {
  const error = check.test();
  if (error) {
    errors.push({ name: check.name, error });
  }
}

// Validate ALL dist JS modules with node --check (catches ES module syntax errors)
function getAllJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const allJsFiles = getAllJsFiles(DIST_DIR);
let parseErrors = 0;

for (const file of allJsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
  } catch (err) {
    parseErrors++;
    const relPath = path.relative(DIST_DIR, file);
    const stderr = err.stderr?.toString() ?? '';
    // Extract the useful part of the error (file:line:col + message)
    const match = stderr.match(/(.*\.js:\d+\n\s*\^+\nSyntaxError:.*)/s);
    console.error(`\n❌ ${relPath}:\n${match ? match[1] : stderr}`);
  }
}

if (parseErrors > 0) {
  errors.push({ name: 'ES module parse', error: `${parseErrors} file(s) have syntax errors` });
}

if (errors.length > 0) {
  console.error('\n❌ Syntax checks failed:\n');
  for (const { name, error } of errors) {
    console.error(`  ${name}: ${error}`);
  }
  console.error('\n💡 Common causes:');
  console.error('   - Chinese text with ASCII " inside JS " delimited strings');
  console.error('   - Unclosed template literals (backticks)');
  console.error('   - Incomplete expressions from deleted code\n');
  process.exit(1);
}

console.log('✅ Build output looks good - no syntax issues found\n');
process.exit(0);
