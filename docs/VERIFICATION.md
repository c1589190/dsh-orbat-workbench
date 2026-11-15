# 验证记录 · 2026-11-15

## 1. 源码、测试与构建

- `pnpm run build`：生成真实浏览器artifact，将同一份已测试的client-policy嵌入Client factory；未启动Vite或替代服务器。
- `pnpm run check`：Host/Client和全部源文件语法、manifest资源、双语metadata通过。
- `node --test --test-reporter=spec tests/*.test.js`：**98 tests / 98 pass / 0 fail**；完整输出在 `artifacts/tests.txt`。Node环境带UNDICI-EHPA实验性代理警告，不是插件测试失败。
- 独立deepseek-flash代码/UX审查发现真实GET桥接错误；读取DSH实际bridge源码并用Request构造回归先RED再GREEN。GET改buffered，POST保留streaming，SSE仅GET。
- 前端策略回归覆盖最小字段patch、不改隐藏customName、已载入历史合并实时记录、长值截断提示、冲突后先刷新、旧保存回执不清新草稿。没有React/DOM模拟，不将这些纯函数测试称为浏览器验收。
- 多文档失败回滚、并发修订、循环移动、根保护、持久化重开、历史缺口、JSON导入导出、PNG/XML转义/尺寸与聚焦均有测试。
- 对最初误猜的type/layout做过上游证据复核与修正；最终为27个旧键+8个确切ms别名，layout仅h/v。没有复制上游整套编辑器。
- `pnpm pack --pack-destination artifacts` 已检查真实打包清单，包含Host、Client artifact、源代码、tests/scripts、技能、文档、locale、图标、LICENSE；不包括用户工作区数据和node_modules。

## 2. 真实运行中工具验收（不是单纯单元测试）

本会话成功加载 `skill('orbat-workbench')`，实际返回本项目内置使用说明与资源目录。

实际 `orbat_workspace` 读取到两份预置编制；随后：

1. `orbat_read` 获取蓝r3、红r2和真实节点id。
2. 一次真实 `orbat_edit` 只更新两个根节点备注，成功提交 **sequence5**；蓝 **r3→r4**，红 **r2→r3**。
3. 真实 `orbat_changes(since4)` 返回AI来源、会话id、两文档before/after修订和两个remark字段差异。
4. 再故意以蓝旧r3、红当前r3提交两文档事务，返回 **CONFLICT**。重读后仍为sequence5、蓝r4/红r3，两份备注均为成功事务内容，没有负向测试标记，确认无部分提交。
5. `orbat_query` 核实模拟人类改的“青松尖兵班”仍在，稳定id未变、人数10。
6. 真实 `orbat_render` 一次输出两份PNG/SVG，每图19/19节点、未截断；用 `read_image` 实际查看两张788×1492 PNG，中文、层级、直属与子树人数可读。
7. 真实 `orbat_export` 输出两份 `mil-bundle`；`orbat_validate` 返回每份140人、108件装备、19节点。固定演示文件对应当前已验收数据。

预置sequence1–4有明确“演示脚本/模拟网页用户”标签，不冒充本次用户操作。sequence5才是本会话的真实AI工具事务。未声称有人在真实网页手工点击过。

## 3. 当前 DSH 注册与安装状态

- `plugin_manager install_bundle /home/cna/bqty` 包管理exit0，已登记 `@local/dsh-orbat-workbench@0.1.0`，但 **application=restart-required**，reason=`unmanaged-plugin`。
- 管理器nextStep要求重启DSH；未擅自重启用户正在用的实例。请**重启DSH，再刷新现有 http://127.0.0.1:3080**，使正式profile安装状态一致。
- 同时，本会话已实际可调用上述工具、加载skill并收到动态工作区上下文；Client Inspect确认现有页面 `sidebar.panellist` 有active的`orbat-workbench`入口，`main`也有active的同名面板。
- Config目录中条目status=`absent`，本插件未导出Config schema；这不是用来证明已激活/未激活的依据。
- 上述事实不能替代管理器的restart-required；**不宣称正式热安装全链路已经applied**。
- 对现有3080端口匿名HTTP请求：根页面、工作区state、preview均返回401，符合DSH认证边界；没有提取浏览器cookie或密钥。**没有完成带认证的浏览器HTTP/SSE实际点击测试**。Node层resource与bridge特征化已测，但不是鼠标操作替代。

## 4. 明确未验收 / 已知范围

- 无浏览器控制工具：未做真实DSH页面视觉、点击、键盘、深浅主题、两个标签页并发手动编辑验收；slot active不等于视觉通过。
- PNG是产品树图，不是DSH UI截图，不是上游网页截图。
- 未在上游网页通过鼠标执行JSON导入、导出图片或实际对局；兼容性根据核实源码、字段与本地JSON审计。
- 不自动同步未改造的GitHub公共网页；没有地图/自定义装备数值导入、跨进程锁、CRDT、多人权限或不可篡改审计。
- 每树2000节点、24层、事务1000操作、历史500项、默认预览200节点。大规模内存/总文档压力未验收，不适合不可信公网多租户。
- reference skill有无指导操作场景测试，另有本会话真实工具调用；不声称已经完成任意模型/任意prompt的可靠性评测。

更多审查边界见 REVIEW.md；使用步骤见 README.md 和 TOOLS.md。
