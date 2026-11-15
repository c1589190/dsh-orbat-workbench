import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {apply} from '../index.js';

async function host(t) {
  const dir=await mkdtemp(join(tmpdir(),'orbat-host-test-')),routes=[],cleanups=[],abort=new AbortController();
  const ctx={tools:{register(){}},skills:{registerProvider(factory){factory({signal:abort.signal,invalidate(){}});}},systemPrompt:{section(){},context(){}},
    webServer:{getOrigin:()=> 'http://127.0.0.1:3080'},logger:{warn(){}},
    connection:{browserPeer:{principal:{kind:'owner'}},fetch:{register(route){routes.push(route);return async()=>{};}}},effect(setup){cleanups.push(setup());}};
  t.after(async()=>{abort.abort();for(const clean of cleanups.reverse())await clean?.();await rm(dir,{recursive:true,force:true});});
  await apply(ctx,{dataDir:join(dir,'data'),artifactDir:join(dir,'artifacts')});
  return routes;
}

// Characterization of DSH 0.2.2-rc.3's real bridge: streaming always supplies body.
// This pins our route declaration to Node's Request behavior, not just our resource.
const bridgeRequest=(route,method)=>new Request('http://127.0.0.1:3080'+route.path,{
  method,...(route.requestBody==='streaming'?{body:new ReadableStream({start(c){c.close();}}),duplex:'half'}:{}),
});
test('registered GET state works with the DSH bridge Request construction',async t=>{
  const routes=await host(t),route=routes.find(r=>r.path.endsWith('/state'));
  const request=bridgeRequest(route,'GET');
  const result=await route.fetch(request);assert.equal(result.status,200);assert.equal((await result.json()).sequence,0);
});
test('registered GET preview reaches application lookup rather than failing body construction',async t=>{
  const routes=await host(t),route=routes.find(r=>r.path.endsWith('/preview'));
  const req=bridgeRequest(route,'GET');const r=await route.fetch(new Request(req.url+'?id=missing&format=png'));
  assert.equal(r.status,400);assert.match((await r.json()).error.message,/找不到/);
});
test('SSE is not admitted for HEAD and POST retains streaming body limits',async t=>{
  const routes=await host(t);
  assert.equal(routes.find(r=>r.path.endsWith('/events')).methods.includes('HEAD'),false);
  assert.equal(routes.find(r=>r.path.endsWith('/action')).requestBody,'streaming');
});
