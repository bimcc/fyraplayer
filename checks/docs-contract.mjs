import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'archive') return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? markdown(path) : extname(path) === '.md' ? [path] : [];
  });
}
const files = ['README.md', 'CHANGELOG.md', 'RELEASE_NOTES.md', 'THIRD_PARTY_NOTICES.md', '.kiro/steering/architecture.md'].map(p => resolve(root, p)).concat(markdown(resolve(root, 'docs')));
const errors = [];
let checked = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  for (const match of source.matchAll(/\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
    const target = decodeURIComponent(link.split(/[?#]/)[0]);
    if (!target) continue;
    checked++;
    if (!existsSync(resolve(dirname(file), target))) errors.push(relative(root, file) + ': ' + link);
  }
}
if (errors.length) throw new Error('Broken active documentation links:\n' + errors.join('\n'));
console.log('Documentation contract: ' + files.length + ' files, ' + checked + ' local links passed (archive bodies excluded).');
