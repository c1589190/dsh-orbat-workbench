# 独立代码与 UX 审查

Reviewer: deepseek-flash，独立上下文，只读；没有浏览器控制，不冒充实际视觉/点击验收。当前目录最初无Git，审查当前文件而非伪造diff。

## 已确认并修复

1. Critical：所有DSH Fetch路由误声明streaming，使Node拒绝给GET/HEAD构造body。已读实际DSH bridge源码，新增host特征化测试先3项RED、修复后GREEN。GET使用buffered，POST保留streaming，events只GET。
2. Important：加载旧历史后不再看实时变化。改为按sequence去重合并已加载与实时事件，并显示未加载区间。
3. Important：UI前30条diff与长值静默截断。现在显示差异/值截断提示，告知通过变化工具读取完整值。
4. Important：冲突只报错但不刷新，重载可拿旧revision。现在冲突后先refresh；重载直接取新state中的文档/节点，失败不丢草稿。
5. Important：保存人数却无条件设置customName=true。现在生成最小字段patch，仅名称实际变化才设置手工番号标志；显式false得到保留。
6. Important：远端删除/替换可丢草稿。现在保留带文档/节点归属的恢复JSON、删除前确认、beforeunload提醒；不自动把旧草稿应用到新节点。旧保存回执不能清掉新节点草稿。
7. Minor：聚焦图片返回URL漏nodeId。已先写回归确认失败，再修复。
8. Minor：locale disposer与duplicate参数发现性。已增加effect回收、required documentId。

前端纯策略通过Node测试验证，不用React/DOM模拟冒充浏览器验收。实际表单、点击、beforeunload浏览器行为仍需用户侧验收。

## 保留的demo边界/后续项

- 单进程单共享工作区，不做跨进程锁、权限模型、CRDT或第三方网页实时桥接。
- 大规模总文档/日志字节数、工具receipt按字节限额、内存峰值未做压力验收；当前限制每树2000、24层、1000操作、500事件、预览200节点。勿作不可信公网多租户服务。
- 英文界面部分兵种/单位文案仍有中文；当前目标用户为中文，双语meta和主要按钮存在，但不称完整英文验收。
- 人数空输入可能变0，重复点击可触发额外CONFLICT，改层级不自动改现有layout，validate以通用兼容提示为主；服务器仍阻止非法数值/过期覆盖。
- 只保证本次127.0.0.1 URL；其他trusted host的Origin策略待验收。
- skills监视失败、并发catalog/get、嵌套symlink边界未完整压力测试；只允许owner配置受信技能目录。
- 上游customName省略时自动编号行为与未知mod值保持输入兼容，不无声改已有存档；需要自定番号的新节点应明确customName:true。
