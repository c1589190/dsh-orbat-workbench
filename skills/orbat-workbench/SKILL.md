---
name: orbat-workbench
description: Use when creating, inspecting, batch-editing, rendering or exporting army orders of battle, or collaborating with human edits in the ORBAT workbench / 编制协作工作台.
---

# 编制协作工作台

人类网页与 `orbat_*` 工具共用同一工作区、同一事务核心。它是 Army_Editor 1.8.0 的独立协作前端，只做 JSON 文件兼容，不自动同步第三方网页。

## 交付目标（文游）

- 产出可直接打文游、也可导出给原编辑器的**完整编制**：单位名称正常、直属人数与装备可玩、资料可追溯。
- 单位名称里**不要**写“【示意】”“推定”“未知”“估计”等字样。证据状态放在 `custom.orbat`（字段级）或 `remark`；名称只写番号/职能。
- 资料不足时可使用有来源的同期类型编制或有解释的推定，但必须标 `standard` / `estimate` / `unknown`，不能把推定说成 1988 年实有记录。`0` 只在明确 `actual` 时表示确认零；旧数据 0 默认视为歧义，不是事实零。
- 上级合计由程序递归计算；`personnel`/`equipment[].count` 只填**本级直属**数量，禁止把含下属总数重复填到上级。

## 工作顺序

1. `orbat_workspace`：拿文档 id、revision、sequence、合法 type/echelon。名字不唯一，用 id。
2. `orbat_changes`：首次从 `since:0`，按 `nextCursor` 翻页直到 `hasMore:false`；只把实际消费到的 `nextCursor` 当已读游标。不要把刚看到的 `sequence` 当已读游标。
3. `orbat_read` / `orbat_query`：按 id/type/echelon/text 定位，返回稳定节点 id 与 revision。`query` 超过 200 条用 `nextCursor` 翻页；工作区变化后旧 cursor 报 `stale_cursor`，从第一页重查。截断时下钻具体 `nodeId`，不要重复聚焦同一个根。
4. `orbat_resources`：读装备目录与模板库（含 `revision`）；要改目录/模板先读，再用 `orbat_update_resources` 带 `expectedRevision` 提交。
5. 批量改动先用 `orbat_plan` 生成冻结计划（无写入），检查 `diffs`、`stats`、`warnings`；确认后用 `orbat_commit` 提交**同一份** plan。不要改选择条件后复用旧 plan，也不要在提交时重新扫描。
6. 需要精确局部修改时用 `orbat_edit`；每份文档带刚读的 `expectedRevision`。跨文档复制/模板克隆使用 `template` 或 `guards`。
7. 提交后 `orbat_read`/`orbat_changes` 核对目标范围、人数/装备与是否误改番号；`orbat_validate` 只证明结构和通用语义，不证明史实或兵棋数值正确。
8. `orbat_render` 生成图，**必须 `read_image` 看实际 pngPath** 再交付（Markdown 图片或 `present`）。`truncated:true` 时聚焦更小子树；折叠隐藏的下属不能当成不存在。
9. `orbat_export` 导出：单份 `mil-org`，多份 `mil-bundle`（原编辑器“导入全部”）。必须阅读返回的 `lossReport`，不要把兼容格式说成无损；完整备份用原生导出。

## 数据与证据

- 字段级证据：`node.custom.orbat = {version:1, personnel:{status,source?}, equipmentList:{status,source?}, observedTotals?}`；装备条目用 `item.orbat = {status,source?}`。`status` 只能是 `actual|standard|estimate|unknown|legacy-ambiguous`。不要覆盖既有 `custom` 的其他命名空间。
- `custom.orbat.observedTotals` 是资料记载总数，只作注解，不自动拆分、不加进下属合计。
- `stats.coverage` 含义：`personnel.known` 已知人数；`equipment.known` 按名称的已知小计、`knownTotal` 合计；`estimated` 为估计数量；`unknown`/`legacyAmbiguous` 是受影响节点/条目数。存在 unknown/legacyAmbiguous 时合计不完整，交付时要说明。
- 未标注的非零旧值按已记录（known）处理；未标注的 0 是 legacy 歧义；未标注的空装备清单也是歧义，不等于“没有装备”。显式 `equipmentList.status:'actual'` 的空清单才是确认无。
- `personnelMax`/`countMax` 0 表示未指定；不要为了补齐实有值猜造上限。实有高于非零上限是待核对异常，应提示，不自动改。

