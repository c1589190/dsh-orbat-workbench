import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../src/workspace.js';
import {createApplication} from '../src/application.js';
import {createToolDefinitions} from '../src/tools.js';

test('AI tool writes and UI dispatch share documents, revisions and audit history',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'orbat-tools-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const app=createApplication(await Workspace.open(join(dir,'data')),{artifactDir:join(dir,'artifacts')});
  const tools=createToolDefinitions(app);
  const create=tools.find(t=>t.name==='orbat_create');
  assert.ok(create);
  const r=await create.execute({name:'AI编制'},{agent:{id:'test-agent'},signal:new AbortController().signal});
  assert.equal(r.ok,true);
  const doc=app.state().documents[0];assert.equal(doc.name,'AI编制');
  assert.equal(app.state().changes.changes[0].actor.kind,'ai');
  await app.dispatch('transaction',{edits:[{documentId:doc.id,expectedRevision:1,operations:[{op:'rename',name:'人改名'}]}]},{kind:'human',name:'page'});
  const changes=await tools.find(t=>t.name==='orbat_changes').execute({since:1},{agent:{id:'test-agent'}});
  assert.equal(changes.changes[0].actor.kind,'human');
  assert.equal(changes.changes[0].documents[0].afterRevision,2);
});
