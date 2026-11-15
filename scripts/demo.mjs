import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {Workspace} from '../src/workspace.js';
import {createApplication} from '../src/application.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const workspace=await Workspace.open(join(root,'.workbench'));
const app=createApplication(workspace,{artifactDir:join(root,'artifacts')});
const ai={kind:'ai',name:'演示脚本 · AI通道'},human={kind:'human',name:'演示脚本 · 模拟网页用户'};
const unit=(name,echelon,personnel,children=[])=>({name,type:'infantry',echelon,personnel,children,customName:true,stack:false,equipment:echelon==='squad'?[{name:'突击步枪',count:8},{name:'轻机枪',count:1}]:[]});
const battalion=name=>unit(name,'battalion',6,Array.from({length:2},(_,c)=>unit((c+1)+'连','company',3,Array.from({length:2},(_,p)=>unit((p+1)+'排','platoon',2,Array.from({length:3},(_,s)=>unit((s+1)+'班','squad',9)))))));
const must=r=>{if(!r.ok)throw new Error(JSON.stringify(r.error));return r;};
if(!workspace.snapshot().documents.length){
  must(await app.dispatch('create',{name:'蓝方 · 青松步兵营',root:battalion('青松营')},ai));
  must(await app.dispatch('create',{name:'红方 · 赤岩步兵营',root:battalion('赤岩营')},ai));
  let [blue]=workspace.snapshot().documents;
  must(await app.dispatch('transaction',{edits:[{documentId:blue.id,expectedRevision:blue.revision,operations:[{op:'update',nodeId:blue.root.children[0].children[0].children[1].id,fields:{name:'青松尖兵班',remark:'预置演示：模拟人类修改，AI随后保留此番号。'}}]}],summary:'预置演示：模拟人类给第二班改名'},human));
  const docs=workspace.snapshot().documents;
  const collect=(n,out=[])=>{if(n.echelon==='squad')out.push(n);for(const c of n.children)collect(c,out);return out;};
  must(await app.dispatch('transaction',{edits:docs.map(d=>({documentId:d.id,expectedRevision:d.revision,operations:collect(d.root).map(n=>({op:'update',nodeId:n.id,fields:{personnel:10}}))})),summary:'预置演示：AI一次补齐两营24个班，每班9→10，保留人类番号'},ai));
  console.log('Seeded 2 armies with clearly labeled simulated human / AI history.');
}else console.log('Existing workspace preserved; no seed changes applied.');
const docs=workspace.snapshot().documents.slice(0,2);
const previews=must(await app.dispatch('render',{documentIds:docs.map(d=>d.id)},ai));
await mkdir(join(root,'artifacts'),{recursive:true});
for(let i=0;i<previews.artifacts.length;i++){
  await copyFile(previews.artifacts[i].pngPath,join(root,'artifacts',i?'demo-red.png':'demo-blue.png'));
  await copyFile(previews.artifacts[i].svgPath,join(root,'artifacts',i?'demo-red.svg':'demo-blue.svg'));
}
const exportResult=must(await app.dispatch('export',{documentIds:docs.map(d=>d.id),format:docs.length>1?'mil-bundle':'mil-org'},ai));
await copyFile(exportResult.path,join(root,'artifacts/demo-armies.json'));
await writeFile(join(root,'artifacts/demo-manifest.json'),JSON.stringify({documents:docs.map(d=>({id:d.id,name:d.name,revision:d.revision})),sequence:workspace.snapshot().sequence,previews:previews.artifacts,exportPath:join(root,'artifacts/demo-armies.json')},null,2));
console.log(JSON.stringify({sequence:workspace.snapshot().sequence,documents:app.state().documents.map(d=>({name:d.name,revision:d.revision,stats:d.stats})),artifacts:previews.artifacts.map(a=>({pngPath:a.pngPath,shown:a.shown,total:a.total}))},null,2));
