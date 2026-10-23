// ============================================================================
// build.mjs — 零依赖构建：把 src/*.js 按顺序拼成 Obsidian 要的 main.js
//
//   node build.mjs          生成 main.js（交付产物）+ 测试用的两个包
//   node dev/test.mjs       跑断言
//   node dev/preview.mjs    导出星图坐标（给 Python 画预览图）
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DEV = join(ROOT, 'dev');

// 顺序即依赖顺序，不要随意调整
const ORDER = ['core', 'palette', 'graph', 'layout', 'plan', 'renderer', 'view-consts', 'view-graph', 'view-plan', 'view-timer', 'view', 'plugin'];
const PURE = ['core', 'palette', 'graph', 'layout', 'plan'];

const BANNER =
	'/*!\n' +
	' * Orbit Plan — Obsidian 关系图谱 + 每周计划插件\n' +
	' * 构建产物，请勿直接修改；源码在 src/，用 `node build.mjs` 重新生成。\n' +
	' */\n' +
	"'use strict';\n";

const OBSIDIAN_REQUIRE =
	"const { Plugin, ItemView, PluginSettingTab, Setting, Notice, Modal, debounce, setIcon } = require('obsidian');\n";

function readModule(name) {
	const text = readFileSync(join(SRC, name + '.js'), 'utf8').trimEnd();
	return '// ---- src/' + name + '.js ----\n' + text + '\n';
}

function bundle(names) {
	return names.map(readModule).join('\n');
}

// 1) 交付产物
const mainJs = BANNER + OBSIDIAN_REQUIRE + '\n' + bundle(ORDER) + '\nmodule.exports = GraphOrbitPlugin;\n';
writeFileSync(join(ROOT, 'main.js'), mainJs, 'utf8');

// 2) 测试产物
mkdirSync(DEV, { recursive: true });

const pureBundle =
	BANNER + '\n' + bundle(PURE) + '\nmodule.exports = { Core, Palette, GraphBuilder, Layout, Plan };\n';
writeFileSync(join(DEV, 'bundle.cjs'), pureBundle, 'utf8');

const smokeBundle =
	BANNER +
	"\nconst { Plugin, ItemView, PluginSettingTab, Setting, Notice, Modal, debounce, setIcon } = require('./obsidian-stub.cjs');\n" +
	'\n' +
	bundle(ORDER) +
	'\nmodule.exports = GraphOrbitPlugin;\nmodule.exports.__internals = { Core, Plan, Palette, Layout, GraphBuilder, Views }; // 仅供离线测试驱动同一份实例\n';
writeFileSync(join(DEV, 'smoke-bundle.cjs'), smokeBundle, 'utf8');

// 3) 可粘贴包：dist/orbit-plan-kle/ 里只放三件运行必需文件
const DIST = join(ROOT, 'dist', 'orbit-plan-kle');
mkdirSync(DIST, { recursive: true });
for (const f of ['manifest.json', 'main.js', 'styles.css']) {
	copyFileSync(join(ROOT, f), join(DIST, f));
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('[build] main.js             ' + kb(Buffer.byteLength(mainJs)));
console.log('[build] dev/bundle.cjs      ' + kb(Buffer.byteLength(pureBundle)));
console.log('[build] dev/smoke-bundle.cjs ' + kb(Buffer.byteLength(smokeBundle)));
console.log('[build] dist/orbit-plan-kle/ 已刷新（manifest.json main.js styles.css）');