## 批量与模板

`orbat_plan` 参数形状：

```json
{
  "documentIds": ["真实文档id"],
  "select": {"text": "班", "echelon": "squad"},
  "operation": {"kind": "personnel", "mode": "set", "value": 10,
                "status": "standard", "source": {"title": "1988苏军编制手册", "page": "12"}},
  "maxNodes": 400,
  "summary": "把各班补到10人"
}
```

支持的 `operation.kind`：

- `personnel`：`mode:set|delta`、`value`、可选 `status`/`source`；负数导致非法人数时整份计划拒绝。
- `equipment`：`mode:upsert|remove`、`name`、可选 `count/countMax/occurrence/status/source`；upsert 保留同名其他条目的额外字段，`occurrence` 从 0 起。
- `evidence`：`target:personnel|equipmentList`、`status`、可选 `source`。
- `remark`：`value`。

`orbat_commit` 只接收 `orbat_plan` 返回的 `plan`；可附加只读 `guards:[{documentId,expectedRevision}]` 守卫源文档。冻结后不重扫；任何修订过期/非法使整笔不提交。需要克隆模板时在 `orbat_edit` 用 `{"op":"template","parentId":"...","templateId":"...","name":"可选新名"}`，会生成新节点 id；直接改写 `custom` 用 `mergeCustom`（只合并命名空间，不整块覆盖）。

## 冲突与并发

`CONFLICT` 表示整个事务未提交。先重读 `orbat_changes` 和当前文档，确认人的最新改名/加单位，再用新 revision 重新查询目标并重建操作；不要把旧 revision 加一、不要拆事务绕过、不要覆盖人类修改。持续并发时报告事实并停手，不无限重试。

## 工具速查

| 需求 | 工具 |
|---|---|
| 状态/修订/词表 | `orbat_workspace` |
| 读树 / 分页查节点 | `orbat_read` / `orbat_query`（`nextCursor`） |
| 创建 / 复制 / 导入 | `orbat_create` / `orbat_duplicate` / `orbat_import`（支持非空上游装备库） |
| 批量预览 / 提交 | `orbat_plan` / `orbat_commit` |
| 精确事务 | `orbat_edit`：`update/mergeCustom/template/add/remove/move/replace/rename/deleteDocument` |
| 装备目录与模板 | `orbat_resources` / `orbat_update_resources` |
| 变更历史 | `orbat_changes` |
| 校验 / 图片 / 导出 | `orbat_validate` / `orbat_render` / `orbat_export` |

## 导出与损失

- 原生完整备份 `exportNative`/`importNative`（应用层 API）保留文档 id、revision、节点 id、证据、目录与模板；merge 冲突整笔拒绝，clone 重生成 id 并返回映射；若导入时不恢复工作区历史会明确报告。
- `mil-org`：单份，不含装备目录；`mil-bundle`：多份 saves 并按名去重，目录随包导出，但别名、字段级资料、模板、历史、内部 id 等会进入 `lossReport`。
- 兼容文件是否被原编辑器完整保留无法由本工作台保证；不要把“文件已生成”说成“原站往返无损”。

## 常见错误

- 把 workspace 当前 `sequence` 当已读 cursor。
- 提交 plan 前重新跑选择条件，或在冲突后重放旧计划。
- 在单位名称里加示意/推定/未知。
- 用 0 冒充未知或把推定写成史实。
- 只返回图片路径而不 `read_image`、不检查 `truncated`。
- 宣称兼容导出无损、或宣称已在原网站/浏览器完成导入验收。
