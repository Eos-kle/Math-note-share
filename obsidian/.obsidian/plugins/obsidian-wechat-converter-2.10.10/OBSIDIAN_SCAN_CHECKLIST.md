# Obsidian Scan Readiness Checklist

This checklist is the gatekeeper for feature work that may affect Obsidian review warnings, recommendations, or marketplace scan errors.

## Required Command Gate

Run this before merging a feature branch or preparing a release candidate:

```bash
npm run review:guard
```

The guard runs the scan-risk gate, lint, production build, generated-artifact checks, the full Vitest suite, release packaging, and release validation. If it fails, fix the failure instead of bypassing the guard.

For faster local feedback while developing, run:

```bash
npm run scan:guard
```

That catches the high-risk Obsidian scan patterns early without paying the full release packaging cost.

For focused local work, run the smaller loop first:

```bash
npm run lint
npm test -- --run
npm run build
```

Do not run file-writing commands such as `npm run build`, `npm run generate:*`, `npm run check:build-artifacts`, `npm run review:guard`, or `npm run release:pack` in parallel with `git status`, `git diff`, or staging commands. Let the writer finish first, then inspect the final working tree. Otherwise Git may report a transient generated-artifact state while the build is still writing files.

## High-Risk API Checklist

Review every new usage of these APIs before committing:

- `innerHTML`, `outerHTML`, `insertAdjacentHTML`: prefer DOM APIs or existing helpers. If rendered HTML must be assigned, add a narrow `eslint-disable-next-line @microsoft/sdl/no-inner-html -- reason` comment that explains why the input is already sanitized or trusted.
- Static style assignment: do not use `element.style.foo = ...` for static UI styles. Use `setCssStyles(element, { ... })` or the Obsidian element extension `element.setCssStyles({ ... })`.
- Stylesheet `!important`: do not add `!important` in CSS files. Increase selector specificity, use CSS variables, or keep unavoidable compatibility styles inside already-sanitized rendered HTML with focused tests.
- `confirm()`, `alert()`, `prompt()`: use an Obsidian `Modal` or `Notice` instead.
- Clipboard fallback: do not remove the rich HTML `execCommand('copy')` fallback without manual regression coverage in Obsidian/Electron and mobile-like environments.
- `fetch(data:)`: parse `data:` URLs locally instead of fetching them.
- `globalThis`: avoid it in production plugin code. Prefer `window` or the helpers in `services/dom-utils.js` so popout windows stay compatible.
- `activeDocument`: use `getActiveDocumentCompat()` (or `window.activeDocument || document`) instead of the global `document` when creating elements or querying elements dynamically, to ensure full compatibility with Obsidian's popout windows.
- Timer helpers: use `window.setTimeout()` and `window.clearTimeout()` for timers instead of `activeWindow.setTimeout()` / `activeWindow.clearTimeout()`.
- Dynamic window APIs: avoid returning functions produced from dynamic `.call()` / `.bind()` access. Wrap the call in a named helper or call the safe API directly so TypeScript-style review scans do not classify the return as unsafe.
- File deletion or cleanup: validate vault-relative paths, block config/system directories, and add tests for unsafe paths.

## Manifest Metadata Guidelines

Review `manifest.json` metadata before release:
- **No "Obsidian" in description**: The plugin description must not contain the word "Obsidian" (case-insensitive) to prevent redundancy.
- **End with punctuation**: The description must end with an ASCII punctuation mark (`.`, `!`, or `?`).

## Browser Extension Bridge Safety

Treat the browser extension bridge as protocol-sensitive. Avoid changing these without a dedicated compatibility review:

- Local `http` server creation and binding behavior.
- WebSocket upgrade handling and SHA-1 accept calculation.
- Hello/token payload shape and authentication semantics.
- Request/response envelope fields shared with the browser extension.
- Timeout, retry, and cleanup behavior that affects connected sessions.

Low-risk compatibility cleanups are acceptable when behavior is covered by tests, such as routing timers through active-window helpers or feature-detecting browser APIs with safe fallbacks.

## Tests To Add For Common Changes

- Rendering/sanitization changes: add converter, cleaner, or renderer tests and run manual visual checks from `TEST.md`.
- Math changes: add or update math tests and run `TEST_MATH.md`.
- Settings UI changes: add settings smoke tests for visible controls and destructive confirmation paths.
- Bridge changes: add tests in `tests/wechatsync_bridge.test.js` and manually test extension connect/reconnect.
- Copy/sync changes: add focused tests under `tests/copy_html.test.js`, `tests/wechat_sync.test.js`, or modal tests as appropriate.

## Release Readiness

Before asking users to scan or before publishing:

- `npm run review:guard` passes.
- `main.js` is rebuilt from `input.js`.
- `services/generated-embedded-deps.js` is current if embedded runtime sources changed.
- `services/ai-layout-runtime/generated-skills.js` is current if AI layout skill sources changed.
- `obsidian-wechat-converter.zip` contains only `main.js`, `manifest.json`, and `styles.css`.
- Remaining scan warnings are documented as intentional residuals if they involve accepted compatibility tradeoffs such as CommonJS, local bridge `http`, WebSocket SHA-1, or clipboard fallback behavior.

## CI/CD Gatekeeper

GitHub Actions should run the same guard used locally:

- Pull request / main branch CI: `npm run review:guard`.
- Release workflow: run `npm run review:guard` before release notes, attestations, or publishing.
- The guard must fail if a production build changes tracked generated artifacts that were not committed.
