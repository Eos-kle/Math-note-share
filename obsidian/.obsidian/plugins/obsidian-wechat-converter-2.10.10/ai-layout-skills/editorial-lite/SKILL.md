---
name: editorial-lite-layout
description: 轻杂志型 skill。强调导语、留白、编辑感节奏和更克制的图文关系。
---

# Editorial Lite Layout Skill

这个 skill 用于把文章排成“轻杂志型”的内容稿。

## Guardrails

- 强调节奏和留白，不要每段都卡片化
- 不默认教程导航
- 不默认手机壳
- lead-quote 可以更强，但不能改写观点
- `section-block` 依然要承担正文保真职责；原文里的 `callout`、代码块、表格、嵌套列表等特殊结构应尽量保留，不要为了 editorial 节奏把它们压平成普通文字
- 公众号可见文本里不能出现裸 Markdown 源码；任务清单 `- [ ]` / `- [x]` 必须改为 `☐` / `☑` 文本，长清单要拆成手机端更稳定的短段落
