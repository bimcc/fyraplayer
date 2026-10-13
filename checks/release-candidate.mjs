import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, createWriteStream} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version))throw new Error('Invalid version');
const pnpm=process.env.npm_execpath;
if(!pnpm || !existsSync(pnpm) || !/pnpm/.test(pnpm))throw new Error('Run with pnpm release:candidate');
const npm=[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
if(!npm)throw new Error('npm CLI not found next to Node');
const parent=join(root,'.fyra-releases');mkdirSync(parent,{recursive:true});
const output=mkdtempSync(join(parent,pkg.version+'-'));
const manifest={name:pkg.name,version:pkg.version,tag:pkg.publishConfig.tag,createdAt:new Date().toISOString(),status:'preparing',
  environment:{node:process.version,platform:process.platform,arch:process.arch,packageManager:pkg.packageManager},checks:[],
  browserValidation:'pending; browser reports must identify this tarball SHA-256',published:false};
const save=()=>writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const digest=(data,kind='sha256',encoding='hex')=>createHash(kind).update(data).digest(encoding);
function snapshot(){
  const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const files=[...new Set(names)].sort().filter(name=>existsSync(join(root,name))).map(path=>({path,sha256:digest(readFileSync(join(root,path)))}));
  return {files,sha256:digest(JSON.stringify(files))};
}
async function run(label,command,args){
  console.log('Candidate: '+label);
  const log=createWriteStream(join(output,label+'.log'));
  const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);}).finally(()=>new Promise(done=>log.end(done)));
  manifest.checks.push({name:label,exitCode:code,log:label+'.log'});save();
  if(code!==0)throw new Error(label+' failed; see '+join(output,label+'.log'));
}
save();
try{
  const before=snapshot();
  manifest.source={gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),sha256:before.sha256,
    lockfileSha256:digest(readFileSync(join(root,'pnpm-lock.yaml'))),inventory:'source-inventory.json'};
  writeFileSync(join(output,'source-inventory.json'),JSON.stringify(before.files,null,2)+'\n');save();
  await run('release-check',process.execPath,[pnpm,'check:release']);
  const [pack]=JSON.parse(execFileSync(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination',output],{cwd:root,encoding:'utf8'}));
  const archive=join(output,pack.filename),bytes=readFileSync(archive);
  manifest.package={filename:pack.filename,bytes:bytes.length,unpackedBytes:pack.unpackedSize,files:pack.files.length,
    sha256:digest(bytes),integrity:'sha512-'+digest(bytes,'sha512','base64')};
  if(manifest.package.integrity!==pack.integrity)throw new Error('npm integrity mismatch');
  writeFileSync(join(output,'pack.json'),JSON.stringify(pack,null,2)+'\n');
  writeFileSync(join(output,'SHA256SUMS'),manifest.package.sha256+'  '+pack.filename+'\n');save();
  await run('candidate-consumer',process.execPath,[join(root,'checks/package-consumer.mjs'),archive]);
  if(snapshot().sha256!==before.sha256)throw new Error('Source changed during candidate preparation; generate a fresh candidate');
  manifest.status='package-verified';manifest.completedAt=new Date().toISOString();save();
  console.log('Candidate prepared: '+output+'\nTarball SHA-256: '+manifest.package.sha256+'\nBrowser/device evidence and review remain explicit release steps.');
}catch(error){manifest.status='failed';manifest.error=String(error);save();throw error;}
