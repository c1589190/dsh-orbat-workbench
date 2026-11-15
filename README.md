# 编制协作工作台 · DSH 插件 Demo

一个**人和 AI 共用数据与操作**的多编制工作台。对接 Army_Editor 1.8.0 的 JSON 文件格式；兵牌图适配其布局与显示方式，但不是原编辑器的完整嵌入，也不声称可无侵入同步其 GitHub 公共网页。

## 已实现

- 同时管理多份编制；创建、复制、导入、删除，节点增删/改名/移动/替换。
- AI 用一次 `orbat_edit` 原子修改多份文档；跨文档批量修改先 `orbat_plan` 预览（diffs/stats/warnings，不写入），再用 `orbat_commit` 提交冻结计划，不重扫选择条件。
- 字段级资料与数量状态：`custom.orbat` / `item.orbat` 记录 `actual/standard/estimate/unknown/legacy-ambiguous` 与来源；统计返回 `coverage` 已知小计、未知/歧义计数，合计不完整时在网页和图片中明确标注。
- 工作区装备目录与模板库（`orbat_resources` / `orbat_update_resources`，独立 revision 守卫）；模板可克隆子树，目录支持别名与安全 JSON 性能数据。
- 原生完整备份 `exportNative/importNative`（保留文档/节点 id、revision、资料、目录、模板；merge 冲突整笔拒绝，clone 重生成 id 并返回映射），以及带 `lossReport` 的兼容导出。
- 人类网页提供结构化装备表（逐条名称/数量/状态）、人数状态与来源、批量预览/提交、模板入口和“不完整”标记。
- 文档 revision 乐观锁：过期修改返回 `CONFLICT`，整笔事务不提交，不能静默覆盖。
- 字段级 before/after、来源通道 human/ai、事务说明、修订变化；保留最近500项并报告历史缺口。
- 原生 DSH sidebar “编制协作”页面；SSE同步其他标签页和AI工具改动。表单草稿保留基础修订，遇到远端修改提示重读。
- 按 Army_Editor 兵牌与横纵层级布局适配的编制图（默认），以及可切换的原有列表布局；使用 MIT milsymbol 军标，输出 SVG 与同源 PNG，网页和图片共享同一渲染结果。
- `mil-org` 单份和 `mil-bundle` 多份导出；导入裸树/单份/多份编制。节点内部 id 导出时剥离。
- 安装时注册内置 `orbat-workbench` reference skill 和简短发现提示，不覆盖现有 skill-filesystem 配置。

## 本地运行与安装

要求 Node.js >=22，DSH >=0.2.2-rc.3 <0.3.0（仅在0.2.2-rc.3验证），Web profile。

```sh
pnpm install
pnpm run build
pnpm test
pnpm run check
# 只在未被运行中插件打开的目录初始化演示数据；有文档时不会重新播种
pnpm run demo
```

在 DSH “插件 → 添加插件”安装本项目目录，或请有权限的agent使用：

```json
{"action":"install_bundle","target":"/home/cna/bqty"}
```

不要手工修改 profile 配置或用包管理器在 profile 中安装。安装会对当前 profile 生效，不启动新服务器。

若插件管理器返回 `restart-required`，请先重启 DSH；本次安装登记确实返回该状态，具体运行证据见验证记录。不要把已看到部分工具/入口当作正式热安装全部完成。

安装后刷新**现有 DSH 页面**（本次为 http://127.0.0.1:3080），从侧栏进入“编制协作”。本目录的纯JS client 即交付artifact，由 `pnpm run build` 将前端源文件与已测试的纯协作策略合并生成，不需要启动Vite。是否自动刷新取决于宿主；本demo不承诺免刷新更新。更新已加载的Host代码可能需要重启DSH。

## 体验人机协作

1. 运行演示播种后，有“蓝方·青松步兵营”和“红方·赤岩步兵营”。预置变更均标注为**演示脚本/模拟网页用户**，不是你真的操作过。
2. 打开两个现有DSH浏览器标签：一个保留聊天，一个进入“编制协作”。两页访问同一DSH实例，不是开第二台服务。
3. 在工作台选择节点，修改名字/直属人数/装备，点击保存。另一页和AI下一步会见到sequence/修订变化。
4. 在对话里说：“同时把两份编制的步兵班各补1人，保留我刚改的番号；读取人工变化，生成预览并导出。”
5. 网页历史区能看AI来源、字段前后值；AI使用 `orbat_changes` 读取人工变化。当前context提示只报告有界摘要，详情以工具结果为准。
6. 同时在两页编辑同节点：先保存一页，再保存旧页。旧页应报修订冲突并保留草稿。不要为绕过冲突直接覆盖数据文件。

可以在聊天输入 `/orbat-workbench` 显式加载使用说明。技能提供规则，不是模型训练；历史考据和装备数值不能由格式校验替代。

### 批量加载自己的 skills

