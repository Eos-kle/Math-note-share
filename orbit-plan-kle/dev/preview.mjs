// ============================================================================
// dev/preview.mjs — 离线出图：导出当前布局与某一时刻的坐标
//
//   node build.mjs && node dev/preview.mjs [节点数] [时钟]
//   python dev/render_preview.py      → dev/preview.png
//
// 用的是 main.js 里同一份 GraphBuilder / Layout / pose / attraction，
// 所以这张预览图和插件在 Obsidian 里画出来的是同一套坐标。
// ============================================================================
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { Palette, GraphBuilder, Layout } = require('./bundle.cjs');

const COUNT = Number(process.argv[2] || 42);
const CLOCK = Number(process.argv[3] || 7.5);
const SIZE_K = 1;
const SETTINGS = { capacity: 1, spacing: 1, arms: 3, spin: 1, trail: 0.55, nodeScale: 1 };

function fakeApp(count) {
	const spec = [];
	for (let i = 0; i < count; i++) {
		spec.push({
			path: 'notes/n' + String(i).padStart(2, '0') + '.md',
			// 创建时间从 2019-01 起，每篇隔 11 天
			day: new Date(Date.UTC(2019, 0, 1) + i * 11 * 86400000).toISOString().slice(0, 10),
			// 稀疏的链式关系（更像真实库：不是把人人都连到中心）
			resolved: i > 0 ? { ['notes/n' + String(i - 1).padStart(2, '0') + '.md']: 1 } : {},
		});
	}
	// 第 0 篇多连 6 篇，让它成为中心，但连线依旧稀疏
	for (let i = 1; i <= Math.min(6, count - 1); i++) spec[0].resolved['notes/n' + String(i).padStart(2, '0') + '.md'] = 1;

	spec.push({ path: 'files/paper-a.pdf' });
	spec.push({ path: 'files/paper-b.pdf' });
	spec[1].links = ['paper-a.pdf'];
	spec[3].links = ['paper-b.pdf'];

	const files = spec.map((s, i) => {
		const name = s.path.split('/').pop();
		const dot = name.lastIndexOf('.');
		return {
			path: s.path,
			basename: dot > 0 ? name.slice(0, dot) : name,
			extension: dot > 0 ? name.slice(dot + 1) : '',
			stat: { size: 10, ctime: 1.6e12 + i, mtime: 1.7e12 + i },
		};
	});
	const byPath = new Map(files.map((f) => [f.path, f]));
	const byName = new Map(files.map((f) => [f.basename, f]));
	const caches = new Map();
	spec.forEach((s) => {
		caches.set(s.path, {
			frontmatter: s.day ? { 'creation-time': s.day } : null,
			links: (s.links || []).map((l) => ({ link: l })),
			embeds: [],
		});
	});
	const resolvedLinks = {};
	spec.forEach((s) => {
		resolvedLinks[s.path] = s.resolved || {};
	});

	return {
		vault: { getFiles: () => files, getAbstractFileByPath: (p) => byPath.get(p) || null, on: () => ({}) },
		metadataCache: {
			resolvedLinks,
			getFileCache: (f) => caches.get(f.path) || null,
			getFirstLinkpathDest: (link) => byPath.get(link) || byName.get(String(link).replace(/\.pdf$/i, '')) || null,
			on: () => ({}),
		},
		workspace: { on: () => ({}), getLeavesOfType: () => [] },
	};
}

const graph = GraphBuilder.buildGraph(fakeApp(COUNT));
const res = Layout.build(graph, SETTINGS);

const base = CLOCK * 0.34;
const n = graph.nodes.length;
const xs = new Float64Array(n);
const ys = new Float64Array(n);
const rs = new Float64Array(n);
const kinds = new Int8Array(n);

// 先 PDF，再其他（与插件顺序一致）
for (let i = 0; i < n; i++) {
	if (graph.nodes[i].kind !== 'pdf') continue;
	const p = Layout.pose(res.nodes[i], { clock: CLOCK, base, sizeK: SIZE_K });
	xs[i] = p.x;
	ys[i] = p.y;
	rs[i] = p.radius;
	kinds[i] = 1;
}
for (let i = 0; i < n; i++) {
	if (graph.nodes[i].kind === 'pdf') continue;
	const rec = res.nodes[i];
	let p = Layout.pose(rec, { clock: CLOCK, base, sizeK: SIZE_K });
	if (graph.center === i) kinds[i] = 2;
	// PDF 吸引：找最近的相连 PDF
	let nearest = -1;
	let bestD = Infinity;
	for (const e of graph.edges) {
		const a = e[0];
		const b = e[1];
		const aPdf = graph.nodes[a].kind === 'pdf';
		const bPdf = graph.nodes[b].kind === 'pdf';
		if (aPdf === bPdf) continue;
		if (a !== i && b !== i) continue;
		const pdf = aPdf ? a : b;
		const d = Math.hypot(xs[pdf] - p.x, ys[pdf] - p.y);
		if (d < bestD) {
			bestD = d;
			nearest = pdf;
		}
	}
	if (nearest >= 0 && !rec.root) {
		const biased = Layout.attraction({
			rho: p.rho,
			ang: p.ang,
			cx: 0,
			cy: 0,
			px: xs[nearest],
			py: ys[nearest],
			maxR: res.maxR,
		});
		p = { x: Math.cos(biased.ang) * biased.rho, y: Math.sin(biased.ang) * biased.rho, radius: p.radius };
	}
	xs[i] = p.x;
	ys[i] = p.y;
	rs[i] = p.radius;
}

const colors = Palette.resolve(graph.nodes, res.nodes.map((r) => r.rho), SETTINGS);
const nodes = [];
const cometMask = [];
for (let i = 0; i < n; i++) {
	nodes.push({ x: xs[i], y: ys[i], r: rs[i], kind: kinds[i], color: colors[i] });
	cometMask.push(res.nodes[i].comet ? 1 : 0);
}

// 彗星尾迹：往回采样（与插件一致）
const cometTrails = [];
for (let i = 0; i < n; i++) {
	const rec = res.nodes[i];
	if (!rec.comet) continue;
	const pts = [];
	for (let k = 0; k < 8; k++) {
		const t = CLOCK - k * 0.4;
		const p = Layout.pose(rec, { clock: t, base: t * 0.34, sizeK: SIZE_K });
		pts.push([p.x, p.y]);
	}
	cometTrails.push(pts);
}

writeFileSync(
	join(ROOT, 'dev', 'preview.json'),
	JSON.stringify({ maxR: res.maxR, trail: SETTINGS.trail, nodes, edges: graph.edges, cometMask, cometTrails }, null, 1),
	'utf8'
);

console.log(
	'[preview] 节点 ' + n + '（PDF ' + graph.nodes.filter((x) => x.kind === 'pdf').length + '）、maxR ' + res.maxR.toFixed(1)
);
console.log('[preview] 已写出 dev/preview.json → 下一步 python dev/render_preview.py');
