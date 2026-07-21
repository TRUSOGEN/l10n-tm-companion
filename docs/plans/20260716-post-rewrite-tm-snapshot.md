# Post-rewrite Starling TM Snapshot Plan

**Goal:** 对每条实际生成 AI rewrite 的未达标文案执行第二次真实 Starling Batch TM 查询，并在运行内保存不可变的改写后 TM 快照。

**Architecture:** `lib/starling-tm.js` 复用既有 `searchTM()` 请求协议，集中完成候选筛选、返回长度校验和失败状态映射。`popup.js` 将快照附加到已处理条目，并在结果页展示真实 post-rewrite score 或明确的 `incomplete` 状态。普通 Sheet 继续只写 A-G；金额、实际字数和加权字数不在本计划中实现。

**Constraints:** 只有 `Orig Match % < 85` 且存在非空 AI rewrite 的条目需要二次查询；接口返回的 0 分是完整快照，接口或协议失败才是 `incomplete`；失败不得写成 0 分、不得阻断原有 TM 优化结果、不得计算 ROI 金额。

## Tasks

- [x] 先为改写后查询的成功、无需查询和失败语义增加前端协议测试。
- [x] 实现 `queryPostRewriteTmSnapshots()`，并使用真实 `searchTM()` 传输改写文本。
- [x] 将快照接入 Popup 处理流与结果页，只作运行内展示，不改变 A-G Sheet schema。
- [x] 更新当前架构文档、运行定向测试和完整回归，并检查测试输出与静态语义。
