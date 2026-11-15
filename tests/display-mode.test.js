import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../src/workspace.js';
import {createApplication} from '../src/application.js';
import {createHttpResource} from '../src/http.js';
import {createToolDefinitions} from '../src/tools.js';

const actor={kind:'ai',name:'test'};
const owner={principal:{kind:'owner'}};
const origin='http://127.0.0.1:3080';
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'orbat-display-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const w=await Workspace.open(join(dir,'data'));
  const app=createApplication(w,{artifactDir:join(dir,'artifacts')});
  const created=await app.dispatch('create',{name:'示例',root:{name:'连部',type:'infantry',echelon:'company',layout:'h',children:[{name:'一排',type:'infantry',echelon:'platoon',children:[]}]}},actor);
  return {app,id:created.document.id};
}

test('application separates mode cache and rejects unsupported modes',async t=>{
  const {app,id}=await setup(t);
  assert.deepEqual(app.state().capabilities.previewModes,['editor','list']);
  const editor=app.preview(id,{mode:'editor'}),list=app.preview(id,{mode:'list'});
  assert.ok(editor!==list,'editor and list must not share the same cached object');
  assert.match(editor.svg,/data-mode="editor"/);
  assert.match(list.svg,/data-mode="list"/);
  assert.match(app.preview(id).svg,/data-mode="editor"/);
  assert.notEqual(editor.svg,list.svg);
  assert.strictEqual(app.preview(id,{mode:'editor'}),editor);
  assert.strictEqual(app.preview(id,{mode:'list'}),list);
  assert.throws(()=>app.preview(id,{mode:'bad'}),/mode|模式/i);
  assert.throws(()=>app.preview(id,{mode:null}),/mode|模式/i);
});

test('render writes mode-specific artifacts and matching links',async t=>{
  const {app,id}=await setup(t);
  const a=await app.dispatch('render',{documentIds:[id],mode:'editor'},actor);
  const b=await app.dispatch('render',{documentIds:[id],mode:'list'},actor);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.equal(a.artifacts[0].cards,2);
  assert.equal(a.artifacts[0].scale,1);
  assert.notEqual(a.artifacts[0].pngPath,b.artifacts[0].pngPath);
  assert.equal(new URL(a.artifacts[0].url,origin).searchParams.get('mode'),'editor');
  assert.equal(new URL(b.artifacts[0].url,origin).searchParams.get('mode'),'list');
  assert.equal((await readFile(a.artifacts[0].pngPath)).subarray(1,4).toString(),'PNG');
  const bad=await app.dispatch('render',{documentIds:[id],mode:'invalid'},actor);
  assert.equal(bad.ok,false);
});

test('render rejects an unsupported mode even in an empty workspace',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'orbat-empty-mode-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const app=createApplication(await Workspace.open(join(dir,'data')),{artifactDir:join(dir,'artifacts')});
  const result=await app.dispatch('render',{mode:'unknown'},actor);
  assert.equal(result.ok,false);
});

test('HTTP forwards mode and rejects unsupported preview mode',async t=>{
  const {app,id}=await setup(t);
  let seen;
  const preview=app.preview;
  app.preview=(...args)=>{seen=args[1];return preview(...args)};
  const http=createHttpResource(app,{origin});
  const request=mode=>new Request(`${origin}/api/orbat-workbench/preview?id=${id}&mode=${mode}&format=svg`);
  const list=await http(request('list'),owner);
  assert.equal(list.status,200);
  assert.match(await list.text(),/data-mode="list"/);
  assert.equal(seen.mode,'list');
  const editor=await http(request('editor'),owner);
  assert.equal(editor.status,200);
  assert.match(await editor.text(),/data-mode="editor"/);
  assert.equal((await http(request('invalid'),owner)).status,400);
});

test('render pins its selected revision before writing a named artifact',async t=>{
  const {app,id}=await setup(t);
  const preview=app.preview;
  let revision;
  app.preview=(docId,opts)=>{revision=opts.revision;return preview(docId,opts);};
  const result=await app.dispatch('render',{documentIds:[id],mode:'editor'},actor);
  assert.equal(result.ok,true);
  assert.equal(revision,result.artifacts[0].revision);
});

test('artifact preview links refuse to silently display a different revision',async t=>{
  const {app,id}=await setup(t);
  const rendered=await app.dispatch('render',{documentIds:[id],mode:'list'},actor);
  const artifact=rendered.artifacts[0];
  const link=new URL(artifact.url,origin);
  assert.equal(link.searchParams.get('rev'),'1');
  const http=createHttpResource(app,{origin});
  assert.equal((await http(new Request(link),owner)).status,200);
  await app.dispatch('transaction',{edits:[{documentId:id,expectedRevision:1,operations:[{op:'rename',name:'更新番号'}]}]},actor);
  assert.equal((await http(new Request(link),owner)).status,409);
});

test('orbat_render publishes the display-mode option',()=>{
  const tool=createToolDefinitions({}).find(t=>t.name==='orbat_render');
  assert.deepEqual(tool.parameters.properties.mode.enum,['editor','list']);
});
