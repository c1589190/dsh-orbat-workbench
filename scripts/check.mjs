import {readFile,access,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
for(const file of ['index.js','client.js',...(await readdir(join(root,'src'))).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)]){
  const r=spawnSync(process.execPath,['--check',join(root,file)],{encoding:'utf8'});
  if(r.status!==0)throw new Error(file+' syntax failed: '+r.stderr);
}
for(const file of ['cordis.patch.yml','skills/orbat-workbench/SKILL.md','README.md','icon.svg','LICENSE'])await access(join(root,file));
for(const lang of ['en','zh']){
  const d=JSON.parse(await readFile(join(root,'locale/'+lang+'.json'),'utf8'));
  if(!d.meta?.title || !d.meta?.description)throw new Error('Missing display metadata: '+lang);
}
if(pkg.dsh.bundle.patch!=='./cordis.patch.yml'||pkg.exports['./client']!=='./client.js')throw new Error('Invalid bundle wiring');
console.log('PASS: Host/Client syntax, package exports, required assets and bilingual metadata');
