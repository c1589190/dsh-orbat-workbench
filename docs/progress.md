# Demo execution ledger

## 2026-11-15 责任区3（已完成）
- 新增 `src/batch.js`：同一套筛选（text/type/echelon/nodeIds）编译为冻结 revision 的精确事务；支持 personnel set/delta、equipment upsert/remove（occurrence 与额外字段保留）、evidence、remark；预览无写入，返回 diffs/stats/warnings，无匹配/无变化/超上限/负人数均结构化拒绝。
- 新增应用与工具 `plan`/`commitPlan`（`orbat_plan`/`orbat_commit`）：提交只执行计划中的节点与 revision，不重扫选择条件；新增 `guards` 只读 revision 守卫，源文档变化使整笔冲突。`query` 支持 sequence 游标翻页并在工作区变化后返回 `stale_cursor`，覆盖 >200 匹配。
- 事务新增 `mergeCustom`（命名空间深合并，保留无关 custom；非对象 custom 触发 `custom_conflict`）、`template`（模板克隆、重生成 id、可选改名）与 `guards`。资源 `resources`/`updateResources` 暴露到应用与工具；导出返回兼容损失报告。
- 新增 `tests/batch-workflow.test.js` 12 项；全量 **180/180** 通过，`scripts/check.mjs` rc=0；提交 `36fbc49`。
- 说明：按用户要求不再派遣责任区子 Agent，测试与实现由主 Agent 直接完成；因此没有像前两区那样单独保存“实现前 RED”日志。未做跨文档源节点克隆专用操作（用模板与 guards 覆盖），批量命名/模板 UI 留给责任区4。
- 下一步：责任区4（结构化装备表、资料/数量状态、直属/合计、批量预览与提交 UI、模板入口、渲染不完整标记、build）。

## 2026-11-15 责任区2（已完成）
- 用户要求不再为每个小责任区派遣子 Agent，剩余工作由主 Agent 直接完成；责任区2 的已派测试 Agent 在写出文件前被停止，测试与实现均由主 Agent 重新完成。
- `workspace.js` 状态升级到 v2：`resources:{revision,catalog,templates}`；v1 文件打开时迁移、下次写入升级；未知版本 fail-closed 且不改写原文件。`resources()`/`updateResources()` 以独立 expectedRevision 守卫（陈旧返回 `resource_conflict`），非法键、无限数值、重名/别名冲突、坏模板 root 均原子拒绝。
- 新增 `exportNative()`/`importNative()`：保留文档 id、revision、节点 id 与证据；merge 遇任一身份冲突整笔拒绝；clone 重新生成 id 并返回完整 idMap 与损失说明。原生完整备份带 changes/droppedThrough，导入时明确报告历史未恢复。
- 新增 `exportCompatible()`：兼容 payload 与旧 `export()` 一致，另返回确定性损失报告（内部 id、扩展元数据、资料、模板、目录/别名、历史）。`mil-bundle` 导出目录；`mil-org`/`mil-bundle` 导入接受非空上游装备库并原子合并，冲突拒绝。
- 新增 `tests/native-interchange.test.js` 15 项；全量 **168/168** 通过，`scripts/check.mjs` rc=0；提交 `f39a079`。
- 已知接线缺口：resources 尚未进入 `application`/tools/UI 的 state 与 SSE 事件，留给责任区3/4；真实旧版进程无法本地复测，用未知版本拒绝覆盖 fail-closed。未运行 build，未重启 Host。
- 下一步：责任区3（共享筛选/分页、plan/commitPlan、批量人员装备与资料合并、模板克隆、跨文档 revision 守卫）。

## 2026-11-15 Git 仓库初始化与责任区1（已完成）
- 按用户要求初始化 Git 并推送 remote `git@github.com:c1589190/dsh-orbat-workbench.git`，package 版本改为 `0.0.1`、`license: MIT`；LICENSE 保留 M.Hikari 与 contributors 两行版权。基线提交 `273f988`（导入当前源码，含当时 10 项预期 RED）。
- 责任区1 GREEN，提交 `cc02905`：`stats()` 先规范化原始树再统计，合法缺字段树不再 TypeError/NaN；装备 coverage 新增 `known` 按名称小计与 `knownTotal`，排除 unknown/legacy-ambiguous 占位，未标注空装备清单计 legacy 歧义、显式 actual 空清单为已知空；证据只读 own `orbat` 属性（新增 5 项原型链安全测试到 `tests/evidence-model.test.js`）。
- 控制方复跑：`node --test tests/evidence-model.test.js tests/model.test.js` 42/42；`node --test tests/*.test.js` **153/153**；`node scripts/check.mjs` PASS。未运行 build，未重启 Host，未做 GUI 视觉验收。
- 下一步：责任区2（原生备份、装备目录与模板持久化、workspace v2 迁移、兼容导出损失报告）。

