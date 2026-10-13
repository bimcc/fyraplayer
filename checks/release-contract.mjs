import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');
const pkg=JSON.parse(read('package.json'));
assert.match(pkg.version,/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,'Expected an explicit release version');
assert(read('CHANGELOG.md').includes('## '+pkg.version),'Changelog must describe this version');
assert(read('RELEASE_NOTES.md').startsWith('# FyraPlayer '+pkg.version+'\n'),'Release notes/version mismatch');
for(const name of ['README.md','docs/README.md','docs/api.md'])assert(read(name).includes(pkg.version),name+' version mismatch');
assert.equal(pkg.publishConfig.access,'public');
assert.equal(pkg.publishConfig.tag,pkg.version.includes('-')?'next':'latest','Prereleases must not replace latest');
for(const [name,entry] of Object.entries(pkg.exports))if(typeof entry==='object'){
  assert.equal(Object.keys(entry)[0],'types',name+' must expose its types before runtime conditions');
  assert(entry.import && entry.types,name+' requires JS and declaration entries');
}
for(const name of ['LICENSE','RELEASE_NOTES.md','THIRD_PARTY_NOTICES.md'])assert(pkg.files.includes(name),name+' must ship');
assert(!pkg.dependencies.fyraklv,'KLV parsing remains external');
console.log('Release metadata: '+pkg.version+', '+pkg.publishConfig.tag+' tag, notes and export conditions passed.');
