---
name: wechat-ai-layout
description: 为 Obsidian 微信公众号转换器生成受约束的 AI 编排结果。只在需要把文章内容映射为公众号安全 block JSON、诊断编排结果、优化 layout schema、分析 fallback 介入原因时使用。遇到教程、案例、产品介绍、截图型内容时应优先考虑这个 skill。
---

# WeChat AI Layout Skill

这个 skill 的目标不是直接输出 HTML/CSS，而是输出一份受约束的布局 JSON，然后交给插件渲染。

## Always follow this workflow

1. 先识别文章结构
   重点看标题层级、导语段落、列表、截图和可选的结尾总结。
2. 只使用允许的 block type
   不要发明新的 block 名称。
3. 只填允许的字段
   不要输出额外 HTML、className、style 或脚本。
4. 正文主体优先使用 `section-block`
   通过 `sectionIndex` 引用原文章节，不要重写正文。
5. 如果图片不可用
   依然要输出合理布局，但不要编造图片 URL。
6. 如果原文结构很弱
   允许用摘要卡和 case-block 做轻量补全，但不要重写作者观点。
7. 保真优先
   不要只处理前半篇，也不要为了版式省略后半部分主要内容。
8. `phone-frame` 仅用于明显像截图/界面的图片
   普通配图不要强行套手机壳。

## Allowed blocks

- `hero`
- `part-nav`
- `lead-quote`
- `case-block`
- `section-block`
- `phone-frame`
- `cta-card`

详细字段约束见 [schema/article-layout.schema.json](/Users/davidlin/Documents/Obsidian/MyVault/.obsidian/plugins/obsidian-wechat-converter/ai-layout-skill/schema/article-layout.schema.json)。

## Layout families and color palettes

当前内置布局风格与配色方案见 [assets/style-packs.json](/Users/davidlin/Documents/Obsidian/MyVault/.obsidian/plugins/obsidian-wechat-converter/ai-layout-skill/assets/style-packs.json)。

- `layoutFamily`
  控制排版骨架，例如 `source-first`、`tutorial-cards`、`editorial-lite`
- `colorPalette`
  控制颜色语气，例如 `tech-green`、`ocean-blue`

如果用户选择了 `auto`：

- 你需要给出 `recommendedLayoutFamily`
- 你需要给出 `recommendedColorPalette`
- 并在 `resolved` 中写出最终采用的布局和颜色

## Output template

优先参考 [templates/article-layout.template.json](/Users/davidlin/Documents/Obsidian/MyVault/.obsidian/plugins/obsidian-wechat-converter/ai-layout-skill/templates/article-layout.template.json) 的结构。

## When diagnosing bad results

如果用户提供的是调试快照或 Prompt 上下文：

1. 先判断问题属于哪类
   `prompt`, `schema`, `provider config`, `image context`, `fallback strategy`
2. 明确指出是哪一个 block 不合理
3. 优先给“下一步最值得改的一处”
4. 如需建议新的布局，仍然使用 schema 允许的字段和 block

## Guardrails

- 不输出 HTML
- 不输出 CSS
- 不输出任意自定义组件
- 不编造图片、数据或原文没有的结论
- 不把 fallback 逻辑描述成 AI 自己完成的结果
- 不默认追加 CTA
