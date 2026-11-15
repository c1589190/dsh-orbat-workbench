---
name: orbat-workbench
description: Use when creating, inspecting, batch-editing, rendering or exporting army orders of battle, or collaborating with human edits in the ORBAT workbench / 编制协作工作台.
---

# 编制协作工作台

人类网页与 `orbat_*` 工具操作同一工作区。它是 Army_Editor 1.8.0 的独立协作前端，不会自动同步未改造的第三方网页。

## 工作顺序

1. `orbat_workspace {}` 发现文档 id、当前 revision、合法兵种与层级；名字不唯一，用 id 定位。
2. 读取人工变化。已有上次**实际读完**的 cursor 时传给 `orbat_changes`；第一次使用从 `since:0` 开始，按 `nextCursor` 翻页直至 `hasMore:false`。**不能把刚读到的 workspace.sequence 当成已读 cursor**，否则跳过此前人工修改。`truncated:true` 表示历史有缺口，明确说明并重新读取当前文档。
3. `orbat_read` 读取目标文档；`orbat_query` 按 type/echelon 搜索全部目标，不靠旧番号或预先记住的班数。读取被截断时按具体子树 `nodeId` 继续。
4. 用一次 `orbat_edit` 的 `edits` 同时修改多份编制。每个 edit 使用该文档刚读取的 `expectedRevision`，只提交必要字段；保留人类改名、增设单位和未要求修改的数据。
5. `CONFLICT` 表示整个事务未提交。读取变化与最新文档，重新确认意图和节点集合，使用新修订重新构造操作；不要只把旧操作的修订号加一，不要拆事务绕过冲突。持续冲突时报告事实，不无限重试。
6. 提交后读取变化、状态并 `orbat_validate`，核对目标范围、数量及无意外改名。校验不证明历史考据、装备数值或兵棋能力正确。
7. `orbat_render` 返回每份 SVG/PNG 的实际路径。**调用 `read_image` 查看 pngPath**，再用 Markdown 图片或 `present` 交给人。路径本身不等于已看图。若 `truncated:true`，聚焦更小的子节点；再次聚焦同一个根不会解决截断。折叠也可能隐藏下属，不能把未画出的节点断言为不存在。
8. `orbat_export` 返回文件：单份 `mil-org` 在原编辑器“加载 → 从文件打开”；多份 `mil-bundle` 在原编辑器“导入全部 → 加载对应存档”。这是导出文件，不是远程自动导入网站。

完整参数、分页/缺口处理、超过200匹配的拆读方法参见 [工具协议](../../docs/TOOLS.md)。

## 数据语义

- `personnel`、`equipment[].count` 是**本级直属数量**，不含下属重复总数。上级合计由程序递归计算。例：三个9人班、无额外营部人员，营 `personnel:0`，总数27；把三个班补为10后营仍0、总数30。
- `personnelMax` / `countMax` 是可选上限；0表示未指定，不要为了补齐实有值而猜造上限。
- 节点 `id` 仅为内部稳定定位；新增、复制、替换和导入生成新 id，原站导出剥离它。局部修改优先 `update/add/move/remove`，不要把旧整树 `replace/import` 当作修改。
- 兵种/层级从 capabilities 取合法键；布局只支持 `h` / `v`。使用已知默认装备名可提高兼容性，但单份文件不带装备库。此 demo 拒绝非空自定义装备库，不静默吞掉数值。
- 人类来源为网页/API通道，AI来源为工具通道，属于协作标签，不是用户身份认证或不可篡改审计。

## 工具速查

| 需求 | 工具 |
|---|---|
| 列表、修订、合法词表 | `orbat_workspace` |
| 读树 / 跨编制查节点 | `orbat_read` / `orbat_query` |
| 创建 / 复制 / 导入 | `orbat_create` / `orbat_duplicate` / `orbat_import` |
| 原子多文档编辑 | `orbat_edit`：`update/add/remove/move/replace/rename/deleteDocument` |
| 人与 AI 字段差异 | `orbat_changes`：`actor`、`before/after`、revision |
| 校验 / 预览 / 导出 | `orbat_validate` / `orbat_render` / `orbat_export` |

## 一次多编制修改的形状

```json
{
  "edits": [
    {"documentId":"从读取结果取值","expectedRevision":1,"operations":[{"op":"update","nodeId":"从查询结果取值","fields":{"personnel":10}}]},
    {"documentId":"另一份文档id","expectedRevision":2,"operations":[{"op":"update","nodeId":"另一节点id","fields":{"personnel":10}}]}
  ],
  "summary":"将两份编制中目标班补为10人，保留最新番号"
}
```

例子中的 id/revision 是占位，不可直接使用。大编制按子树检查；当前默认预览最多200节点、单文档最多2000节点；导出文件仍包含全部编制。闲置 AI 不因每次人类编辑自动唤醒；下一步上下文会提示最新状态，精确修改仍以 `orbat_changes` 为准。
