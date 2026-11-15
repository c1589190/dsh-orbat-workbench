# 交接：文游编制工作流与插件扩展（2026-11-15）

> **状态：进行中，用户要求保存并由其他 Agent 接手。** 不要把本文件或当前测试结果当作任务已完成；不要擅自修改共享编制数据。

## 用户要求与决定

1. 用户要求升级本插件自带的编制创建/修改 skill，不是另写泛用 skill；此前功能遗漏不应甩锅给用户。
2. 用户对上一轮列出的工具、数据模型、装备库、模板、批量编辑、来源、未知/0、直属/汇总、预览和录入工作流要求“全！部！支！持！”
3. 用户选择**方案 B**：工作台有无损原生格式，同时可导出原 Army_Editor 兼容格式，并明确报告元数据/未知值/装备库等兼容损失。人类网页与 AI 工具调用同一业务实现。
4. 这是打文游用的图：单位名称不得添加“【示意】”，史实、标准、估计、未知等放资料层。不要凭空把估计伪称历史事实；不足时要合理建模并有来源/推算说明，而不是所有数值填0。
5. 用户明确要求善用子 Agent，使用 `deepseek-official/deepseek-flash`（已通过 list_subagent_models 确认）并学习 SimulatorMosire 的**责任区制**。参见 `/home/cna/SimulatorMosire/docs/agents/WORKFLOW.md`：责任区为可独立验收的问题域；同一时刻只有一个生产写代码 Agent，调查只读可并行。为满足测试先行，本项目由独立测试 Agent 先写并运行 RED，随后唯一实现 Agent GREEN；控制方审查和验收。禁止相互覆盖的并发写。
6. 会话 goal `goal-ffbb318d-58a4-447a-8b70-a5c2e9379570` 已因交接请求 **paused**；若同一会话获人类明确继续，要先 `get_goal` 再按规定 `update_goal resume`。其他会话独立开展时无需误把此目标标记完成。

## 先读文档与项目状态

- 设计：`docs/superpowers/specs/2026-11-15-orbat-game-workflow.md`
- 计划及 Common Contract（**其中包含本轮重要的追加裁定**）：`docs/superpowers/plans/2026-11-15-orbat-game-workflow.md`
- 项目状态与历史裁定：`docs/progress.md`
- 先前项目设计：`docs/demo-design.md`；工具协议：`docs/TOOLS.md`；项目入口：`README.md`。
- 当前目录 `/home/cna/bqty` **不是 Git 仓库**；此前用户决定就在当前目录开发。不要伪造分支、提交或 git diff。生产源码开始修改前的快照 `/tmp/orbat-baseline-73O2GyAz` 可用作对照（`tests` 快照可能已经包含本轮测试；目录可能被系统清理，不可当正式持久备份）。
- 当前 DSH URL `http://127.0.0.1:3080`；应用 Host 与 UI 共享工作区。不得直接改 `.workbench/workspace.json`，不得启动第二个使用该数据目录的 Workspace/Host，不得绕过 revision；不得擅自换 server 或承诺新源码已生效。源码是 `src/client-ui.js`，`client.js` 为 `pnpm run build` 生成产物；当前运行 GUI 和新版 Host 均未做端到端验收。

## 当前已做

- 新增上述设计文档和实施计划；`docs/progress.md` 顶部有本轮工作记录。
- 基线：修改生产源码之前 `pnpm test && pnpm run check` 退出0，**128/128** 测试通过，存在 Node Undici experimental warning；未操作真实工作台数据。
- 责任区1第一轮：独立测试 Agent 先写 `tests/evidence-model.test.js`，最小改 `tests/model.test.js` 以测试新增 coverage。控制方核实 RED；实现 Agent 仅改 `src/model.js` 并新增 `src/evidence.js`。该轮实现后 Agent 报 33/33 定向、144/144 全量通过；这是**补边界前的历史结果，不是当前状态**。
- 随后只读评审查出遗留严重缺口，控制方将 Common Contract 更新为：legacy 未标注空装备清单也属歧义；装备 coverage 要有 `known` 按名称小计和 `knownTotal`；stats 必须处理合法但字段缺失的原始树。独立测试 Agent 已据此更新两份测试，**未再改生产代码**。
- 交接前控制方实际运行：`node --test tests/evidence-model.test.js tests/model.test.js`，退出码 **1**，**37 项：27 通过、10 失败**；输出证据 `/tmp/orbat-handoff-tests-nfYsf5wj`（临时文件）。这些是新边界测试的预期 RED，下一位 Agent 应先修模型，不要报告全部测试通过。
- Skill 无新增指导基线已做：旧 skill 只覆盖协作协议，不要求完整文游、正常番号和资料来源；样例 Agent 自行推测时有未经证实/不合理装备假定，绝不能照抄其数字。后续必须测试新 skill 既能给出可用估算又不冒充史实。

## 责任区1的下一步（优先）

**当前测试明确 RED 的三个核心点**：
1. `src/evidence.js` 的装备 coverage 缺 `known`、`knownTotal`；要按名称安全累计已知/标准/估计数量，排除状态为 unknown/legacy-ambiguous 的占位值，不能以 `__proto__` 等名称污染对象。
2. 未标注的 `equipment:[]` 必须是 legacy 歧义，不等于确认为无；`equipmentList.status:'actual'` 且空列表可表示确认无。
3. `src/model.js:stats()` 目前 `validateRoot` 校验的是规范化副本，却遍历原始树；原始合法树缺 `equipment` 等字段时抛 TypeError，缺 count/personnel 可 NaN。测试要求安全规范化计算，不能伪造通过。

