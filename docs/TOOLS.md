# ORBAT 工具与协作协议

所有工具调用都经同一个 application.dispatch，与网页 POST 操作共用事务核心。工具来源由宿主固定为 ai，网页/API来源固定为 human；网页body中的actor被忽略。来源不是不可篡改身份认证。

## 工具

| 工具 | 参数 | 主要返回 |
|---|---|---|
| orbat_workspace | since?, limit? | sequence、文档摘要、revision、合法type/echelon、近期changes |
| orbat_read | documentIds?, nodeId?, depth=4 | 文档树、稳定id、revision、truncated、omitted；depth0–24 |
| orbat_query | documentIds?, text?, type?, echelon?, limit=100 | matches、total、truncated；limit1–200，不提供分页 |
| orbat_create | name, root? | 新文档id/revision/rootId与change；未传root创建空白营 |
| orbat_duplicate | documentId, name? | 新的独立编制，内部id全部重建 |
| orbat_edit | edits, summary? | 原子提交的文档修订摘要与字段差异；diff超过60时工具回执截断，详情查changes |
| orbat_changes | since=0, limit=50 | changes、nextCursor、latestSequence、hasMore、truncated |
| orbat_import | payload | 裸树、mil-org、mil-bundle.saves导入结果；新id |
| orbat_validate | documentIds? | 已存编制的结构有效状态、统计与兼容提示；不证明史实或战斗能力 |
| orbat_render | documentIds?, nodeId?, mode=editor\|list | 最多10份图片的pngPath/svgPath、尺寸、shown/total/truncated；URL带修订，修订不符返回冲突 |
| orbat_export | documentIds?, format? | JSON文件path；单份默认mil-org，多份默认mil-bundle |

## 事务形状

```json
{
  "edits": [
    {"documentId":"真实文档id","expectedRevision":3,"operations":[
      {"op":"update","nodeId":"真实节点id","fields":{"personnel":10}}
    ]}
  ],
  "summary":"说明修改目的"
}
```

操作：

- update：`nodeId,fields`，**合并指定字段**，不是替换整节点；fields白名单由模型校验。
- add：`parentId,node,index?`，添加新子树，内部id重建。
- remove：`nodeId`，删除子树，禁止根。
- move：`nodeId,parentId,index?`，稳定id，禁止根与循环；index是移除后目标数组的位置，默认末尾。
- replace：`root`，替换整棵树并重建id，不应用于普通局部修改。
- rename：`name`，修改文档/存档名（不是根节点name）。
- deleteDocument：删除整份文档，必须为该edit唯一操作；也可与其他文档edit原子组合。

每份文档只增一次revision；整个事务只增一次sequence；任一edit无效则全部不提交。CONFLICT 返回 `{ok:false,error:{code:'CONFLICT',message,details:{documentId,expectedRevision,actualRevision,current}}}`。

## 游标、截断与并发

- sequence是整个工作区的事务序号；revision是各文档自己的版本号，二者不能互换。
- since与nextCursor都属于sequence域。首次读changes从0开始；只在实际消费本页后推进到nextCursor，翻页到hasMore=false。刚从workspace看到的sequence不是已读游标。
- 历史最多500条。truncated=true表示请求范围有永久缺口；报告此事实，读当前完整文档，然后消费仍保留的变化直至hasMore=false，以最后nextCursor作为后续基点。不能补造丢失记录。
- 冲突后不要改revision数字重放旧操作。先读changes和当前树，重新查询目标集合、重建操作。若持续并发，可停止并请人协商，不无限重试。
- query超200结果时truncated=true；按已读树的各子树使用read(nodeId,depth)收集稳定节点id，或按更窄的type/echelon/text拆查询。不要把前200项当作全部。
- read的depth截断是返回投影，不修改工作区；hiddenChildren/omitted是继续读取提示。

## 人数、上限和名称

personnel是直属实有人数；personnelMax可选，0表示未指定。程序允许实有高于非零上限（避免自动丢失用户数据）；这是待确认的语义异常，应该给人提示，不猜改上限。equipment同理。上级人数不是含下属合计，不能重复填总数。

name为当前显示名，customName=true要求上游保留手工番号；AI未被要求改名时不要提交name/customName。只用稳定节点id定位，不依赖可能已被人改过的名称。

## 预览

render返回一文档一图，每个artifact独立报告节点截断 `truncated`。默认最多200张兵牌（列表最多200行）；堆叠可令代表节点数超过200。长标题和单位名称可能以省略号缩短，文本省略不计入节点截断标志。像素上限2400×16000，节点超限明确提示。改用更小子树；read_image打开实际PNG后才可称看图。折叠节点不显示下属，但仍计入total，不表示丢数据。可在用户要求展开时把相应节点collapsed改false；不要为看图悄悄修改用户视图状态。

`orbat_render` 支持 `mode:editor`（默认兵牌编制图）及 `mode:list`（旧列表）；预览链接和产物文件名包含模式，避免混用。兵牌图适配原网站的节点横纵布局，图片不是上游截图，字体及实现差异不保证像素一致。纯本地 PNG 字体依赖宿主 CJK 字体。

## HTTP（仅现有DSH认证通道）

精确路由：

- GET /api/orbat-workbench/state
- GET /api/orbat-workbench/events（SSE，reconnect后ready触发读取最新state）
- POST /api/orbat-workbench/action，JSON `{action,args}`；业务与工具表一一对应，edit业务名transaction
- GET /api/orbat-workbench/preview?id=文档id&format=svg|png&nodeId=可选节点&mode=editor|list&rev=可选修订；指定修订与当前不符返回409，不冒充旧图
- GET /api/orbat-workbench/export?ids=逗号分隔id&format=mil-org|mil-bundle

浏览器正常携带DSH cookie；连接桥拒绝非owner请求。POST另要求Origin等于当前DSH服务origin、Content-Type JSON、body≤2MiB。x-orbat-client仅为显示用来源标签。

## 导出范围

mil-org单份；mil-bundle多份saves，同名自动加后缀避免覆盖。导出前读取当前revision/统计，导出后用read读取文件确认saves数量/名称/data以及人员、装备，必要时比较统计。导出不执行网站导入，也不带地图与自定义装备数值。
