/*
## 核心功能

把普通 Obsidian 双链（`[[笔记#标题|别名]]`）转换成公众号正文里可读的「📄 显示名」纯文本，
替代此前直接转义、导致原始语法暴露在正文里的做法。

## 输入

接收 Markdown 文本字符串。

## 输出

输出 `WIKILINK_TEXT_ICON`、`resolveWikilinkDisplayText`、`replacePlainWikilinksWithDisplayText`，
供 native 与 triplet 两条渲染管线的预处理器共用。

## 定位

位于 services/，属于 Markdown 预处理层；只按 Obsidian 的显示规则取文字，
不查询 vault、不生成可点击链接，也不改 `![[...]]` 图片嵌入。

## 依赖

关键依赖：`./markdown-utils.js` 的 `parseFencedBlockDelimiter`。

## 维护规则

- 修改显示规则后同步更新 `tests/wikilink_display.test.js` 和两条管线各自的预处理测试。
- 保持职责边界清晰，跨层行为优先通过既有服务、视图或测试 helper 协作。
*/

import { parseFencedBlockDelimiter } from './markdown-utils.js';

/**
 * 双链在公众号正文里的前缀图标，对齐 Obsidian 主题给内部链接加的文档小图标观感。
 * @type {string}
 */
export const WIKILINK_TEXT_ICON = '📄';

/** 普通双链匹配：`[[目标]]` 或 `[[目标|别名]]`，不跨行。 */
const WIKILINK_PATTERN = /^\[\[([^[\]\r\n]+?)\]\]/;

/** 行内代码跨度：`代码` 或 ``代码``，整体保留不参与双链替换。 */
const INLINE_CODE_PATTERN = /^(`+)[\s\S]*?\1/;

/** 行内 Markdown 语法字符，避免别名里的符号被当成格式语法渲染。 */
const MARKDOWN_INLINE_SPECIAL_PATTERN = /[\\`*_[\]<>$~]/g;

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeMarkdownInlineText(value) {
  return String(value || '').replace(MARKDOWN_INLINE_SPECIAL_PATTERN, (char) => `\\${char}`);
}

/**
 * 按 Obsidian 的显示规则取双链文字：别名优先，其次笔记名（去掉文件夹路径与 `.md` 后缀），
 * 标题与块引用不进入显示文字；`[[#标题]]` 这类同笔记链接回退到标题本身。
 * @param {unknown} inner 双链内层文本，例如 `文件夹/笔记#^4e7892|压缩映射原理`
 * @returns {string}
 */
export function resolveWikilinkDisplayText(inner) {
  const raw = String(inner || '');
  const pipeIndex = raw.indexOf('|');
  const linkTarget = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
  const alias = (pipeIndex >= 0 ? raw.slice(pipeIndex + 1) : '').trim();

  if (alias) return alias;

  const hashIndex = linkTarget.indexOf('#');
  const filePart = (hashIndex >= 0 ? linkTarget.slice(0, hashIndex) : linkTarget).trim();
  const sectionPart = hashIndex >= 0 ? linkTarget.slice(hashIndex + 1).trim() : '';

  if (filePart) {
    const noteName = filePart
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.md$/i, '')
      .trim();
    if (noteName) return noteName;
  }

  return sectionPart.replace(/^\^/, '').trim();
}

/**
 * 逐行替换双链，跳过行内代码跨度。
 * 从左到右扫描，保证「行内代码里的双链」保持原样，而「别名里含反引号的双链」仍能整体替换。
 * @param {string} line
 * @returns {string}
 */
function replaceLineWikilinks(line) {
  const value = String(line || '');
  if (!value.includes('[[')) return value;

  let result = '';
  let index = 0;

  while (index < value.length) {
    const char = value.charAt(index);

    if (char === '`') {
      const codeSpan = INLINE_CODE_PATTERN.exec(value.slice(index));
      if (codeSpan) {
        result += codeSpan[0];
        index += codeSpan[0].length;
        continue;
      }
    }

    if (char === '[' && value.charAt(index + 1) === '[') {
      const wikilink = WIKILINK_PATTERN.exec(value.slice(index));
      if (wikilink) {
        const prevChar = index > 0 ? value.charAt(index - 1) : '';
        // `![[...]]` 是图片/文件嵌入，交给图片流程处理；`\[[...]]` 是作者主动转义。
        const displayText =
          prevChar === '!' || prevChar === '\\' ? '' : resolveWikilinkDisplayText(wikilink[1]);
        result += displayText
          ? `${WIKILINK_TEXT_ICON} ${escapeMarkdownInlineText(displayText)}`
          : wikilink[0];
        index += wikilink[0].length;
        continue;
      }
    }

    result += char;
    index += 1;
  }

  return result;
}

/**
 * 把 Markdown 里所有普通双链替换成「📄 显示名」纯文本。
 * 代码块、数学块与行内代码里的 `[[...]]` 保持原样。
 * @param {string} markdown
 * @returns {string}
 */
export function replacePlainWikilinksWithDisplayText(markdown) {
  const source = String(markdown || '');
  if (!source || !source.includes('[[')) return source;

  const lines = source.split('\n');
  let fence = null;
  let inMathFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceDelimiter = parseFencedBlockDelimiter(line);

    if (fenceDelimiter) {
      if (!fence) {
        fence = fenceDelimiter;
      } else if (fenceDelimiter.marker === fence.marker && fenceDelimiter.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    if (!fence && /^\s*\$\$\s*$/.test(String(line || ''))) {
      inMathFence = !inMathFence;
      continue;
    }

    if (fence || inMathFence) continue;

    lines[i] = replaceLineWikilinks(line);
  }

  return lines.join('\n');
}
