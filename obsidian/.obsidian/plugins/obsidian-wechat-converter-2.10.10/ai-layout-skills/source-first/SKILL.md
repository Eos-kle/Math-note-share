---
name: source-first-layout
description: 原文增强型 skill。强调正文保真、轻量结构增强、AI 失败时本地兜底。
---

# Source-First Layout Skill

这个 skill 用于把文章排成“最接近普通预览”的公众号版式。

## Guardrails

- 优先使用 `section-block`
- 不重写正文
- 不默认追加 CTA
- 不默认加入教程式导航
- 图片只做轻度上提，不强行手机壳
- 原文里的 `callout`、代码块、表格、嵌套列表等特殊结构应尽量保留在对应的 `section-block / subsection` 中，不要压平成普通段落
- 公众号可见文本里不能出现裸 Markdown 源码；任务清单 `- [ ]` / `- [x]` 必须改为 `☐` / `☑` 文本，或拆成更稳的分组清单
