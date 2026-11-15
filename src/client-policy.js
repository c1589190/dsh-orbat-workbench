/** Pure collaboration policies shared verbatim with the generated browser artifact. */
export function availablePreviewModes(capabilities) {
  return Array.isArray(capabilities?.previewModes)
    ? ['editor','list'].filter(mode=>capabilities.previewModes.includes(mode)) : [];
}
export function savedPreviewSummary(result) {
  return Array.isArray(result?.artifacts) ? result.artifacts
    .filter(item=>typeof item?.url==='string' && item.url.startsWith('/api/orbat-workbench/preview?'))
    .map(({documentId,revision,mode,url})=>({documentId,revision,mode,url})) : [];
}
export function buildPreviewRequests(doc,ids,mode,focusedNodeId) {
  return {
    preview:{id:doc.id,format:'svg',rev:doc.revision,mode,...(focusedNodeId?{nodeId:focusedNodeId}:{})},
    render:{documentIds:focusedNodeId?[doc.id]:ids,mode,...(focusedNodeId?{nodeId:focusedNodeId}:{})},
  };
}
export function buildNodePatch(base,draft) {
  const fields={};
  for(const key of ['name','type','echelon','personnel','personnelMax','equipment','remark']) {
    if(draft[key]!==undefined && JSON.stringify(base[key])!==JSON.stringify(draft[key]))fields[key]=draft[key];
  }
  if(Object.hasOwn(fields,'name'))fields.customName=true;
  return fields;
}
export function mergeVisibleHistory(loaded,latest) {
  const records=new Map();for(const change of [...(loaded || []),...(latest || [])])records.set(change.sequence,change);
  return [...records.values()].sort((a,b)=>a.sequence-b.sequence);
}
export function limitDiffText(value,maxChars=2000) {
  const raw=JSON.stringify(value ?? null,null,2);
  return {text:raw.slice(0,maxChars),truncated:raw.length>maxChars};
}
export function updateDraftRecovery(previous,dirty,value) {
  if(dirty&&value)return value;
  if(!dirty&&(!value||(previous?.documentId===value.documentId&&previous?.nodeId===value.nodeId)))return null;
  return previous;
}
export async function runEditRequest(operation,refresh) {
  try{const result=await operation();await refresh();return {ok:true,result};}
  catch(error){
    if(error.code==='CONFLICT'){try{await refresh();}catch(refreshError){error.refreshError=refreshError.message;}}
    return {ok:false,error};
  }
}
