import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNodePatch,mergeVisibleHistory,limitDiffText,runEditRequest,updateDraftRecovery} from '../src/client-policy.js';
import * as policy from '../src/client-policy.js';

test('saved preview results retain exact mode, revision, and link',()=>{
  assert.equal(typeof policy.savedPreviewSummary,'function');
  const value=policy.savedPreviewSummary({artifacts:[{documentId:'d1',revision:3,mode:'editor',url:'/api/orbat-workbench/preview?id=d1&mode=editor&rev=3'}]});
  assert.deepEqual(value,[{documentId:'d1',revision:3,mode:'editor',url:'/api/orbat-workbench/preview?id=d1&mode=editor&rev=3'}]);
  assert.deepEqual(policy.savedPreviewSummary(null),[]);
});

test('old host without mode capability is not presented as supporting editor mode',()=>{
  assert.equal(typeof policy.availablePreviewModes,'function');
  assert.deepEqual(policy.availablePreviewModes({}),[]);
  assert.deepEqual(policy.availablePreviewModes({previewModes:['editor','list']}),['editor','list']);
});

test('preview requests keep selected mode and focused subtree consistent',()=>{
  assert.equal(typeof policy.buildPreviewRequests,'function');
  const doc={id:'doc-1',revision:2};
  const full=policy.buildPreviewRequests(doc,['doc-1','doc-2'],'list',null);
  assert.deepEqual(full.preview,{id:'doc-1',format:'svg',rev:2,mode:'list'});
  assert.deepEqual(full.render,{documentIds:['doc-1','doc-2'],mode:'list'});
  const focused=policy.buildPreviewRequests(doc,['doc-1','doc-2'],'editor','node-1');
  assert.equal(focused.preview.nodeId,'node-1');
  assert.deepEqual(focused.render,{documentIds:['doc-1'],mode:'editor',nodeId:'node-1'});
});

test('editing personnel does not rewrite name or customName',()=>{
  const base={name:'自动编号',customName:false,personnel:9,equipment:[]};
  assert.deepEqual(buildNodePatch(base,{...base,personnel:10}),{personnel:10});
  assert.deepEqual(buildNodePatch(base,{...base,name:'手工番号'}),{name:'手工番号',customName:true});
});
test('loaded history keeps receiving live AI and human changes without duplicates',()=>{
  const list=mergeVisibleHistory([{sequence:1},{sequence:2}],[{sequence:2},{sequence:3,actor:{kind:'ai'}},{sequence:4,actor:{kind:'human'}}]);
  assert.deepEqual(list.map(c=>c.sequence),[1,2,3,4]);assert.equal(list.at(-1).actor.kind,'human');
});
test('large diff values report truncation rather than silently cutting text',()=>{
  const value=limitDiffText('x'.repeat(30),10);assert.equal(value.truncated,true);assert.equal(value.text.length,10);
  assert.equal(limitDiffText(null,10).truncated,false);
});
test('a completed old save cannot clear a new node draft',()=>{
  const current={documentId:'red',nodeId:'new',data:{name:'保留'}};
  assert.equal(updateDraftRecovery(current,false,{documentId:'blue',nodeId:'old'}),current);
  assert.equal(updateDraftRecovery(current,false,{documentId:'red',nodeId:'new'}),null);
});
test('a conflict refreshes state before returning failure and retains the original error',async()=>{
  let revision=1;
  const result=await runEditRequest(async()=>{throw Object.assign(new Error('stale'),{code:'CONFLICT'});},async()=>{revision=2;return {sequence:3};});
  assert.equal(revision,2);assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');
});
