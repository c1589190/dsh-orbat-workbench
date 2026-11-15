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
export function coverageSummary(stats) {
  const coverage=stats?.coverage;
  if(!coverage)return {incomplete:false,unknown:0,ambiguous:0,estimated:0,text:''};
  const unknown=(coverage.personnel?.unknown||0)+(coverage.equipment?.unknown||0);
  const ambiguous=(coverage.personnel?.legacyAmbiguous||0)+(coverage.equipment?.legacyAmbiguous||0);
  const estimated=(coverage.personnel?.estimated||0)+(coverage.equipment?.estimated||0);
  const incomplete=unknown>0||ambiguous>0;
  return {incomplete,unknown,ambiguous,estimated,text:incomplete?('未知 '+unknown+' · 歧义 '+ambiguous):('已知 · 估计 '+estimated)};
}
export function editEquipmentItem(equipment,index,patch) {
  const list=JSON.parse(JSON.stringify(equipment||[]));
  if(!Number.isInteger(index)||index<0||index>=list.length)return list;
  const current={...list[index]};
  for(const [key,value] of Object.entries(patch||{})){
    if(value===undefined||value===null)delete current[key];else current[key]=value;
  }
  if(current.orbat&&Object.keys(current.orbat).length===0)delete current.orbat;
  list[index]=current;
  return list;
}
export function appendEquipmentItem(equipment,item) {
  const list=JSON.parse(JSON.stringify(equipment||[]));
  list.push({name:'新装备',count:0,...(item||{})});
  return list;
}
export function removeEquipmentItem(equipment,index) {
  const list=JSON.parse(JSON.stringify(equipment||[]));
  if(Number.isInteger(index)&&index>=0&&index<list.length)list.splice(index,1);
  return list;
}
export function setPersonnelEvidence(custom,status,source) {
  const next=custom&&typeof custom==='object'?JSON.parse(JSON.stringify(custom)):{};
  const orbat=next.orbat&&typeof next.orbat==='object'?next.orbat:{};
  if(status){
    const record={status};
    if(source&&typeof source==='object'&&Object.keys(source).length)record.source=source;
    orbat.version=1;orbat.personnel=record;next.orbat=orbat;
  }else if(orbat.personnel){
    delete orbat.personnel;
    if(Object.keys(orbat).length<=1)delete next.orbat;
  }
  return next;
}
export function planStaleDocuments(plan,documents) {
  const revisions=new Map((documents||[]).map(doc=>[doc.id,doc.revision]));
  return (plan?.edits||[]).filter(edit=>revisions.get(edit.documentId)!==edit.expectedRevision)
    .map(edit=>({documentId:edit.documentId,expectedRevision:edit.expectedRevision,revision:revisions.get(edit.documentId)??null}));
}
export function planSummary(result) {
  const plan=result?.plan||result;
  return {documents:(plan?.edits||[]).length,operations:(plan?.edits||[]).reduce((sum,edit)=>sum+((edit.operations||[]).length),0),
    selectedNodes:result?.stats?.selectedNodes??0,diffs:(result?.diffs||[]).length,
    personnelBefore:result?.stats?.personnel?.before??null,personnelAfter:result?.stats?.personnel?.after??null,
    warnings:(result?.warnings||[]).length};
}
