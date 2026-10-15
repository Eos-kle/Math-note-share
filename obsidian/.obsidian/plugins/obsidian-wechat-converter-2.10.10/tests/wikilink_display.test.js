/*
## 核心功能

覆盖 wikilink display 相关行为的 Vitest 测试用例。

## 输入

接收被测模块、mock 的 Obsidian/jsdom 环境、fixture Markdown/HTML 和断言数据。

## 输出

输出自动化断言结果，保护渲染、同步、设置、安全或 UI 行为不回归。

## 定位

位于 tests/，是回归测试层；测试应描述用户可见或服务契约行为。

## 依赖

关键依赖：Vitest 与被测的 wikilink display 模块。

## 维护规则

- 修改逻辑后同步更新本文件说明书，并检查 tests 的文件夹 README 是否仍准确。
- 保持职责边界清晰，跨层行为优先通过既有服务、视图或测试 helper 协作。
*/

import { describe, it, expect } from 'vitest';
const {
  WIKILINK_TEXT_ICON,
  resolveWikilinkDisplayText,
  replacePlainWikilinksWithDisplayText,
} = require('../services/wikilink-display');

describe('Wikilink display text', () => {
  it('should prefer the alias over target and ignore heading/block references', () => {
    expect(resolveWikilinkDisplayText('1.1泛函分析#^4e7892|压缩映射原理')).toBe('压缩映射原理');
    expect(resolveWikilinkDisplayText('1.1泛函分析#压缩映射原理|压缩映射原理')).toBe('压缩映射原理');
    expect(resolveWikilinkDisplayText('笔记| 别名 带空格 ')).toBe('别名 带空格');
  });

  it('should fall back to the note name without folder path or extension', () => {
    expect(resolveWikilinkDisplayText('1.1泛函分析')).toBe('1.1泛函分析');
    expect(resolveWikilinkDisplayText('泛函分析/笔记/1.1泛函分析')).toBe('1.1泛函分析');
    expect(resolveWikilinkDisplayText('泛函分析/笔记/1.1泛函分析.md')).toBe('1.1泛函分析');
    expect(resolveWikilinkDisplayText('1.1泛函分析#压缩映射原理')).toBe('1.1泛函分析');
    expect(resolveWikilinkDisplayText('1.1泛函分析#^4e7892')).toBe('1.1泛函分析');
  });

  it('should fall back to the heading when the link points inside the same note', () => {
    expect(resolveWikilinkDisplayText('#压缩映射原理')).toBe('压缩映射原理');
    expect(resolveWikilinkDisplayText('#^4e7892')).toBe('4e7892');
  });

  it('should render the reported case as icon plus alias', () => {
    const output = replacePlainWikilinksWithDisplayText(
      '2. （[[1.1泛函分析#^4e7892|压缩映射原理]]）设 $X$ 是完备的度量空间。',
    );

    expect(output).toBe(`2. （${WIKILINK_TEXT_ICON} 压缩映射原理）设 $X$ 是完备的度量空间。`);
    expect(output).not.toContain('[[');
    expect(output).not.toContain('4e7892');
  });

  it('should keep image embeds and already-escaped wikilinks untouched', () => {
    const output = replacePlainWikilinksWithDisplayText(
      '正文 [[普通笔记]]\n![[assets/pic a.png|图注]]\n\\[[不是链接]]',
    );

    expect(output).toContain(`正文 ${WIKILINK_TEXT_ICON} 普通笔记`);
    expect(output).toContain('![[assets/pic a.png|图注]]');
    expect(output).toContain('\\[[不是链接]]');
  });

  it('should skip fenced code, math fences and inline code spans', () => {
    const output = replacePlainWikilinksWithDisplayText([
      '正文 [[目标文档]] 与 `[[标题]]`',
      '```',
      '[[code-link]]',
      '```',
      '$$',
      '[[math-link]]',
      '$$',
      '````markdown',
      '```',
      '[[inside-fence]]',
      '```',
      '````',
      '尾部 [[outside-fence]]',
    ].join('\n'));

    expect(output).toContain(`正文 ${WIKILINK_TEXT_ICON} 目标文档 与 \`[[标题]]\``);
    expect(output).toContain('```\n[[code-link]]\n```');
    expect(output).toContain('$$\n[[math-link]]\n$$');
    expect(output).toContain('[[inside-fence]]');
    expect(output).toContain(`尾部 ${WIKILINK_TEXT_ICON} outside-fence`);
  });

  it('should replace every wikilink on a line, including adjacent ones', () => {
    const output = replacePlainWikilinksWithDisplayText('[[A]][[B|乙]] 与 [[文件夹/C.md]]');

    expect(output).toBe(`${WIKILINK_TEXT_ICON} A${WIKILINK_TEXT_ICON} 乙 与 ${WIKILINK_TEXT_ICON} C`);
  });

  it('should escape markdown syntax inside the display text', () => {
    const output = replacePlainWikilinksWithDisplayText('[[note|a*b_c~d]] 和 [[x|`code`]]');

    expect(output).toContain(`${WIKILINK_TEXT_ICON} a\\*b\\_c\\~d`);
    expect(output).toContain(`${WIKILINK_TEXT_ICON} \\\`code\\\``);
  });

  it('should leave markdown without wikilinks untouched', () => {
    const markdown = '# 标题\n\n没有双链的段落。\n\n![img](https://example.com/a.png)';
    expect(replacePlainWikilinksWithDisplayText(markdown)).toBe(markdown);
  });
});