## 2026-11-15 文游编制工作流（已暂停，交接中）
- **交接入口：`docs/HANDOFF-2026-11-15-orbat-game-workflow.md`。** 用户要求保存状态、由其他 Agent 接手；当前会话 goal 已暂停，所有本轮子 Agent 已结束。
- 用户选择原生无损+原站兼容方案 B，要求所有工具能力、录入工作流和内置 skill 改进；要求 DeepSeek Flash 子 Agent、SimulatorMosire 责任区制和名称不带“示意”。
- 设计：`docs/superpowers/specs/2026-11-15-orbat-game-workflow.md`；计划：`docs/superpowers/plans/2026-11-15-orbat-game-workflow.md`。
- 裁定：本目录非 Git，延续项目既有明确决策原地开发，不初始化 Git、不虚构提交；同时只允许一个生产代码写入 Agent，测试 Agent 先建立 RED，再交实现者 GREEN。（该“非 Git”裁定已由 2026-11-15 用户要求初始化 Git 取代，见上方新条目。）
- 本轮基线：`pnpm test && pnpm run check` 退出码 0，128/128 测试通过；有 Node Undici experimental warning。测试在临时数据目录，不操作实时工作区。生产源码基线保存在 `/tmp/orbat-baseline-73O2GyAz`（创建时测试 Agent 可能已开始编写新测试；源码尚无写入 Agent）。
- 责任区1未完成：第一轮 RED→GREEN 后实现 `src/evidence.js` 并修改 `src/model.js`；依据只读评审补了空装备、装备已知小计、缺字段原始树等边界测试。交接前控制方复跑 `node --test tests/evidence-model.test.js tests/model.test.js`：退出1，37项中27过、10项预期RED；结果日志 `/tmp/orbat-handoff-tests-nfYsf5wj`。所有测试/实现 Agent 已停止，下一步按交接文档修复，不得宣称全量通过。
- 内置 skill 的无新增指导基线已运行：现有 skill 只规定协作事务，未要求完整文游数据、清洁名称与字段来源；独立场景输出曾在缺乏佐证时假定具体型号和分配，因此不可直接采用场景中提议的数值。后续 GREEN 必须验证可玩估算不冒充史实、避免不合理定额。
- 只读架构评审发现 v1 状态构造会剥离新增资源，原生重建 ID 不符合无损备份，以及旧进程和新进程并发写入风险；计划已修正为 v2 状态、保留 ID 的原生备份、显式 clone 映射和停用旧 Host 后升级。另标记 legacy 不完整树的 stats 边界、custom 与装备项原子合并、来源守卫/服务端重算、导出损失报告等后续RED。
- 共享工作区截至 sequence 12；开始真实编制编辑前必须重读。


Plan: docs/superpowers/plans/2026-11-15-orbat-demo.md

- Ruling: 用户要求当前空目录直接出实验性 demo，故在此开发，不创建 Git 仓库/worktree，不伪造提交；成本是没有 Git diff/回滚历史，以文件测试和明确模块所有权验收。
- Ruling: 当前插件网页才是实时协作编辑器，第三方公开网页仅文件兼容；若用户需要原网页实时协作，需后续 bridge。
- 原 Demo ruling（已由 2026-11-15 用户“直接抄”的显示样式决定取代）：自写 renderer + MIT milsymbol，避免复制授权不明的第三方编辑器；预览不是 DSH UI 截图。现保留自写 list，editor 模式适配上游，来源/授权状态见 THIRD_PARTY。
- Pre-flight: core produces Workspace/model APIs; application consumes; renderer consumes normalized document independently; main owns all other files and dependency installation.
- Delegation: orbat-core owns model/workspace + their tests. orbat-render owns renderer + renderer tests. Both deepseek-flash. Main owns integration/UI/docs/skills.
- Runtime contracts inspected: webServer.register, systemPrompt.context/section, client main slot, slots inject/register, locale register/bind, theme tokens.
- Core and renderer RED→GREEN completed. Independent integration review caught initially guessed type/layout; corrected to actual upstream protocol rather than accepting self-consistent tests.
- Reference skill baseline identified skipped-history cursor and ineffective same-root refocus; skill-guided scenario corrected both. Batch skill provider added with real directory/body tests.
- Independent deepseek-flash code/UX review caught DSH GET streaming Request bug; 3 host characterization tests RED→GREEN. UI policies now cover live history, explicit truncation, conflict refresh, minimal patch, draft ownership/recovery. Known minor issues recorded in REVIEW.md, not expanded into production scope.
- Final suite: 98/98 passed, zero failures. Source/artifact syntax and bilingual metadata checks pass. Native environment emits UNDICI experimental proxy warning.
- Real runtime: skill loaded, workspace/read/query/changes/render/export/validate invoked; one AI transaction changed both document remarks at sequence5; deliberately stale multi-document transaction returned CONFLICT with neither partial write nor new sequence. Human-named squad preserved.
- Deployment: plugin_manager registered local bundle but returned restart-required/unmanaged-plugin. Current session tools + skill work, Client slots active; formal persisted installation still requires user restart. No server restart or credential extraction attempted.
- UI/manual/third-party browser verification not available; do not claim visual or upstream-import success. Actual product PNGs read with read_image and delivered.