插件使用独立 provider，扫描包内 `skills/` 与 Host 配置 `skillDirs` 中的绝对目录。每个根支持直接子目录中的技能说明文件，也支持根下扁平 `.md`。合法 frontmatter 必须含 name/description；非法项告警并跳过。文件每次加载重读，目录新增/删除由 fs.watch 触发目录失效（监视失败时有警告）。最多16个根、每根1000项、每技能256KiB。默认只附带一个使用本工作台的 reference skill，领域规则/史料技能由你另外添加，不冒充已有知识库。

安装前可在本包 patch 的该行config中设置，或安装后通过DSH受支持配置机制修改（本demo未提供专门配置表单）：

```yaml
config:
  skillDirs:
    - /绝对路径/你的兵棋技能集
```

只加载你信任的技能目录；skill正文是给模型的指令，不是无害数据。相对目录会被拒绝。

## 图片与导出

- `orbat_render` 返回实际 `pngPath/svgPath`，AI须调用 `read_image` 后才可称已看图；用 `present` 或Markdown图片给人看。
- 默认预览最多绘制 200 张兵牌（列表模式最多 200 行）；相同节点堆叠时代表的节点数可超过 200。受最大 2400×16000 像素限制；节点截断会明确提示，长标题和名称可能以省略号缩短。聚焦更小子树检查，不能再次聚焦同根假装解决。
- 默认“兵牌编制图”适配原站的横纵层级布局，亦可切换“列表”；网页和 PNG 显示同一模式，并支持滚动查看宽图。预览不是原网站截图，字体等差异不保证像素一致。大图会按限制缩放或明确提示截断。现有节点显式保存的 `stack` 值保持不变，本工作台新建节点默认不堆叠（与原站不同），不擅自改动现有数据。运行中的 Host 须载入新版渲染器；若页面提示服务仍为旧版，重启 Host 并刷新页面后才可切换。
- 单份 `mil-org`：原编制编辑器“加载 → 从文件打开”。
- 多份 `mil-bundle`：原编制编辑器“导入全部 → 加载对应存档”。bundle的 `equip` 携带工作区装备目录（兼容字段，不含别名）；地图不在导出范围。`mil-org` 不带目录。兼容导出会返回逐项损失报告，不能当无损往返。

## 数据与安全边界

- 默认共享数据：本包目录的 `.workbench/workspace.json`；生成文件在 `artifacts/`。整个profile共用一个demo工作区，**不按会话/项目隔离**。
- Host配置可传绝对 `dataDir`、`artifactDir`（配置schema表单暂未提供）；迁移前停用插件，复制整个数据目录，并避免两个实例打开同一目录。
- 同实例写入串行，整份workspace原子rename落盘；没有跨进程文件锁、多用户权限、CRDT/自动字段合并或不可篡改审计。
- 来源kind由UI/API或AI工具通道设置，忽略网页JSON里伪造actor；这是操作通道标签，不是人员身份认证。
- HTTP使用DSH原生认证 `/api` Fetch桥，仅owner可调用；写入另要求同源Origin和JSON，2MiB请求上限。没有另开端口或未认证裸路由。
- 输入限每树2000节点、24层、每事务1000操作；历史保留500项。复杂/超大真实军队应拆文档和分批预览；不适合作为不可信公网多租户服务。
- 精确支持27个上游旧type和8个已核对ms别名，不是上游完整标准符号目录。其他ms键明确报错，不悄悄变空白。
- 未知安全节点字段可保留；`mil-org`/`mil-bundle` 的非空上游装备库会原子合并进工作区目录，重名/别名冲突整笔拒绝。`mil-bundle` 的地图字段不在本demo导入范围。
- 人数/装备是本级直属数量，父子递归相加。没有史实校验、游戏平衡校验；单份编制缺失装备库时原站可能只补占位。
- 闲置AI不会因人类每次编辑自动发起付费请求；运行中的AI在下一步看动态状态，用变化工具获取精确diff。

## 源码导航

- [设计](docs/demo-design.md)、[实施计划](docs/superpowers/plans/2026-11-15-orbat-demo.md)、[进度/决定](docs/progress.md)
- [模型与校验](src/model.js)、[持久化/事务](src/workspace.js)、[共用应用操作](src/application.js)
- [AI工具](src/tools.js)、[HTTP边界](src/http.js)、[图片渲染](src/render.js)
- [DSH Host](index.js)、[DSH Client](client.js)、[内置技能](skills/orbat-workbench/SKILL.md)
- [工具参考](docs/TOOLS.md)、[验证记录](docs/VERIFICATION.md)、[独立审查与修复](docs/REVIEW.md)、[技能场景测试](docs/SKILL_TEST.md)、[第三方声明](docs/THIRD_PARTY.md)

## 验证诚实性

实际测试和安装结果以验证记录为准。没有浏览器控制时，Host/Client slot注册不等于已视觉验收；真实产品PNG也不是DSH页面截图。本demo不承诺已在第三方网页完成鼠标导入/对局验收。
