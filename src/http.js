const BASE = '/api/orbat-workbench';
const MAX_BODY = 2 * 1024 * 1024;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},
});
const fail = (code, message, status = 400) => json({ok:false,error:{code,message}},status);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

/** Resource lives behind DSH's normal connection admission. Mutations also require a same-origin JSON request. */
export function createHttpResource(app, {origin}) {
  const connections = new Set();
  const resource = async (request, peer) => {
    if (peer?.principal?.kind !== 'owner') return fail('FORBIDDEN','Owner access required',403);
    const url = new URL(request.url);
    const path = url.pathname.slice(BASE.length);
    try {
      if (path === '/action') {
        if (request.method !== 'POST') return fail('METHOD','Use POST',405);
        if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') return fail('ORIGIN','Same-origin request required',403);
        if (!(request.headers.get('content-type') || '').startsWith('application/json')) return fail('CONTENT_TYPE','Expected application/json',415);
        if (Number(request.headers.get('content-length')) > MAX_BODY) return fail('TOO_LARGE','Body exceeds 2 MiB',413);
        const reader = request.body?.getReader(); let size=0; const parts=[];
        if (reader) {
          while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BODY) { await reader.cancel(); return fail('TOO_LARGE','Body exceeds 2 MiB',413); } parts.push(value); }
        }
        let payload;
        try { payload=JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return fail('JSON','Invalid JSON'); }
        const actor={kind:'human',name:(request.headers.get('x-orbat-client') || '网页用户').slice(0,80)};
        const result=await app.dispatch(payload.action,payload.args || {},actor);
        return json(result,result.ok === false ? (result.error?.code==='CONFLICT'?409:400) : 200);
      }
      if (!['GET','HEAD'].includes(request.method)) return fail('METHOD','Use GET',405);
      if (path === '/state') return json(app.state());
      if (path === '/events') {
        if (connections.size >= 24) return fail('CONNECTION_LIMIT','Too many open workbench streams',429);
        let unsubscribe, heartbeat, closed=false, controllerRef;
        const close=()=>{if(closed)return;closed=true;unsubscribe?.();clearInterval(heartbeat);connections.delete(close);try{controllerRef?.close();}catch{}};
        const body=new ReadableStream({
          start(controller) {
            controllerRef=controller;
            const send=value=>{if(closed)return;try{controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));}catch{close();}};
            unsubscribe=app.subscribe(change=>send({type:'change',sequence:change.sequence}));
            connections.add(close); send({type:'ready',sequence:app.state().sequence});
            heartbeat=setInterval(()=>{try{controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));}catch{close();}},20000); heartbeat.unref?.();
            request.signal.addEventListener('abort',close,{once:true});
            if(request.signal.aborted)close();
          }, cancel:close,
        });
        return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'}});
      }
      if (path === '/preview') {
        const id=url.searchParams.get('id'), format=url.searchParams.get('format') || 'svg';
        if(!validId(id) || !['svg','png'].includes(format))return fail('PATH','Invalid preview id or format');
        const nodeId=url.searchParams.get('nodeId') || undefined, mode=url.searchParams.get('mode') ?? 'editor';
        const revisionText=url.searchParams.get('rev');
        if(nodeId && !validId(nodeId))return fail('PATH','Invalid node id');
        if(!['editor','list'].includes(mode))return fail('PATH','Invalid display mode');
        if(revisionText !== null && (!/^[1-9]\d*$/.test(revisionText) || !Number.isSafeInteger(Number(revisionText))))return fail('PATH','Invalid revision');
        const revision=revisionText === null ? undefined : Number(revisionText);
        const result=app.preview(id,{nodeId,mode,revision});
        return new Response(format==='svg'?result.svg:result.png,{headers:{'content-type':format==='svg'?'image/svg+xml; charset=utf-8':'image/png','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"}});
      }
      if (path === '/export') {
        const ids=(url.searchParams.get('ids') || '').split(',').filter(Boolean);
        if(!ids.length || ids.length>100 || !ids.every(validId))return fail('PATH','Expected document ids');
        const data=app.exportData(ids,url.searchParams.get('format') || 'mil-org');
        const response=json(data);
        response.headers.set('content-disposition','attachment; filename="army-organization.json"');
        return response;
      }
      return fail('NOT_FOUND','Unknown workbench route',404);
    } catch(error) {
      return json({ok:false,error:{code:error.code || 'ERROR',message:error.message,details:error.details || {}}},error.code==='CONFLICT'?409:400);
    }
  };
  resource.dispose=()=>{for(const close of [...connections])close();};
  return resource;
}
