#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8'
}).split('\0').filter(Boolean);

const textExtensions = new Set([
    '.js', '.json', '.md', '.sql', '.html', '.css', '.yml', '.yaml', '.toml', '.txt', '.example'
]);
const problems = [];
const secretPatterns = [
    { name: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Supabase secret key', regex: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
    { name: 'JWT-like credential', regex: /\beyJ[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
    { name: 'AWS access key', regex: /\bAKIA[A-Z0-9]{16}\b/ }
];

for (const relative of listed) {
    const full = path.join(ROOT, relative);
    const normalized = relative.replace(/\\/g, '/');
    if (!fs.existsSync(full) || fs.statSync(full).size > 2 * 1024 * 1024) continue;
    const extension = path.extname(relative).toLowerCase();
    if (!textExtensions.has(extension) && path.basename(relative) !== '.gitignore') continue;
    if (normalized.endsWith('.env.example') || normalized.startsWith('backend/test/')) continue;
    const content = fs.readFileSync(full, 'utf8');

    for (const pattern of secretPatterns) {
        if (pattern.regex.test(content)) problems.push(`${relative}: possible ${pattern.name}`);
    }

    const assignment = /(?:SUPABASE_SERVICE_ROLE_KEY|SESSION_SECRET)[ \t]*=[ \t]*([^\s'";]+)/gi;
    let match;
    while ((match = assignment.exec(content)) !== null) {
        const value = match[1].toLowerCase();
        if (!value || /replace|example|fake|test|harness|process\.env/.test(value)) continue;
        problems.push(`${relative}: possible committed secret assignment`);
    }
}

if (problems.length) {
    console.error('verify-secrets: possible credentials found:');
    problems.forEach(problem => console.error(`  ${problem}`));
    process.exit(1);
}

console.log(`verify-secrets: OK — ${listed.length} tracked/unignored file(s) scanned; no credential pattern found.`);
