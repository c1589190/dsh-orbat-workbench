import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {stats,TYPES,ECHELONS} from './model.js';
import {renderDocument} from './render.js';
import {queryNodes,compilePlan} from './batch.js';

const walk=(node,fn,path=[])=>{fn(node,path);for(const child of node.children || [])walk(child,fn,[...path,node.name]);};
const brief=doc=>({id:doc.id,name:doc.name,revision:doc.revision,stats:stats(doc.root)});
const keys=v=>Array.isArray(v)?v:Object.keys(v);
const errorResult=error=>({ok:false,error:{code:error.code || 'INVALID_ARGUMENT',message:error.message,details:error.details || {}}});

/** The UI and every AI tool call this same application, never separate editing implementations. */
export function createApplication(workspace,{artifactDir}) {
  const cache=new Map();
  const find=id=>{
    const doc=workspace.snapshot().documents.find(d=>d.id===id);
    if(!doc)throw Object.assign(new Error('找不到编制：'+id),{code:'NOT_FOUND'});
    return doc;
  };
  const select=ids=>{
    if(ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length>100))throw new Error('documentIds 必须为 1–100 个 id');
    return ids ? [...new Set(ids)].map(find) : workspace.snapshot().documents;
  };
  const api={
    state() {
      const snapshot=workspace.snapshot();
      return {sequence:snapshot.sequence,documents:snapshot.documents.map(d=>({...d,stats:stats(d.root)})),
        changes:workspace.changes(Math.max(0,snapshot.sequence-30),30),
        resources:workspace.resources(),
        capabilities:{types:keys(TYPES),echelons:keys(ECHELONS),upstream:'Army_Editor 1.8.0',previewModes:['editor','list'],experimental:true}};
    },
    subscribe(listener){return workspace.subscribe(listener);},
    exportData(ids,format='mil-org'){return workspace.export(ids,format);},
    preview(id,options={}) {
      const mode=options.mode === undefined ? 'editor' : options.mode;
      if(!['editor','list'].includes(mode))throw new Error('mode 必须是 editor 或 list');
      const doc=find(id);
      if(options.revision !== undefined && options.revision !== doc.revision)
        throw Object.assign(new Error('预览修订已变化，请重新生成图片'),{code:'CONFLICT'});
      const key=[id,doc.revision,options.nodeId || '',mode].join(':');
      if(cache.has(key))return cache.get(key);
      const value=renderDocument(doc,{nodeId:options.nodeId,mode});cache.set(key,value);
      while(cache.size>8)cache.delete(cache.keys().next().value);
      return value;
    },
    async dispatch(action,args={},actor) {
      try {
        if(!args || typeof args!=='object' || Array.isArray(args))throw new Error('参数必须是对象');
        if(!actor || !['human','ai'].includes(actor.kind))throw new Error('缺少可信来源');
        if(action==='workspace') {
          const snapshot=workspace.snapshot();
          return {ok:true,sequence:snapshot.sequence,documents:snapshot.documents.map(brief),changes:workspace.changes(args.since || 0,args.limit || 20),capabilities:api.state().capabilities};
        }
        if(action==='read') {
          const depth=args.depth ?? 4;
          if(!Number.isInteger(depth) || depth<0 || depth>24)throw new Error('depth 必须在 0–24');
          return {ok:true,sequence:workspace.snapshot().sequence,documents:select(args.documentIds).map(doc=>{
            let root=doc.root;
            if(args.nodeId){root=null;walk(doc.root,n=>{if(n.id===args.nodeId)root=n;});if(!root)throw new Error('找不到节点：'+args.nodeId);}
            let omitted=0;
            const project=(node,left)=>{
              if(!left){for(const child of node.children)walk(child,()=>omitted++);return {...node,children:[],hiddenChildren:node.children.length};}
              return {...node,children:node.children.map(n=>project(n,left-1))};
            };
            return {...brief(doc),root:project(root,depth),omitted,truncated:omitted>0};
          })};
        }
        if(action==='query') {
          const select0=args.select ?? {text:args.text,type:args.type,echelon:args.echelon,nodeIds:args.nodeIds};
          const result=queryNodes({documents:select(args.documentIds),select:select0,limit:args.limit ?? 100,cursor:args.cursor,sequence:workspace.snapshot().sequence});
          // Undefined values cannot cross the DSH canonical JSON boundary.
          return JSON.parse(JSON.stringify(result));
        }
        if(action==='plan') {
          return {ok:true,...compilePlan({documents:select(args.documentIds),sequence:workspace.snapshot().sequence,select:args.select ?? {},operation:args.operation,summary:args.summary,maxNodes:args.maxNodes})};
        }
        if(action==='commitPlan') {
          if(!args.plan || typeof args.plan!=='object' || Array.isArray(args.plan))throw new Error('plan 必须是对象');
          if(!Array.isArray(args.plan.edits))throw new Error('plan.edits 必须是数组');
          const result=await workspace.transaction({edits:args.plan.edits,summary:args.plan.summary,guards:args.plan.guards ?? args.guards},actor);
          return {...result,plan:{baseSequence:args.plan.baseSequence ?? null}};
        }
        if(action==='changes')return {ok:true,...workspace.changes(args.since ?? 0,args.limit ?? 50)};
        if(action==='resources')return {ok:true,...workspace.resources()};
        if(action==='updateResources')return await workspace.updateResources(args,actor);
        if(action==='create')return await workspace.create({name:args.name,root:args.root || {name:args.name || '新编制',type:'infantry',echelon:'battalion',children:[]}},actor);
        if(action==='duplicate') {
          const source=workspace.export([args.documentId],'mil-org');
          return await workspace.create({name:args.name || source.name+' 副本',root:source.data},actor);
        }
        if(action==='transaction')return await workspace.transaction(args,actor);
        if(action==='import')return await workspace.import(args.payload,actor);
        if(action==='validate')return {ok:true,documents:select(args.documentIds).map(doc=>({
          ...brief(doc),valid:true,warnings:['人数和装备字段为本级直属数量，不能重复填写含下属的总数。','装备数值未随单份编制导出；自定义装备仅保证名称显示，不保证兵棋能力。'],
        }))};
        if(action==='render') {
          const mode=args.mode === undefined ? 'editor' : args.mode;
          if(!['editor','list'].includes(mode))throw new Error('mode 必须是 editor 或 list');
          const documents=select(args.documentIds);
          if(documents.length>10)throw new Error('一次最多渲染 10 份，请分批');
          await mkdir(artifactDir,{recursive:true});const artifacts=[];
          for(const doc of documents){
            const r=api.preview(doc.id,{nodeId:args.nodeId,mode,revision:doc.revision}), stem=doc.id+'-r'+doc.revision+(args.nodeId?'-'+args.nodeId:'')+'-'+mode;
            const svgPath=join(artifactDir,stem+'.svg'),pngPath=join(artifactDir,stem+'.png');
            await Promise.all([writeFile(svgPath,r.svg,'utf8'),writeFile(pngPath,r.png)]);
            artifacts.push({documentId:doc.id,revision:doc.revision,mode,svgPath,pngPath,width:r.width,height:r.height,shown:r.shown,total:r.total,cards:r.cards,scale:r.scale,truncated:r.truncated,
              url:'/api/orbat-workbench/preview?id='+encodeURIComponent(doc.id)+'&format=png&mode='+encodeURIComponent(mode)+'&rev='+doc.revision+(args.nodeId?'&nodeId='+encodeURIComponent(args.nodeId):'')});
          }
          return {ok:true,artifacts,next:'使用 read_image 查看 pngPath；用 present 交付。预览是本工作台布局，非原站截图。'};
        }
        if(action==='export') {
          const ids=select(args.documentIds).map(d=>d.id),format=args.format || (ids.length===1?'mil-org':'mil-bundle');
          const {payload:data,losses}=workspace.exportCompatible(ids,format);await mkdir(artifactDir,{recursive:true});
          const path=join(artifactDir,'armies-'+workspace.snapshot().sequence+'-'+randomUUID().slice(0,8)+'.json');
          await writeFile(path,JSON.stringify(data,null,2),'utf8');
          return {ok:true,path,format,documentIds:ids,lossReport:losses,instructions:format==='mil-org'?'原编辑器：加载 → 从文件打开':'原编辑器：导入全部 → 加载相应存档；目录随包导出，别名/资料可能丢失'};
        }
        throw new Error('未知操作：'+action);
      }catch(error){return errorResult(error);}
    },
  };
  return api;
}
