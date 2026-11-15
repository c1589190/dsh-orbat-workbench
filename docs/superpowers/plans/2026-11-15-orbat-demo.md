# Orbat workbench demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付多编制、人机协作、可渲染与可导出的实验性 DSH 插件。

**Architecture:** Host 的持久化 Workspace 是唯一应用数据源，UI 与 AI 共用 dispatch。所有写入校验 expectedRevision，批量事务原子提交并记录来源与字段差异；通过 SSE 与动态上下文传播变化。Client 为 DSH 原生 slot 页面，不嵌入外部 HTML。

**Tech Stack:** Node ESM、node:test、DSH Cordis Host/Client、React browser module、milsymbol、@resvg/resvg-js。

**Spec:** ../../demo-design.md

## Global Constraints

- 用户指定当前目录 /home/cna/bqty；不建 worktree、不改 DSH 源码。
- 子 agent 使用 deepseek-official/deepseek-flash。
- 兼容 Army_Editor 1.8.0，导出 mil-org / mil-bundle，节点 id 仅内部保留。
- 不同步未改造的第三方 GitHub 网页，使用本插件 DSH 页面协作。
- 所有 mutation 均有 expectedRevision；API 来源 human，工具来源 ai，不允许调用者伪造。
- 使用现有 DSH HTTP server，不启动替代服务器，不从浏览器档案获取凭据。

## Review Focus

- 过期表单保存不得覆盖其他人或 AI 的修改。
- 多编制批量修改中任何一步失败不得部分提交。
- 非法 ID/路径/超大输入不得越界读写或耗尽渲染资源。
- 节点人数字符串、负值、父级重复合计必须校验或明确语义警告。
- 节点名称等不可信文本必须转义；历史缺口必须显式报告。

### Task 1: 编制模型与持久化工作区

Files: src/model.js, src/workspace.js, tests/workspace.test.js。
Interfaces: Workspace.open(directory) -> Promise<Workspace>; snapshot() -> {sequence,documents,changes}; transaction({edits:[{documentId,expectedRevision,operations}],summary},actor) -> result; create({name,root},actor); import(payload,actor); export(documentIds,format); changes(since,limit); subscribe(listener)->dispose。
Operations: update(nodeId,fields), add(parentId,node,index?), remove(nodeId), move(nodeId,parentId,index?), replace(root), rename(name)。
- [ ] 先写测试：两文档创建、批量成功、批量失败回滚、并发一成一 conflict、字段 before/after、重新打开数据一致。
- [ ] node --test tests/workspace.test.js 确认 RED。
- [ ] 最小实现并验证 GREEN，包含 id/层级/直属统计与导出兼容。

### Task 2: 产品渲染

Files: src/render.js, tests/render.test.js。
Interface: renderDocument(document,{maxNodes=200}) -> {svg,png:Buffer,width,height,shown,total,truncated}; input document={id,name,revision,root}，root 有 id/type/echelon/name/personnel/equipment/children。
- [ ] 写测试验证 SVG 标题/中文、PNG signature、恶意文本转义与大树明确截断。
- [ ] 确认 RED 后实现同一 SVG 用于网页与 PNG。
- [ ] 完整运行渲染测试，确认尺寸/资源限制。

### Task 3: DSH Host 集成与网页 UI

Files: index.js, src/application.js, src/http.js, src/tools.js, client.js, package.json, cordis.patch.yml, locale/*, icon.svg, tests/application.test.js, tests/http.test.js。
API: GET /api/orbat-workbench/state, GET /events (SSE), POST /action ({action,...}), GET /preview/:id.svg|png, GET /export?ids=...&format=mil-org|mil-bundle。Shared dispatch(action,args,actor)。
- [ ] 写应用/HTTP 测试：人类来源、工具来源、revision conflict、资源路径拒绝、同源保护。
- [ ] 验证 RED 后实现统一 dispatch，再实现 Host routes/tools/skill provider。
- [ ] Client 注册 main 面板，订阅 SSE；节点表单保留基础 revision 和草稿；冲突保留输入并提示重读。
- [ ] 创建原始图标、中英 metadata，校验语法和打包文件列表。

### Task 4: 内置技能与演示文档

Files: skills/orbat-workbench/SKILL.md, README.md, docs/TOOLS.md, docs/VERIFICATION.md, docs/progress.md。
- [ ] 在无 skill 的新上下文运行使用场景并记录真实错误/未知项。
- [ ] 根据错误写 reference skill，名称/描述合法，正文简洁，使用真实工具契约。
- [ ] 有 skill 场景验证：先读变更与revision、多文档事务、冲突重读、渲染交付。
- [ ] 文档说明安装、进入页面、多人两页协作、工具、存储、备份、限制与上游来源。

### Task 5: 集成验收与评审

- [ ] 运行 pnpm test（全部测试）、node --check、pnpm pack 文件清单。
- [ ] plugin_manager 先 list 再安装当前目录；核实 application / warnings，不手改 profile。
- [ ] 在现有 URL 请求真实 API：建立两份 demo、human/ai 操作、冲突、导出、SVG/PNG。
- [ ] 用 read_image 查看真正产品 PNG，不伪造 UI 截图。
- [ ] deepseek-flash 独立代码与 UX 审查，修复重要项并重跑全部测试。
- [ ] 文档标明未完成的视觉/UI控制、第三方网页双向桥接和生产级协作限制。

当前目录起初为空且不是 Git 仓库；不假造 commit/branch。用户要求源码与文档留在此处，进度留在 docs/progress.md。
