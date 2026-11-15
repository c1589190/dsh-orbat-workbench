import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpResource } from '../src/http.js';

const actorCalls = [];
const app = {
  state: () => ({sequence: 2, documents: []}),
  dispatch: async (action, args, actor) => { actorCalls.push(actor); return {ok:true, action, args, actor}; },
  preview: () => ({svg:'<svg/>', png:Buffer.from([137,80,78,71]), width:1,height:1}),
  exportData: () => ({kind:'mil-org',data:{type:'infantry',echelon:'squad'}}),
  subscribe: () => () => {},
};
const resource = createHttpResource(app, {origin:'http://127.0.0.1:3080'});
const request = (path, options) => new Request('http://127.0.0.1:3080/api/orbat-workbench'+path, options);
const owner = {principal:{kind:'owner'}};

test('state rejects missing or non-owner peer', async () => {
  assert.equal((await resource(request('/state'))).status,403);
  assert.equal((await resource(request('/state'),{principal:{kind:'guest'}})).status,403);
});
test('state provides a non-cacheable real application snapshot', async () => {
  const r=await resource(request('/state'), owner);
  assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual(await r.json(),{sequence:2,documents:[]});
});
test('mutations reject cross-origin requests before dispatch', async () => {
  const r=await resource(request('/action',{method:'POST',headers:{'origin':'https://evil.example','content-type':'application/json'},body:JSON.stringify({action:'create'})}), owner);
  assert.equal(r.status,403);
});
test('mutations cannot spoof AI identity in JSON body', async () => {
  const r=await resource(request('/action',{method:'POST',headers:{'origin':'http://127.0.0.1:3080','content-type':'application/json','x-orbat-client':'test-tab'},body:JSON.stringify({action:'create',args:{name:'示例'},actor:{kind:'ai'}})}),owner);
  assert.equal(r.status,200); const d=await r.json();
  assert.equal(d.actor.kind,'human'); assert.equal(d.actor.name,'test-tab');
});
test('malformed JSON is a structured domain error', async () => {
  const r=await resource(request('/action',{method:'POST',headers:{'origin':'http://127.0.0.1:3080','content-type':'application/json'},body:'{broken'}),owner);
  assert.equal(r.status,400); assert.equal((await r.json()).ok,false);
});
test('unsupported methods and traversal paths do not expose files', async () => {
  assert.equal((await resource(request('/state',{method:'DELETE'}),owner)).status,405);
  assert.equal((await resource(request('/preview?id=..%2fsecret&format=svg'),owner)).status,400);
});
test('PNG and JSON export have correct content types and disposition', async () => {
  const r=await resource(request('/preview?id=army-1&format=png'),owner);
  assert.equal(r.headers.get('content-type'),'image/png');
  const e=await resource(request('/export?ids=army-1&format=mil-org'),owner);
  assert.equal((await e.json()).kind,'mil-org'); assert.match(e.headers.get('content-disposition'),/attachment/);
});
