import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist', 'x-cyber-profiler.user.js');
const HEADER = path.join(SRC, 'userscript.header');
const ORDER = [
  'constants.js',
  'selectors.js',
  'storage.js',
  'sample.js',
  'assess.js',
  'name.js',
  'queue.js',
  'providers.js',
  'llm.js',
  'extract.js',
  'observe.js',
  'render.js',
  'menu.js',
  'boot.js'
];

function fail(msg) {
  console.error('[assemble] ' + msg);
  process.exit(1);
}

function stripModule(file, text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('import ')) {
      if (!t.endsWith(';')) fail(`${file}:${i + 1} multi-line import is not allowed`);
      continue;
    }
    if (/^export\s*\{/.test(t)) fail(`${file}:${i + 1} export list is not allowed`);
    if (/^export\s+default\b/.test(t)) fail(`${file}:${i + 1} export default is not allowed`);
    if (/^export\s+(async\s+)?function\b/.test(t)) {
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    if (/^export\s+const\b/.test(t)) {
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    if (/^export\s+class\b/.test(t)) {
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    out.push(line);
  }
  const body = out.join('\n');
  if (/^\s*import\b/m.test(body)) fail(`${file}: import left after strip`);
  if (/^\s*export\b/m.test(body)) fail(`${file}: export left after strip`);
  return body.trimEnd();
}

function build() {
  const header = fs.readFileSync(HEADER, 'utf8').trimEnd();
  const parts = [];
  const seen = new Map();
  for (const name of ORDER) {
    const file = path.join(SRC, name);
    if (!fs.existsSync(file)) fail(`missing module: src/${name}`);
    const body = stripModule(name, fs.readFileSync(file, 'utf8'));
    for (const line of body.split('\n')) {
      if (/^\s/.test(line)) continue;
      const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
        || line.match(/^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      const decl = m[1];
      if (seen.has(decl)) {
        fail(`top-level name collision: "${decl}" in ${seen.get(decl)} and ${name}`);
      }
      seen.set(decl, name);
    }
    parts.push(`// ---- ${name} ----\n` + body);
  }
  return `${header}\n\n(function () {\n  'use strict';\n\n${parts.join('\n\n')}\n})();\n`;
}

const code = build();
if (process.argv.includes('--check')) {
  if (!fs.existsSync(DIST)) fail('dist is missing; run npm run build');
  const prev = fs.readFileSync(DIST, 'utf8');
  if (prev !== code) fail('dist is stale');
  console.log('[assemble] dist is up to date');
} else {
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  fs.writeFileSync(DIST, code);
  console.log(`[assemble] wrote ${path.relative(ROOT, DIST)} (${code.length} chars)`);
}
