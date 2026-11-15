const str=description=>({type:'string',description});
const ids={type:'array',items:{type:'string'},description:'编制 id 列表；省略表示工作区全部编制'};
const obj={type:'object',additionalProperties:true};
const edit={type:'object',required:['documentId','expectedRevision','operations'],additionalProperties:false,properties:{
  documentId:str('编制 id'),expectedRevision:{type:'integer',description:'刚读取的 revision；过期返回 CONFLICT，必须重读再决定'},
  operations:{type:'array',items:{type:'object',additionalProperties:false,required:['op'],properties:{
    op:{type:'string',enum:['update','add','remove','move','replace','rename','deleteDocument']},
    nodeId:str('update/remove/move 的节点 id'),parentId:str('add/move 的目标父节点 id'),
    fields:{...obj,description:'update 字段：name/type/echelon/personnel/personnelMax/equipment/layout/collapsed/stack/remark/mod/customName/custom'},
    node:{...obj,description:'add 的新子树，不要提供内部 id'},root:{...obj,description:'replace 的新根树（会重建 id）'},
    index:{type:'integer',description:'目标兄弟数组中的插入位置，默认末尾'},name:str('rename 的编制名称'),
  }}},
}};
const specs=[
  ['orbat_workspace','workspace','读取共享编制工作区、修订号、合法兵种/层级与近期修改。开始任务时先读，按需加载 orbat-workbench skill。',{since:{type:'integer'},limit:{type:'integer'}}],
  ['orbat_read','read','读取多份编制或一个节点子树，返回稳定节点 id、revision 与截断状态。',{documentIds:ids,nodeId:str('聚焦节点 id；建议只选一份编制'),depth:{type:'integer',description:'展开深度 0–24，默认4；截断时用nodeId继续读'}}],
  ['orbat_query','query','跨多编制按名称、兵种或层级查找节点，返回可编辑节点 id 和当前 revision。',{documentIds:ids,text:str('名称包含'),type:str('合法兵种键'),echelon:str('层级键'),limit:{type:'integer',description:'1–200，默认100'}}],
  ['orbat_create','create','创建一份编制；本级人员/装备不含下属重复总数。根树省略时创建空白营。',{name:str('编制名称'),root:{...obj,description:'递归编制树，字段与原编辑器裸树兼容，导入时分配内部 id'}}],
  ['orbat_duplicate','duplicate','复制一份编制为新的独立文档，节点 id 重新生成。',{documentId:str('来源编制 id'),name:str('副本名称')}],
  ['orbat_edit','transaction','以一个原子事务编辑多份编制。每份必须带expectedRevision；任何冲突/非法操作使全部不提交。',{edits:{type:'array',items:edit},summary:str('说明本次修改的目的，给人类看')}],
  ['orbat_changes','changes','读取人工/AI修改来源、节点字段before/after与修订变化；按nextCursor翻页，truncated表示历史缺口。',{since:{type:'integer',description:'上次已读 sequence，默认0'},limit:{type:'integer',description:'默认50'}}],
  ['orbat_import','import','导入裸树、mil-org或含多份saves的mil-bundle；本demo明确拒绝非空自定义装备库，不静默丢失。',{payload:{...obj,description:'已通过read读取并解析的JSON对象'}}],
  ['orbat_validate','validate','检查已存编制并给出兼容与直属统计语义提示；不证明历史考据或兵棋能力正确。',{documentIds:ids}],
  ['orbat_render','render','渲染多编制SVG和PNG文件（最多10份），返回图片路径与是否截断。随后用read_image看pngPath，再向人交付。',{documentIds:ids,nodeId:str('可选子树聚焦节点；建议只选一份编制'),mode:{type:'string',enum:['editor','list'],description:'显示模式：editor 兵牌树（默认），list 列表'}}],
  ['orbat_export','export','导出原编辑器兼容JSON文件。单份mil-org；多份mil-bundle在原编辑器“导入全部”。不包含自定义装备数值。',{documentIds:ids,format:{type:'string',enum:['mil-org','mil-bundle']}}],
];
const required={orbat_create:['name'],orbat_duplicate:['documentId'],orbat_edit:['edits'],orbat_import:['payload']};

export function createToolDefinitions(app) {
  return specs.map(([name,action,description,properties])=>({
    name,description,parameters:{type:'object',properties,required:required[name] || [],additionalProperties:false},
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]},
    async execute(args,exec){
      exec.signal?.throwIfAborted();
      const actor={kind:'ai',name:'AI '+(exec.agent?.id || 'unknown'),...(exec.agent?.id?{sessionId:exec.agent.id}:{})};
      const result=await app.dispatch(action,args,actor);
      // Mutations return a bounded receipt; read/query provide deliberate access to full state.
      if(result.ok && ['create','transaction','import'].includes(action)){
        const slim=d=>({id:d.id,name:d.name,revision:d.revision,rootId:d.root.id});
        const out={...result};if(out.document)out.document=slim(out.document);if(out.documents)out.documents=out.documents.map(slim);
        if(out.change?.diffs?.length>60)out.change={...out.change,diffs:out.change.diffs.slice(0,60),diffsTruncated:true};
        return out;
      }
      return result;
    },
  }));
}