**只读复核另外发现**：
- `src/evidence.js` 普通读取 `custom.orbat`、`item.orbat` 会走原型链，应只认 own-property；补有意义的 RED 后修复。
- `src/evidence.js` 从 `model.js` 导入 `OrbatError/isPlainObject`，而 model 导入 evidence，当前循环模块依赖可运行但脆弱；在保持行为与测试前提下梳理。
- `custom`、`equipment` 的普通 update 是整块替换；字段级资料合并与装备条目操作属于后续责任区3，须在服务端事务内明确合并，保留原有 `custom.sidc`、其他装备/扩展字段；不依靠客户端拿旧值整表覆盖。
- legacy 数量原字段是兼容 raw；coverage 输出已知/未知/估计必须按当前 Common Contract 统计。计数字段 `estimated` 表示估计数量，unknown/legacyAmbiguous 表示受影响节点或条目数。记录的来源总数只能单列，不能计入下属总和。
- 数据版本、证据 namespace 冲突、未知与非零占位的规则要明确；不应把没有 version 1 的外来 `custom.orbat` 静默当作工作台资料。

恢复建议：派 **一个** Flash 测试 Agent 为 own-property 等尚未覆盖的安全问题先添加 RED；测试 Agent 停止后，恢复 `evidence-implementation` 或另派唯一 Flash 写代码 Agent，只负责 `src/model.js`/`src/evidence.js`，跑 `node --test tests/evidence-model.test.js tests/model.test.js` 到绿，再跑全量并做独立审阅。不要把目前10项RED当作可忽略的旧失败。

## 后续责任区与关键风险

- **责任区2：** 实现原生完整备份、装备目录与模板持久化，真实支持非空自定义装备库。`Workspace` 现有 `emptyState/parseState/#buildState` 都只复制旧五个字段；不修这三处就会丢新资源。计划裁定 v2、明确迁移 v1、资源独立 revision/CAS；旧版本解析器必须 fail closed。旧 Host 已打开数据时不能另起新 Host 写同一目录；即使加状态版本也挡不住旧进程的内存覆盖。
- 原生备份要保留文档/节点 ID 与 revision，默认 merge 遇 ID 冲突拒绝；显式 clone 则新 ID 并返回映射/损失报告。不得把“重建 ID”称为无损。完整 workspace 历史/sequence 是否包含须严格说明。
- **责任区3：** 工具和网页共用的筛选分页、模板、装备项增删改、资料合并、批量预览+提交、目标及跨文档源 revision 守卫；预览无写入，提交只信服务端重算，冲突原子回滚。`baseSequence` 仅诊断，不得使无关文档变化阻挡合理提交。
- **责任区4：** 网页结构化装备表/检索、资料与数量状态、直属/合计、模板和筛选批量预览；渲染 `editor/list` 区分不完整且不在名称加示意。注意来源元数据进入 stack 指纹时，不得错误合并或让资料不可访问。最终运行 `pnpm run build`，不得让构建覆盖其他 Agent 正在改的前端文件。
- **责任区5：** 改 `skills/orbat-workbench/SKILL.md`、工具协议及 README，先基于之前 baseline 设计技能场景 RED/GREEN；使用 Flash 测试且不操作真实工作区。
- **责任区6：** 端到端集成、审阅、`pnpm test && pnpm run check`、图像读取和原站兼容验证。格式报告必须区分已验证/未验证；`orbat_validate` 目前只给固定警告，不能当历史事实校验。
- 上游项目参考副本 `/tmp/army-editor-survey-rmr1y7lv`（临时）：`equipment.js:181–263` 定义 `equip` 为按 id 的装备库对象，节点 `eqId` 找不到时原站可能按名称重新匹配或建 misc 占位；`io.js:210–217` bundle 导入可能加载地图和装备库。不要声称对真实网页的往返已验证。

## 共享编制现场

- 交接时实际读取 `orbat_workspace {since:12}` 和 `orbat_changes {since:12}`：`sequence:12`，无新增变化。
- 目标 `d_ef73fd41-0094-483a-ad0e-61a849339471`：`苏联近卫第4坦克师 · 1988年（新建）`，revision 5，162 节点。此前本 Agent 添加的名称带 `【示意】`，人数装备尚未填；**本轮未做清理和填数**。
- 原始 `d_af0be118-8b53-4483-8000-09b12d799b86`：revision 1，15 节点；不随意覆盖/删除。
- 开始真实编辑前重读 `orbat_workspace`、从上次实际消费 cursor 12 继续 `orbat_changes`（新会话未掌握 cursor 时从0分页），并 `orbat_read` 目标及查询节点。只清理能确认是本 Agent 写入、且未被人类修改的前缀；如 CONFLICT 重新读取并重建操作，不增加 revision 强行重放。
- 年代资料参考 [Michael Holm 1988 第4近卫坦克师](https://www.ww2.dk/new/army/td/4gvtd.htm) 和 [1991 FM 100-2-3](https://doksi.net/en/get.php?lid=40620)：团以下通用结构、1985/1990装备不能当成1988逐单位实数。尤其1988年是近卫第43坦克团，第14团1989年才接替。

## 未做 / 不要误报

- 除责任区1部分实现外，**原生格式、装备库、批量工具、网页、skill 改造、编制修复均未完成**。
- 当前源码与测试处于刻意保留的 RED 状态；没有运行修改后最终全量门禁、没有进行 GUI 或原站导入实测。
- 本会话未重启 DSH、未重新安装插件或更改 profile；不要承诺网页已采用新版后端。
- 不需要、也不要运行 `git init`、`git clean`、脚本直写共享工作区。最终请说明当前文件、测试输出、未验证项；用户要的是实际可用的文游编制与完整功能，而非只写计划。
