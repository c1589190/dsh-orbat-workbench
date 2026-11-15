# 原编辑器样式编制预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Checkboxes track concrete steps.

**Goal:** 工作台网页与导出图默认按原 Army_Editor 兵牌风格呈现，同时保留列表模式。

**Architecture:** 同一 `renderDocument(doc,{mode,nodeId,maxNodes})` 生成 SVG 与 PNG；`editor` 适配原站递归布局，`list` 保留原实现；application、HTTP、AI 工具与网页模式参数共享并分离缓存及产物文件。布局逻辑不改存储。

**Tech Stack:** Node 22、milsymbol、resvg、DSH Host/Client、node:test。

**Spec:** docs/superpowers/specs/2026-11-15-editor-style.md

## Global Constraints
- 不修改或覆盖现有编制数据，不开新服务器，不修改 profile，不擅自重启。
- 上游源码只作本地适配并保留署名来源/未明许可证状态；不主张授权或分发。
- 独立 renderer 与网页使用相同 SVG，未知 mode 拒绝，缓存/产物区分模式。
- TDD：先写测试并观察 RED，后最小实现和绿色回归。不能删除代表原本安全约束的断言。

## Review Focus
1. 上下级 h/v 混排，折叠及堆叠不可造成同名不同单位数据被错误隐藏。
2. 导出与网页模式一致，缓存命名隔离，不误读旧模式。
3. 恶意文本的 XML 转义，节点和像素预算，任何内容裁剪均须明确。
4. 树数/直属与子树人数/装备统计准确，不能误写实际 workspace。
5. 当前 DSH 运行实例与改动后的源码不同步时明确报告。

## Task 1: 核心兵牌渲染
**Files:** src/render.js、tests/render.test.js、tests/editor-render.test.js。
- [ ] 编写 h/v 坐标、连接、角标、折叠、堆叠、转义、尺寸与截断的失败测试；验证 RED。
- [ ] 参考上游 render.js/model.js/io.js 最小适配，不篡改节点，editor 为默认；list 仍可按原渲染器运行。
- [ ] 单独运行渲染测试、记录结果，保留上游出处和作者说明。

## Task 2: 模式贯通与网页
**Files:** src/application.js、src/http.js、src/tools.js、src/client-ui.js、相关测试、构建后的 client.js。
- [ ] 真实 application/HTTP tests 先断言 editor/list 参数、缓存隔离、错误输入和不同产物文件名；观察 RED。
- [ ] 实现参数传播、隔离缓存及文件名；网页提供两种选择，展示自然比例图片及滚动，导出链接跟随当前选择。
- [ ] 运行相关测试并构建 client；不触碰工作区数据、用户 profile 或实际运行 Host。

## Task 3: 整体验证与文档
**Files:** README.md、docs/TOOLS.md、docs/THIRD_PARTY.md、docs/progress.md。
- [ ] 更新模式、限制、源码来源与作者说明，不错误声称标准许可证或像素一致。
- [ ] 所有改动审查、pnpm test、pnpm run check，记录命令结果；用本地隔离样例直接调用真实 renderer 导出 PNG 并 read_image 检查。
- [ ] 尝试在已有 URL 上仅做不改变配置的验证；如运行中 Host 仍是旧版本或无法控制浏览器，如实给出下一步，不启动替代服务。
