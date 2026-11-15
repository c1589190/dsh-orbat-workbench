# Demo execution ledger

## 2026-11-15 文游编制工作流（已暂停，交接中）
- **交接入口：`docs/HANDOFF-2026-11-15-orbat-game-workflow.md`。** 用户要求保存状态、由其他 Agent 接手；当前会话 goal 已暂停，所有本轮子 Agent 已结束。
- 用户选择原生无损+原站兼容方案 B，要求所有工具能力、录入工作流和内置 skill 改进；要求 DeepSeek Flash 子 Agent、SimulatorMosire 责任区制和名称不带“示意”。
- 设计：`docs/superpowers/specs/2026-11-15-orbat-game-workflow.md`；计划：`docs/superpowers/plans/2026-11-15-orbat-game-workflow.md`。
- 裁定：本目录非 Git，延续项目既有明确决策原地开发，不初始化 Git、不虚构提交；同时只允许一个生产代码写入 Agent，测试 Agent 先建立 RED，再交实现者 GREEN。
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

