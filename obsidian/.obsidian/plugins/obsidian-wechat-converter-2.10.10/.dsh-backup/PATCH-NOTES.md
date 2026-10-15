# 本机对 obsidian-wechat-converter 的补丁说明

> 目的：让「笔记块 · 数学块」这类 Obsidian Callout 样式能在公众号链路（普通预览 / 复制到公众号 / 同步草稿）里按类型生效。
> **插件升级会覆盖 `main.js`**，升级后按本文「重新应用」一节重做一次即可。

## 一、改了什么（共 4 个源码文件 + 3 个测试/基线文件）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `converter.js` | ① 新增 `getCalloutTypeAttr()`，两条 Callout 渲染分支输出 `<section class="owc-callout" data-callout="类型" …>`；② 新增 `getCalloutIcon(type)`，图标表 `CALLOUT_ICONS` 扩到覆盖「数学块 / 强调块 / 版式块」全部类型（中英文别名共用同一图标，不同块不撞图）；③ 新增常量 `DEFAULT_CALLOUT_ICON = 'ℹ️'` 作为未登记类型的兜底（原来借用 `note` 的图标，改 note 会连带改掉兜底） | 导出的 Callout 原本不带类型信息，自定义 CSS 无法按类型上色；图标原本多种块共用 ℹ️ |
| `services/obsidian-triplet-serializer-dom.js` | ① `sanitizeClassList()` 保留 `owc-callout*` 前缀 class；② section 的属性白名单加入 `data-callout`；③ `span` 放行 `class`（仍只保留 `owc-callout*`）；④ `resolveLegacyCalloutIcon(type, converter)` 改为优先读取 converter 的图标表（唯一来源），本地表只作兜底 | 含公式的笔记走 Obsidian 原样渲染链路，这条链路原本会把 Callout 的 class 全部清掉，且用的是**另一张**没有数学类型的图标表，所以定义/定理/证明都掉进 ℹ️ |
| `services/custom-css-compiler.js` | `expandSelectorNode()` 里清掉 `:is()`/`:where()` 选项首节点的前导空格（`spaces.before`） | **插件原有 bug**：`.x:is(a, b)` 只有第一个选项展开正确，第二个及以后会多一个空格退化成后代选择器 `.x b`，永远不命中（中文类型基本都排在后面） |
| `tests/custom_css_compiler.test.js` | 新增 `:is()` 复合关系回归用例 | 锁住上面这个 bug |
| `tests/obsidian_triplet_serializer.test.js` | 新增 2 条用例：保留 owc-callout 钩子、按类型解析图标（含未登记类型回退 ℹ️） | 锁住 Callout 钩子与图标契约 |
| `tests/fixtures/parity/baseline/*.clean.html` | 5 处基线快照更新（先 3 个加 `data-callout`，再 2 个换 note 图标 ℹ️→🗒️） | 原生链路输出变化，每次都用「差异必须可解释」的脚本核对后才写入 |

> 注意：`converter.js` 会被内嵌进 `services/generated-embedded-deps.js`。**改完 converter.js 必须依次执行**
> `node scripts/generate-embedded-deps.mjs` → `node esbuild.config.mjs production`，否则插件运行时用的还是旧表。
> 用 `node scripts/generate-embedded-deps.mjs --check` 可以确认内嵌快照是否同步。

## 二、样式文件

插件读取的样式来源：`vault/笔记块-数学块.css.md`（Obsidian 阅读片段 `.obsidian/snippets/笔记块-数学块.css` 的公众号移植版，9 种类型配色一致）。

插件设置：设置 → 微信公众号 → 自定义 CSS：已启用，来源笔记填 `vault/笔记块-数学块.css.md`。

## 三、重新应用（插件升级后）

1. 确认 4 个源码文件的改动还在（升级会覆盖 `converter.js` 与 `services/*`）。
   - 若已被覆盖：从 `.dsh-backup/src/` 里取对应 `.bak` 做参考，按第一节的四处改动重新打一遍。
   - 也可直接从 `.dsh-backup/` 恢复整套构建产物：`main.js.bak`、`generated-embedded-deps.js.bak`（**注意**：这是升级前的旧版本，仅适合"升级后想退回本补丁状态"）。
2. 重建产物：
   ```powershell
   # 依赖（本机只有 pnpm，没有 npm；node 用 DSH 自带运行时）
   node <pnpm.mjs> import ; node <pnpm.mjs> install
   # 重新生成内嵌依赖（converter.js 被内嵌）+ 构建 main.js
   node scripts/generate-embedded-deps.mjs
   node esbuild.config.mjs production
   ```
3. Obsidian 里**重新加载插件**：设置 → 第三方插件 → 关闭再打开该插件（或重启 Obsidian）。`main.js` 只在插件加载时读取。
4. 跑一遍相关测试确认没回归：
   ```powershell
   node node_modules/vitest/vitest.mjs run tests/custom_css_compiler.test.js tests/obsidian_triplet_serializer.test.js tests/parity_corpus.test.js
   ```
   基线若因新版本输出变化而失败，需要先确认差异是否可解释，再决定是否更新快照。

## 四、回滚

- 只要样式：清空插件设置里的「或从笔记读取 CSS」并关掉「启用自定义 CSS」。
- 连插件补丁一起退：把 `.dsh-backup/main.js.bak` 覆盖回 `main.js`（同时用 `generated-embedded-deps.js.bak` 覆盖 `services/generated-embedded-deps.js`），再重新加载插件。
- 文件权限修复（本机工作区）：`.acl-recovery/` 里有备份与还原脚本，命令见该目录内报告。

## 五、本目录内容

- `main.js.bak` / `generated-embedded-deps.js.bak`：打补丁前的构建产物。
- `src/`：改动前的源码副本（`converter.js`、`obsidian-triplet-serializer-dom.js`、`obsidian_triplet_serializer.test.js`）。
- `build.log` / `build2.log` / `verify.log`：安装、构建、测试与内联验证的完整日志。
