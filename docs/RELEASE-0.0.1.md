# ORBAT 编制协作工作台 0.0.1

实验性 DSH 插件：人类网页与 AI 工具共用同一工作区、同一事务核心的多编制工作台，兼容 Army_Editor 1.8.0 JSON。

## 本版内容

- 证据感知的人数和装备统计：`actual/standard/estimate/unknown/legacy-ambiguous`、`known`/`knownTotal`、未标注 0 与空清单歧义。
- 工作区 v2 资源：装备目录与模板库、独立 revision 守卫；v1 文件自动迁移。
- 原生备份 `exportNative`/`importNative`：保留文档/节点 id、revision、资料、目录与模板；clone 导入返回 id 映射；兼容导出附带确定性损失报告。
- 共享 `plan`/`commitPlan` 与 `orbat_plan`/`orbat_commit`：筛选预览无写入、提交不重扫、整笔 revision 守卫。
- 事务 `mergeCustom`、`template`、`guards`；装备项 occurrence 保留；非空上游装备库导入。
- 渲染与网页的 coverage 标注、未知人数 `?`、结构化装备表、人数状态/来源、模板入口、批量预览后提交。
- 更新后的内置 `orbat-workbench` skill 与工具协议/README。

## 安装

要求 Node.js >= 22，DSH `>=0.2.2-rc.3 <0.3.0`，Web profile。

```sh
# 方式一：用 DSH 插件命令安装 release 中的 tgz
dsh plugin --profile web add /path/to/local-dsh-orbat-workbench-0.0.1.tgz

# 方式二：通过 DSH 插件管理器安装同一个 tgz
```

安装后重启 DSH Host 并刷新页面；运行中的旧 Host 不会自动获得新工具、资源库与渲染器。

## 验证

- `pnpm run build` 成功
- `node --test tests/*.test.js`：191/191 通过
- `node scripts/check.mjs`：rc=0
- tarball 在空项目中 `pnpm add` 安装成功，包内 `scripts/check.mjs` 通过

已知未验证：真实浏览器视觉/点击、Army_Editor 网页导入往返、正在运行的 DSH Host 上的新版工具（需重启）。历史数值与装备为可玩估算，不构成史实保证。
