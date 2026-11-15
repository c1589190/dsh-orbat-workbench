window.__ModuleLoader__.load({
  id:'@local/dsh-orbat-workbench',
  factory(require) {
    /* ORBAT_CLIENT_POLICY */
    const React=require('react'),h=React.createElement;
    const {useState,useEffect,useCallback,useRef}=React;
    const zh={title:'编制协作',subtitle:'实验性 · 人与 AI 共用一份数据',new:'新建编制',import:'导入 JSON',export:'导出所选',png:'PNG 预览',batch:'批量编辑',copy:'复制编制',removeDoc:'删除编制',name:'名称',type:'兵种',echelon:'层级',personnel:'本级直属人数',equipment:'装备（JSON 数组）',remark:'备注',save:'保存修改',reload:'重新载入（丢弃草稿）',draft:'有未保存草稿',remote:'远端已更新；草稿保留。请先核对，旧修订保存会报冲突。',tree:'节点树',preview:'编制图预览',history:'修改记录',human:'人类',ai:'AI',empty:'还没有编制。新建或导入一份，也可以在对话中请 AI 创建。',connected:'实时连接',offline:'连接中断 / 重连中',add:'添加下属',remove:'删除节点',move:'移动到',close:'关闭',apply:'提交批量事务',filter:'目标层级',delta:'每个匹配节点增加人数',batchRemark:'统一修改根节点备注',cancel:'取消',root:'根节点',count:'添加数量',fresh:'当前修订',direct:'人数与装备为本级直属数量，上级总数会自动累加。',boundary:'此页与 AI 实时共享；原 GitHub 编辑器只通过 JSON 交换，不自动同步。',discard:'当前有未保存草稿，确定丢弃并切换？',deleteConfirm:'确认删除？本次操作会记录在历史中。',load:'载入历史首批',more:'下一批',source:'来源',search:'搜索名称',rename:'重命名编制',exportHint:'单份使用“从文件打开”；多份包使用原编辑器“导入全部”。',instructions:'在对话中输入 /orbat-workbench，或请 AI 同时修改所选编制并渲染预览。',form:'节点属性',busy:'处理中…',revision:'修订',compare:'查看字段差异',focus:'聚焦节点图',all:'全部编制图'};
    const en={...zh,title:'ORBAT workbench',subtitle:'Experimental · shared human–AI state',new:'New army',import:'Import JSON',export:'Export selected',png:'PNG preview',batch:'Batch edit',copy:'Duplicate army',removeDoc:'Delete army',name:'Name',type:'Type',echelon:'Echelon',personnel:'Direct personnel',equipment:'Equipment (JSON array)',remark:'Remark',save:'Save changes',reload:'Reload (discard draft)',draft:'Unsaved draft',remote:'Remote revision changed. Draft retained; stale writes will conflict.',tree:'Unit tree',preview:'Organization preview',history:'Change history',human:'Human',ai:'AI',empty:'No armies yet. Create, import, or ask the AI to create one.',connected:'Live',offline:'Disconnected / reconnecting',add:'Add children',remove:'Delete unit',move:'Move under',close:'Close',apply:'Commit batch transaction',filter:'Target echelon',delta:'Add personnel to each matching unit',batchRemark:'Set all root remarks',cancel:'Cancel',root:'Root',count:'Copies',fresh:'Current revision',direct:'Personnel and equipment are direct quantities; descendants are added automatically.',boundary:'This page shares live state with AI; the public GitHub editor exchanges JSON files only.',discard:'Discard the unsaved draft and switch?',deleteConfirm:'Delete this item? The action is recorded in history.',load:'Load first history page',more:'Next page',source:'Source',search:'Search names',rename:'Rename army',exportHint:'Single: Open from file. Multiple: Import all in the upstream editor.',instructions:'Use /orbat-workbench in chat, or ask AI to edit multiple armies and render previews.',form:'Unit properties',busy:'Working…',revision:'Revision',compare:'Field differences',focus:'Focus selected subtree',all:'Full organization'};
    Object.assign(zh,{recovery:'保留的未保存草稿',recoveryMissing:'远端可能已删除或替换该节点。草稿JSON保留在此，请复制后再切换或丢弃；不会自动应用到其他节点。',discardRecovery:'丢弃恢复草稿',historyGap:'当前历史显示含未加载区间；实时更新仍继续合并。请用下一批/变化工具补读。',diffTruncated:'差异列表仅显示前',valueTruncated:'字段值已截断；完整值请用 orbat_changes / orbat_read 读取。'});
    Object.assign(en,{recovery:'Retained unsaved draft',recoveryMissing:'The remote node may have been deleted or replaced. Copy this draft JSON before switching or discarding; it is never applied to another node automatically.',discardRecovery:'Discard recovery draft',historyGap:'Some history ranges are not loaded. Live updates are still merged; load further pages for details.',diffTruncated:'Showing only the first diffs:',valueTruncated:'Value truncated. Use orbat_changes / orbat_read for the full value.'});
    Object.assign(zh,{saveSelected:'生成所选预览',saveFocus:'生成当前聚焦预览',savedPreview:'已生成预览',displayMode:'显示模式',editorMode:'兵牌编制图',listMode:'列表',oldHost:'当前服务仍在运行旧版渲染器；重启宿主并刷新页面后才可切换新样式。'});
    Object.assign(en,{saveSelected:'Generate selected previews',saveFocus:'Generate focused preview',savedPreview:'Generated previews',displayMode:'Display mode',editorMode:'Unit card chart',listMode:'List',oldHost:'The host is still using the previous renderer. Restart the host and refresh to enable new display modes.'});
    const labels={army:'集团军',corps:'军',division:'师',brigade:'旅',regiment:'团',battalion:'营',company:'连',platoon:'排',section:'分队',squad:'班',team:'火力组',individual:'单兵'};
    const CSS=`.orbat-wb{height:100%;overflow:auto;padding:22px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;box-sizing:border-box}.orbat-wb *{box-sizing:border-box}.orbat-wb h1{font-size:22px;margin:0 0 4px}.orbat-wb h2{font-size:14px;margin:0 0 12px}.orbat-wb p{color:var(--dsw-alias-label-secondary);line-height:1.6}.orbat-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.orbat-wb button,.orbat-wb input,.orbat-wb select,.orbat-wb textarea,.orbat-link{font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);padding:7px 9px}.orbat-wb button,.orbat-link{cursor:pointer;text-decoration:none}.orbat-wb button:disabled{opacity:.5;cursor:not-allowed}.orbat-wb button:focus-visible,.orbat-wb input:focus-visible,.orbat-wb textarea:focus-visible,.orbat-wb select:focus-visible,.orbat-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.orbat-wb button.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.orbat-wb .danger,.orbat-error{color:var(--dsw-alias-state-error-primary)}.orbat-grid{display:grid;grid-template-columns:220px minmax(300px,1fr) 320px;gap:14px}.orbat-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px;min-width:0}.orbat-army{display:flex;align-items:center;gap:6px;margin:6px 0}.orbat-army button{flex:1;text-align:left;min-width:0;overflow-wrap:anywhere}.orbat-army.selected button{border-color:var(--dsw-alias-brand-primary)}.orbat-mini{font-size:11px;color:var(--dsw-alias-label-secondary)}.orbat-stat{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}.orbat-preview{overflow:auto;max-height:620px;background:var(--dsw-alias-bg-layer-2);border-radius:8px}.orbat-preview img{display:block;max-width:none;width:auto;height:auto}.orbat-tree{max-height:350px;overflow:auto;margin:10px 0}.orbat-tree button{display:block;width:100%;text-align:left;border-color:var(--dsw-alias-border-l1);margin:3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.orbat-tree button.active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.orbat-field{display:block;margin:10px 0}.orbat-field span{display:block;font-size:12px;margin-bottom:5px;color:var(--dsw-alias-label-secondary)}.orbat-field input,.orbat-field select,.orbat-field textarea{width:100%;background:var(--dsw-alias-bg-base)}.orbat-field textarea{min-height:72px;resize:vertical}.orbat-notice{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:10px 12px;border-radius:8px;margin:10px 0;line-height:1.6;overflow-wrap:anywhere}.orbat-warn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}.orbat-tag{font-size:10px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;display:inline-block;margin-right:5px}.orbat-live{color:var(--dsw-alias-state-success-primary)}.orbat-history{margin-top:14px;max-height:440px;overflow:auto}.orbat-event{padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.orbat-event pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:var(--dsw-alias-bg-layer-2);padding:7px}.orbat-batch{margin-bottom:14px;border-color:var(--dsw-alias-brand-primary)}@media(max-width:1200px){.orbat-grid{grid-template-columns:200px minmax(300px,1fr)}.orbat-properties{grid-column:1/-1}}@media(max-width:760px){.orbat-wb{padding:12px}.orbat-grid{grid-template-columns:1fr}.orbat-properties{grid-column:auto}.orbat-preview{max-height:440px}}`;
    const flatten=root=>{const out=[];const walk=(node,depth)=>{out.push({node,depth});for(const c of node.children || [])walk(c,depth+1);};if(root)walk(root,0);return out;};
    const field=(label,control)=>h('label',{className:'orbat-field'},h('span',null,label),control);
    const json=value=>JSON.stringify(value,null,2);
    const clientId='网页-'+Math.random().toString(36).slice(2,7);
    const endpoint=(path,params)=>'/api/orbat-workbench/'+path+(params?'?'+new URLSearchParams(params):'');
    async function action(name,args){
      const r=await fetch(endpoint('action'),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-orbat-client':clientId},body:JSON.stringify({action:name,args})});
      const result=await r.json();if(result.ok===false)throw Object.assign(new Error(result.error?.code+': '+result.error?.message),{details:result.error?.details,code:result.error?.code});return result;
    }
    function Icon({size=22}){return h('svg',{width:size,height:size,viewBox:'0 0 36 36',fill:'none','aria-hidden':true},h('path',{d:'M18 13v6M7 19h22M7 19v4M18 19v4M29 19v4',stroke:'currentColor',strokeWidth:1.8}),...[{x:13,y:5},{x:2,y:24},{x:13,y:24},{x:24,y:24}].map((p,i)=>h('rect',{key:i,...p,width:10,height:7,rx:1,stroke:'currentColor',strokeWidth:1.8})));}
    function NodeEditor({doc,node,capabilities,t,act,onDraft,reload,blocked}) {
      const [draft,setDraft]=useState(null),[basis,setBasis]=useState(doc.revision),[dirty,setDirty]=useState(false),[remote,setRemote]=useState(false);
      const baseNode=useRef(node);
      const [addName,setAddName]=useState('新单位'),[addCount,setAddCount]=useState(1),[addEch,setAddEch]=useState('squad'),[parent,setParent]=useState('');
      const reset=(freshDoc=doc,freshNode=node,explicit=false)=>{baseNode.current=freshNode;setDraft({...freshNode,equipmentText:json(freshNode.equipment || [])});setBasis(freshDoc.revision);setDirty(false);setRemote(false);if(explicit)onDraft(false,{documentId:doc.id,nodeId:node.id});};
      useEffect(()=>{if(!dirty)reset();else if(doc.revision!==basis)setRemote(true);},[doc.revision]);
      if(!draft)return h('p',null,t('busy'));
      const update=(key,value)=>{const next={...draft,[key]:value};setDraft(next);setDirty(true);onDraft(true,{documentId:doc.id,nodeId:node.id,revision:basis,data:next});};
      const edit=operations=>act('transaction',{edits:[{documentId:doc.id,expectedRevision:basis,operations}],summary:'人类网页编辑：'+node.name});
      const save=async()=>{
        let equipment;try{equipment=JSON.parse(draft.equipmentText);}catch(error){await act('__local_error',{message:'装备 JSON: '+error.message});return;}
        const fields=buildNodePatch(baseNode.current,{name:draft.name,type:draft.type,echelon:draft.echelon,personnel:Number(draft.personnel),personnelMax:Number(draft.personnelMax || 0),equipment,remark:draft.remark || ''});
        if(!Object.keys(fields).length){setDirty(false);onDraft(false,{documentId:doc.id,nodeId:node.id});return;}
        const r=await edit([{op:'update',nodeId:node.id,fields}]);if(r){setDirty(false);onDraft(false,{documentId:doc.id,nodeId:node.id});setRemote(false);setBasis(r.documents?.find(d=>d.id===doc.id)?.revision || basis+1);}
      };
      const nextEch=capabilities.echelons[Math.min(capabilities.echelons.indexOf(node.echelon)+1,capabilities.echelons.length-1)];
      return h('fieldset',{disabled:blocked,style:{border:0,padding:0,minWidth:0}},
        h('h2',null,t('form')),h('div',{className:'orbat-mini'},node.id,' · ',t('revision'),' ',basis),
        dirty&&h('div',{className:'orbat-notice orbat-warn'},t('draft')),
        remote&&h('div',{className:'orbat-notice orbat-warn',role:'alert'},t('remote')),
        field(t('name'),h('input',{value:draft.name,onChange:e=>update('name',e.target.value)})),
        field(t('type'),h('select',{value:draft.type,onChange:e=>update('type',e.target.value)},capabilities.types.map(x=>h('option',{key:x,value:x},x)))),
        field(t('echelon'),h('select',{value:draft.echelon,onChange:e=>update('echelon',e.target.value)},capabilities.echelons.map(x=>h('option',{key:x,value:x},labels[x]+' / '+x)))),
        field(t('personnel'),h('input',{type:'number',min:0,step:1,value:draft.personnel || 0,onChange:e=>update('personnel',e.target.value)})),
        field(t('equipment'),h('textarea',{value:draft.equipmentText,onChange:e=>update('equipmentText',e.target.value),spellCheck:false})),
        field(t('remark'),h('textarea',{value:draft.remark || '',onChange:e=>update('remark',e.target.value)})),
        h('div',{className:'orbat-bar'},h('button',{className:'primary',onClick:save,disabled:!dirty},t('save')),h('button',{onClick:async()=>{const next=await reload();const freshDoc=next?.documents.find(d=>d.id===doc.id);const freshNode=freshDoc&&flatten(freshDoc.root).find(x=>x.node.id===node.id)?.node;if(freshNode)reset(freshDoc,freshNode,true);else act('__local_error',{message:t('recoveryMissing')});}},t('reload'))),
        h('p',{className:'orbat-mini'},t('direct')),
        h('details',null,h('summary',null,t('add')),
          field(t('name'),h('input',{value:addName,onChange:e=>setAddName(e.target.value)})),
          field(t('echelon'),h('select',{value:addEch,onChange:e=>setAddEch(e.target.value)},capabilities.echelons.map(x=>h('option',{key:x,value:x},labels[x])))),
          field(t('count'),h('input',{type:'number',min:1,max:30,value:addCount,onChange:e=>setAddCount(Number(e.target.value))})),
          h('button',{onClick:()=>{if(!Number.isInteger(addCount)||addCount<1||addCount>30)return act('__local_error',{message:'数量须为1–30'});return edit(Array.from({length:addCount},(_,i)=>({op:'add',parentId:node.id,node:{name:addName+(addCount>1?' '+(i+1):''),type:node.type,echelon:addEch || nextEch,customName:true,personnel:0,children:[]}})));}},t('add'))),
        node.id!==doc.root.id&&h('details',null,h('summary',null,t('move')),
          field(t('move'),h('select',{value:parent,onChange:e=>setParent(e.target.value)},h('option',{value:''},'—'),flatten(doc.root).filter(x=>x.node.id!==node.id).map(x=>h('option',{key:x.node.id,value:x.node.id},x.node.name)))),
          h('button',{disabled:!parent,onClick:()=>edit([{op:'move',nodeId:node.id,parentId:parent}])},t('move'))),
        h('div',{className:'orbat-bar'},h('button',{className:'danger',disabled:node.id===doc.root.id,onClick:()=>{if(dirty&&!window.confirm(t('discard')))return;if(window.confirm(t('deleteConfirm')))edit([{op:'remove',nodeId:node.id}]);}},t('remove')))
      );
    }
    function BatchEditor({basis,capabilities,t,act,onClose}){
      const [ech,setEch]=useState('squad'),[delta,setDelta]=useState(1),[remark,setRemark]=useState(''),[mode,setMode]=useState('delta');
      const submit=async()=>{
        const edits=basis.map(doc=>({documentId:doc.id,expectedRevision:doc.revision,operations:mode==='remark'?[{op:'update',nodeId:doc.root.id,fields:{remark}}]:flatten(doc.root).filter(x=>x.node.echelon===ech).map(x=>({op:'update',nodeId:x.node.id,fields:{personnel:x.node.personnel+Number(delta)}}))})).filter(e=>e.operations.length);
        if(!edits.length)return act('__local_error',{message:'没有匹配节点'});
        const r=await act('transaction',{edits,summary:'人类批量编辑 '+basis.length+' 份编制'});if(r)onClose();
      };
      return h('section',{className:'orbat-card orbat-batch'},h('h2',null,t('batch')),
        h('p',null,basis.map(d=>d.name+' @r'+d.revision).join(' · ')),
        h('div',{className:'orbat-bar'},h('select',{value:mode,onChange:e=>setMode(e.target.value)},h('option',{value:'delta'},t('delta')),h('option',{value:'remark'},t('batchRemark'))),
          mode==='delta'?h(React.Fragment,null,h('select',{'aria-label':t('filter'),value:ech,onChange:e=>setEch(e.target.value)},capabilities.echelons.map(e=>h('option',{key:e,value:e},labels[e]))),h('input',{'aria-label':t('delta'),type:'number',value:delta,onChange:e=>setDelta(e.target.value)})):h('input',{'aria-label':t('remark'),value:remark,onChange:e=>setRemark(e.target.value)}),
          h('button',{className:'primary',onClick:submit},t('apply')),h('button',{onClick:onClose},t('cancel'))));
    }
    function Workbench({ctx,t}) {
      const [state,setState]=useState(null),[error,setError]=useState(''),[live,setLive]=useState(false),[busy,setBusy]=useState(false),[active,setActive]=useState(''),[selected,setSelected]=useState([]),[nodeId,setNodeId]=useState(''),[search,setSearch]=useState(''),[batch,setBatch]=useState(null),[history,setHistory]=useState(null),[cursor,setCursor]=useState(0),[hasMore,setHasMore]=useState(false),[focused,setFocused]=useState(false);
      const [newName,setNewName]=useState(''),[draftRecovery,setDraftRecovery]=useState(null),[displayMode,setDisplayMode]=useState('editor'),[savedPreviews,setSavedPreviews]=useState([]);
      const hasDraft=Boolean(draftRecovery);
      const reportDraft=useCallback((dirty,value)=>{setDraftRecovery(previous=>updateDraftRecovery(previous,dirty,value));},[]);
      useEffect(()=>{const warn=event=>{if(hasDraft){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[hasDraft]);
      const fileRef=useRef();
      const refresh=useCallback(async()=>{
        try{const r=await fetch(endpoint('state'),{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();setState(s=>!s||data.sequence>=s.sequence?data:s);return data;}catch(e){setError(e.message);}
      },[]);
      useEffect(()=>{
        refresh();const stream=new EventSource(endpoint('events'));
        stream.onopen=()=>setLive(true);stream.onerror=()=>setLive(false);stream.onmessage=()=>refresh();
        return()=>stream.close();
      },[refresh]);
      const act=async(name,args)=>{
        if(name==='__local_error'){setError(args.message);return null;}
        setBusy(true);setError('');try{const result=await runEditRequest(()=>action(name,args),refresh);if(result.ok)return result.result;const e=result.error;setError(e.message+(e.details?' · '+JSON.stringify(e.details):'')+(e.refreshError?' · '+e.refreshError:''));return null;}finally{setBusy(false);}
      };
      useEffect(()=>{if(state&&!state.documents.some(d=>d.id===active)){setActive(state.documents[0]?.id || '');setNodeId('');}},[state,active]);
      if(!state)return h('div',{className:'orbat-wb'},h('style',null,CSS+'.orbat-wb .orbat-warn{color:var(--dsw-alias-state-warn-primary)}'),h('h1',null,t('title')),h('p',null,error || t('busy')));
      const doc=state.documents.find(d=>d.id===active),units=doc?flatten(doc.root):[],unit=units.find(x=>x.node.id===nodeId)?.node || doc?.root;
      const ids=selected.filter(id=>state.documents.some(d=>d.id===id));if(!ids.length&&doc)ids.push(doc.id);
      const choose=(id,nid='')=>{if(hasDraft&&!window.confirm(t('discard')))return;reportDraft(false);setActive(id);setNodeId(nid);};
      const previewModes=availablePreviewModes(state.capabilities);
      const effectiveMode=previewModes.includes(displayMode)?displayMode:(previewModes[0] || 'list');
      const previewRequests=doc?buildPreviewRequests(doc,ids,effectiveMode,focused&&unit?unit.id:null):null;
      const previewParams=previewRequests?.preview;
      const displayedHistory=mergeVisibleHistory(history,state.changes?.changes);
      const orphanedDraft=hasDraft&&draftRecovery&&(!doc||doc.id!==draftRecovery.documentId||unit?.id!==draftRecovery.nodeId);
      const historyGap=displayedHistory.some((c,i)=>i>0&&c.sequence>displayedHistory[i-1].sequence+1);
      const loadHistory=async since=>{const r=await act('changes',{since,limit:50});if(r){setHistory(since?old=>[...(old||[]),...r.changes]:r.changes);setCursor(r.nextCursor);setHasMore(r.hasMore);if(r.truncated)setError('历史已截断，较早记录不在本demo保留范围。');}};
      return h('main',{className:'orbat-wb','aria-label':t('title')},h('style',null,CSS+'.orbat-wb .orbat-warn{color:var(--dsw-alias-state-warn-primary)}'),
        h('div',{className:'orbat-bar',style:{justifyContent:'space-between'}},h('div',null,h('h1',null,t('title')),h('div',{className:'orbat-mini'},t('subtitle'))),h('div',null,h('span',{className:live?'orbat-live':'orbat-warn'},'● ',t(live?'connected':'offline')),' · seq ',state.sequence)),
        h('div',{className:'orbat-notice'},t('boundary'),' ',t('instructions')),
        error&&h('div',{className:'orbat-notice orbat-error',role:'alert'},error,h('button',{onClick:()=>setError(''),style:{marginLeft:8}},t('close'))),
        orphanedDraft&&h('section',{className:'orbat-notice orbat-warn',role:'alert'},h('strong',null,t('recovery')),h('p',null,t('recoveryMissing')),h('textarea',{readOnly:true,value:json(draftRecovery),rows:7,'aria-label':t('recovery'),style:{width:'100%'}}),h('button',{onClick:()=>window.confirm(t('discard'))&&reportDraft(false)},t('discardRecovery'))),
        h('div',{className:'orbat-bar'},
          h('input',{'aria-label':t('name'),placeholder:t('name'),value:newName,onChange:e=>setNewName(e.target.value)}),
          h('button',{disabled:busy,onClick:async()=>{const r=await act('create',{name:newName.trim() || '新编制'});if(r){choose(r.document.id);setNewName('');}}},t('new')),
          h('button',{disabled:busy,onClick:()=>fileRef.current.click()},t('import')),
          h('input',{type:'file',accept:'.json,application/json',ref:fileRef,style:{display:'none'},onChange:async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2*1024*1024){setError('文件超过2 MiB');return;}try{const payload=JSON.parse(await f.text());await act('import',{payload});}catch(e){setError(e.message);}finally{e.target.value='';}}}),
          doc&&h('a',{className:'orbat-link',href:endpoint('export',{ids:ids.join(','),format:ids.length===1?'mil-org':'mil-bundle'})},t('export'),' (',ids.length,')'),
          doc&&h('button',{disabled:busy,onClick:()=>setBatch(state.documents.filter(d=>ids.includes(d.id)))},t('batch'),' (',ids.length,')'),
          busy&&h('span',{role:'status'},t('busy'))),
        batch&&h(BatchEditor,{basis:batch,capabilities:state.capabilities,t,act,onClose:()=>setBatch(null)}),
        h('div',{className:'orbat-grid'},
          h('aside',{className:'orbat-card'},h('h2',null,t('title'),' · ',state.documents.length),
            state.documents.map(d=>h('div',{key:d.id,className:'orbat-army'+(d.id===active?' selected':'')},
              h('input',{type:'checkbox','aria-label':d.name,checked:selected.includes(d.id),onChange:e=>setSelected(s=>e.target.checked?[...s,d.id]:s.filter(id=>id!==d.id))}),
              h('button',{onClick:()=>choose(d.id)},d.name,h('div',{className:'orbat-mini'},'r',d.revision,' · ',d.stats.personnel,' 人 · ',d.stats.nodes,' 节点')))),
            doc&&h('div',{className:'orbat-bar'},h('button',{onClick:async()=>{const r=await act('duplicate',{documentId:doc.id});if(r)choose(r.document.id);}},t('copy')),
              h('button',{className:'danger',onClick:()=>{if(hasDraft&&!window.confirm(t('discard')))return;if(window.confirm(t('deleteConfirm')))act('transaction',{edits:[{documentId:doc.id,expectedRevision:doc.revision,operations:[{op:'deleteDocument'}]}],summary:'删除编制 '+doc.name});}},t('removeDoc'))),
            h('p',{className:'orbat-mini'},t('exportHint'))),
          h('section',{className:'orbat-card'},doc?h(React.Fragment,null,
            h('div',{className:'orbat-bar'},h('h2',null,doc.name),h('span',{className:'orbat-tag'},'r',doc.revision)),
            h('div',{className:'orbat-stat'},h('span',null,'👤 ',doc.stats.personnel),h('span',null,'装备 ',doc.stats.equipTotal),h('span',null,'节点 ',doc.stats.nodes)),
            h('div',{className:'orbat-bar'},h('button',{onClick:()=>setFocused(f=>!f)},t(focused?'all':'focus')),
              previewModes.length>0&&h('label',null,t('displayMode'),' ',h('select',{'aria-label':t('displayMode'),value:effectiveMode,onChange:e=>setDisplayMode(e.target.value)},previewModes.map(mode=>h('option',{key:mode,value:mode},t(mode==='editor'?'editorMode':'listMode'))))),
              h('a',{className:'orbat-link',href:endpoint('preview',{...previewParams,format:'png'}),target:'_blank',rel:'noopener'},t('png')),
              h('button',{disabled:busy||!previewModes.length,onClick:async()=>{const result=await act('render',previewRequests.render);if(result)setSavedPreviews(savedPreviewSummary(result));}},t(focused?'saveFocus':'saveSelected'),' (',previewRequests.render.documentIds.length,')')),
            savedPreviews.length>0&&h('div',{className:'orbat-notice',role:'status'},t('savedPreview'),' (',savedPreviews.length,') ',savedPreviews.map(item=>h('div',{key:item.documentId+':'+item.revision+':'+item.mode},h('a',{className:'orbat-link',href:item.url,target:'_blank',rel:'noopener'},item.documentId,' · r',item.revision,' · ',t(item.mode==='editor'?'editorMode':'listMode'))))),
            !previewModes.length&&h('p',{className:'orbat-warn',role:'status'},t('oldHost')),
            h('div',{className:'orbat-preview',tabIndex:0,role:'region','aria-label':t('preview')},h('img',{src:endpoint('preview',previewParams),alt:doc.name+' '+t('preview')})),
            h('div',{className:'orbat-bar'},h('h2',null,t('tree')),h('input',{'aria-label':t('search'),placeholder:t('search'),value:search,onChange:e=>setSearch(e.target.value)})),
            h('div',{className:'orbat-tree'},units.filter(x=>!search||x.node.name.includes(search)).slice(0,400).map(({node,depth})=>h('button',{key:node.id,className:node.id===unit?.id?'active':'',style:{paddingLeft:10+depth*12},onClick:()=>choose(doc.id,node.id)},node.name,' · ',labels[node.echelon] || node.echelon,' · ',node.personnel,' 人'))),
            units.length>400&&h('p',null,'节点列表显示前400项，可用搜索或AI查询工具定位。')
          ):h('p',null,t('empty'))),
          h('aside',{className:'orbat-card orbat-properties'},doc&&unit&&h(NodeEditor,{key:doc.id+':'+unit.id,doc,node:unit,capabilities:state.capabilities,t,act,onDraft:reportDraft,reload:refresh,blocked:orphanedDraft}),
            h('section',{className:'orbat-history'},h('h2',null,t('history')),historyGap&&h('p',{className:'orbat-warn'},t('historyGap')),h('div',{className:'orbat-bar'},h('button',{onClick:()=>loadHistory(0)},t('load')),history&&h('button',{onClick:()=>setHistory(null)},'最近更新'),history&&hasMore&&h('button',{onClick:()=>loadHistory(cursor)},t('more'))),
              [...displayedHistory].reverse().map(change=>h('article',{key:change.sequence,className:'orbat-event'},
                h('span',{className:'orbat-tag'},t(change.actor.kind==='human'?'human':'ai')),'#',change.sequence,' ',change.summary,
                h('div',{className:'orbat-mini'},change.actor.name,' · ',new Date(change.time).toLocaleString()),
                h('div',{className:'orbat-mini'},change.documents.map(d=>d.id.slice(0,14)+' r'+d.beforeRevision+' → '+d.afterRevision).join(' · ')),
                h('details',null,h('summary',null,t('compare'),' (',change.diffs.length,')'),change.diffs.length>30&&h('p',{className:'orbat-warn'},t('diffTruncated')+' 30 / '+change.diffs.length),change.diffs.slice(0,30).map((diff,i)=>{const before=limitDiffText(diff.before),after=limitDiffText(diff.after);return h('div',{key:i},h('strong',null,diff.field),h('pre',null,before.text,'\n→\n',after.text),(before.truncated||after.truncated)&&h('p',{className:'orbat-warn'},t('valueTruncated')));}))))
            ))
        ));
    }
    return {inject:['slots','locale','layout'],apply(ctx){
      ctx.effect(()=>ctx.locale.register('orbat-workbench','zh',zh));ctx.effect(()=>ctx.locale.register('orbat-workbench','en',en));
      const t=ctx.locale.bind('orbat-workbench');
      const Page=()=>{React.useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot());return h(Workbench,{ctx,t});};
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'orbat-workbench'},Page));
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'orbat-workbench',order:30,label:()=>t('title')},Icon));
    }};
  },
});
