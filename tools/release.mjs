import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);

function bump(version, kind) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error('current version is not semver: ' + version);
  }
  if (kind === 'major') return `${parts[0] + 1}.0.0`;
  if (kind === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

const args = process.argv.slice(2);
const setIndex = args.indexOf('--set');
const pkg = JSON.parse(read('package.json'));
const current = pkg.version;
const next = setIndex >= 0
  ? (args[setIndex + 1] || '').trim()
  : bump(current, args[0] || 'patch');
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: node tools/release.mjs patch|minor|major | --set x.y.z');
  process.exit(1);
}

pkg.version = next;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
write('src/constants.js', read('src/constants.js').replace(/^  VERSION: '[^']+',/m, `  VERSION: '${next}',`));
write('src/userscript.header', read('src/userscript.header').replace(/^\/\/ @version\s+\S+/m, `// @version      ${next}`));

console.log(`[release] ${current} -> ${next}`);
for (const [label, cmd, cmdArgs] of [
  ['assemble', process.execPath, ['tools/assemble.mjs']],
  ['check-exports', process.execPath, ['tools/check-exports.mjs']],
  ['test', process.execPath, ['--test', ...fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => 'test/' + f)]],
  ['smoke', process.execPath, ['tools/smoke.mjs']],
  ['dist-check', process.execPath, ['tools/assemble.mjs', '--check']]
]) {
  console.log('[release] ' + label);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit' });
}
console.log(`[release] ${next} ready`);
console.log('[release] git add -A && git commit -m "release v' + next + '" && git push');
