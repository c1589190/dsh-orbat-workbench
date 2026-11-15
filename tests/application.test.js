import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../src/workspace.js';
import {createApplication} from '../src/application.js';

const root={name:'测试排',type:'infantry',echelon:'platoon',children:[{name:'一班',type:'infantry',echelon:'squad',personnel:9,children:[]}]};
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'orbat-app-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const w=await Workspace.open(join(dir,'data'));
  return createApplication(w,{artifactDir:join(dir,'artifacts')});
}
const human={kind:'human',name:'tab-A'};const ai={kind:'ai',name:'agent-A',sessionId:'session-A'};

test('shared application exposes human edits to AI with source and revision',async t=>{
  const app=await setup(t);const c=await app.dispatch('create',{name:'蓝方',root},human);
  assert.equal(c.ok,true);const doc=c.document;
  const result=await app.dispatch('transaction',{edits:[{documentId:doc.id,expectedRevision:1,operations:[{op:'update',nodeId:doc.root.children[0].id,fields:{personnel:10}}]}],summary:'AI补一名'},ai);
  assert.equal(result.ok,true);
  const state=app.state();assert.equal(state.documents[0].stats.personnel,10);
  const changes=await app.dispatch('changes',{since:0},ai);
  assert.deepEqual(changes.changes.map(c=>c.actor.kind),['human','ai']);
});
test('stale writes return conflict without dropping a human edit',async t=>{
  const app=await setup(t);const {document:doc}=await app.dispatch('create',{name:'蓝方',root},human);
  await app.dispatch('transaction',{edits:[{documentId:doc.id,expectedRevision:1,operations:[{op:'rename',name:'人类番号'}]}]},human);
  const stale=await app.dispatch('transaction',{edits:[{documentId:doc.id,expectedRevision:1,operations:[{op:'rename',name:'过期AI'}]}]},ai);
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'CONFLICT');
  assert.equal(app.state().documents[0].name,'人类番号');
});
test('query returns bounded matching node IDs and read can focus a subtree',async t=>{
  const app=await setup(t);const {document:doc}=await app.dispatch('create',{name:'蓝方',root},ai);
  const q=await app.dispatch('query',{documentIds:[doc.id],text:'一班'},ai);
  assert.equal(q.matches.length,1);assert.equal(q.matches[0].node.name,'一班');
  const read=await app.dispatch('read',{documentIds:[doc.id],nodeId:q.matches[0].node.id},ai);
  assert.equal(read.documents[0].root.personnel,9);
});
test('exports are id-free, and render saves a real PNG for read_image',async t=>{
  const app=await setup(t);const {document:doc}=await app.dispatch('create',{name:'蓝方',root},ai);
  const e=await app.dispatch('export',{documentIds:[doc.id]},ai);
  const data=JSON.parse(await readFile(e.path,'utf8'));assert.equal(data.kind,'mil-org');assert.equal(data.personnel,9);assert.equal(data.data.id,undefined);
  const r=await app.dispatch('render',{documentIds:[doc.id]},ai);
  const bytes=await readFile(r.artifacts[0].pngPath);assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const focused=await app.dispatch('render',{documentIds:[doc.id],nodeId:doc.root.children[0].id},ai);
  assert.equal(new URL(focused.artifacts[0].url,'http://localhost').searchParams.get('nodeId'),doc.root.children[0].id);
});
test('invalid actions are structured failures and do not mutate state',async t=>{
  const app=await setup(t);const r=await app.dispatch('write-any-file',{path:'/etc/passwd'},human);
  assert.equal(r.ok,false);assert.equal(app.state().documents.length,0);
});