## 2026-11-15 原编辑器样式改造（进行中）
- 用户明确要求网页和图片都调整，并说“对面是开源项目，直接抄”；以 `docs/superpowers/specs/2026-11-15-editor-style.md` 与 `docs/superpowers/plans/2026-11-15-editor-style.md` 为本轮范围。保留作者来源，不声称存在未核实的标准许可证或再分发授权。
- 基线：`pnpm test && pnpm run check` rc=0，98 tests pass；仅 experimental Undici 提示。仓库非 Git，不覆盖工作区数据或假造提交。
- 核心渲染责任区由 deepseek-flash agent 单独编辑；主 agent 负责 application/http/tools/client/client-policy 和各自测试，避免文件冲突。
- Task 2 服务端模式、缓存、图片文件名隔离、前端焦点/模式参数：先运行失败测试，然后 `node --test tests/display-mode.test.js tests/client-policy.test.js` 11/11 pass；`pnpm run build && pnpm run check` rc=0。注意此结果尚未验证 editor 新渲染器与实时 GUI。
- Ruling: 检测服务端 capabilities.previewModes，旧 Host 不展示虚假的模式切换并提示需重启；避免新 Client 对旧 Host 显示“兵牌图”却实际取得列表。代价是旧 Host 尚未重载时新模式不可用。
- 兵牌渲染已本地生成并核查晨曦示例 13/13；此前全套 122 项通过，仍需后续修复后的完整回归。独立审查发现折叠节点缺卡面标记、上下限异常无提示、标签重叠与深树指纹开销，由原渲染 agent TDD 修复中；截图不是运行中 GUI。
- Ruling: 现有工作区已有显式 `stack:false` 的节点不批量改写；新数据模型默认继续 false（与原站缺省 true 不同），用户可显式开堆叠。这避免仅因显示改造而更改数据/显示语义；代价是新节点不会自动合并，README 已说明。
- UI review follow-up: 已加保存范围/数量/结果和带修订链接；旧 Host 警示配色、空模式非法校验与缓存/输出字段测试；预览链接修订过期返回409而不是伪装成同一文件。仍无法在真实浏览器验证。
- 本地最终测试：`pnpm run build && pnpm test && pnpm run check` rc=0，128/128 tests PASS，Undici experimental warning；兵牌图 `/home/cna/bqty/artifacts/chenxi-editor-final-r1.png` 真实 renderer 生成并 read_image 查看，13/13、未截断。导出固定所选 revision，若在异步生成时发生修改则拒绝而非误标版本。
- 独立复核：折叠标记、逐项上限异常、文字基线和 SHA-256 深树指纹修复经只读复核无新增 Critical/Important；默认 stack 行为、字数省略、资源限制按本记录和 README 说明，不冒充原站完全一致。
- 运行态：本会话 `orbat_workspace` 返回 capabilities 没有 previewModes，证明当前工具服务仍为旧 Host；源码及构建产物不是运行中网页验收。需要用户重启 DSH Host 并刷新当前页面，再核验新模式；未擅自重启或另开服务。
- 资源残余：当前每图上限 2400×16000，最坏单次 RGBA 约154MB，SVG 预览也同步栅格化 PNG，缓存上限8条但无字节预算；尚未压力测试，建议仅本地可信数据使用。

