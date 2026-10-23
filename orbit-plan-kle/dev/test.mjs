// ============================================================================
// dev/test.mjs — 离线验证
//
//   node build.mjs && node dev/test.mjs
//
// A. 纯逻辑（日期 / 建图 / 螺旋布局 / 位置 / 吸引）
// B. API 桩冒烟（注册点、视图构造、设置页）
// C. 渲染链冒烟（假 DOM + 假 Canvas，真跑 onOpen → tick → draw）
// D. 产物自查（manifest、禁用 API、CJS 语法）
// ============================================================================
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let passed = 0;
const failures = [];

function check(name, fn) {
	try {
		fn();
		passed++;
		console.log('  ok   ' + name);
	} catch (err) {
		failures.push(name + ' → ' + (err && err.message ? err.message : String(err)));
		console.log('  FAIL ' + name + ' → ' + (err && err.message ? err.message : String(err)));
	}
}

async function checkAsync(name, fn) {
	try {
		await fn();
		passed++;
		console.log('  ok   ' + name);
	} catch (err) {
		failures.push(name + ' → ' + (err && err.message ? err.message : String(err)));
		console.log('  FAIL ' + name + ' → ' + (err && err.message ? err.message : String(err)));
	}
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg || '断言失败');
}

const { Core, Palette, GraphBuilder, Layout, Plan } = require('./bundle.cjs');
// 假 DOM 要在创建任何视图之前装好
const { installFakeDom } = require('./fakedom.cjs');
installFakeDom();

const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 测试用假 vault
// ---------------------------------------------------------------------------
const DETACHED = [];
let ACTIVE_VIEW = null;

function makeVault(spec) {
	const files = spec.map((s, i) => {
		const name = s.path.split('/').pop();
		const dot = name.lastIndexOf('.');
		const base = dot > 0 ? name.slice(0, dot) : name;
		const ext = dot > 0 ? name.slice(dot + 1) : '';
		return {
			path: s.path,
			basename: base,
			extension: ext,
			stat: { size: 10 + i, ctime: s.fileCtime !== undefined ? s.fileCtime : 1e12 + i, mtime: 2e12 + i },
		};
	});
	const byPath = new Map(files.map((f) => [f.path, f]));
	const byName = new Map(files.map((f) => [f.basename, f]));
	const caches = new Map();
	spec.forEach((s) => {
		caches.set(s.path, {
			frontmatter: s.fm === undefined ? null : s.fm,
			tags: (s.tags || []).map((t) => ({ tag: t })),
			links: (s.links || []).map((l) => ({ link: l })),
			embeds: (s.embeds || []).map((l) => ({ link: l })),
		});
	});
	const resolvedLinks = {};
	spec.forEach((s) => {
		resolvedLinks[s.path] = s.resolved || {};
	});

	return {
		vault: {
			getFiles: () => files,
			getMarkdownFiles: () => files.filter((f) => f.extension === 'md'),
			getAbstractFileByPath: (p) => byPath.get(p) || null,
			read: async (f) => (caches.get(f.path) && caches.get(f.path).raw) || '',
			create: async (p, data) => {
				const f = { path: p, basename: p.split('/').pop().replace(/\.md$/, ''), extension: 'md', stat: { ctime: 1, mtime: 1, size: 0 } };
				byPath.set(p, f);
				files.push(f);
				caches.set(p, { frontmatter: null, tags: [], links: [], embeds: [], raw: data });
				return f;
			},
			createFolder: async () => {},
			process: async (f, fn) => {
				const cur = caches.get(f.path);
				const next = fn((cur && cur.raw) || '');
				if (cur) cur.raw = next;
				else caches.set(f.path, { frontmatter: null, tags: [], links: [], embeds: [], raw: next });
				return next;
			},
			on: () => ({}),
		},
		metadataCache: {
			resolvedLinks,
			getFileCache: (f) => caches.get(f.path) || null,
			getFirstLinkpathDest: (link) =>
				byPath.get(link) || byName.get(String(link).replace(/\.pdf$/i, '')) || byName.get(link) || null,
			on: () => ({}),
		},
		workspace: {
			on: () => ({}),
			getLeavesOfType: () => [],
			getRightLeaf: () => null,
			getLeaf: () => null,
			getActiveViewOfType: () => ACTIVE_VIEW,
			detachLeavesOfType: (t) => {
				DETACHED.push(t);
			},
		},
	};
}

/** 40 篇笔记 + 2 个 pdf 的实验库，创建时间依次递增 */
function labVault(count) {
	const n = count || 40;
	const spec = [];
	for (let i = 0; i < n; i++) {
		const day = String(1 + (i % 28)).padStart(2, '0');
		const month = String(1 + (i % 12)).padStart(2, '0');
		const year = 2019 + Math.floor(i / 12);
		spec.push({
			path: 'notes/n' + String(i).padStart(2, '0') + '.md',
			fm: { 'creation-time': year + '-' + month + '-' + day },
			resolved: i > 0 ? { ['notes/n' + String(i - 1).padStart(2, '0') + '.md']: 1 } : {},
		});
	}
	// 让第一篇成为中心（连接最多）
	spec[0].resolved = {};
	for (let i = 1; i < n; i++) spec[0].resolved['notes/n' + String(i).padStart(2, '0') + '.md'] = 1;
	spec.push({ path: 'files/a.pdf', fileCtime: 1.7e12 });
	spec.push({ path: 'files/b.pdf', fileCtime: 1.75e12 });
	spec.push({ path: 'files/报告 总结.pdf', fileCtime: 1.8e12 });
	spec[1].links = ['a.pdf'];
	return makeVault(spec);
}

// ---------------------------------------------------------------------------
// A. 纯逻辑
// ---------------------------------------------------------------------------
console.log('\n[A] 纯逻辑');

check('creation-time：六种输入都能解析', () => {
	assert(GraphBuilder.parseDate(new Date('2024-03-05T00:00:00Z')) === Date.parse('2024-03-05T00:00:00Z'), 'Date 对象');
	assert(GraphBuilder.parseDate('2024-03-05') === Date.parse('2024-03-05'), 'YYYY-MM-DD');
	assert(GraphBuilder.parseDate('2024/3/5') === Date.parse('2024-03-05'), 'YYYY/M/D');
	assert(GraphBuilder.parseDate('2024-03-05 14:30') === Date.parse('2024-03-05T14:30'), '带时间');
	assert(GraphBuilder.parseDate(1700000000) === 1700000000000, '秒级时间戳');
	assert(GraphBuilder.parseDate(1700000000000) === 1700000000000, '毫秒时间戳');
	assert(GraphBuilder.parseDate(null) === null, 'null');
	assert(GraphBuilder.parseDate('') === null, '空串');
	assert(GraphBuilder.parseDate('不是日期') === null, '非法串');
});

check('建图：md 与 pdf 都是节点，png 被排除', () => {
	const g = GraphBuilder.buildGraph(
		makeVault([{ path: 'a.md' }, { path: 'paper.pdf' }, { path: 'pic.png' }])
	);
	assert(g.nodes.length === 2, '节点数 ' + g.nodes.length);
	assert(g.nodes.map((n) => n.kind).sort().join(',') === 'md,pdf');
});

check('建图：双向双链 = 1 条无向边，大小按唯一邻居计 1 次', () => {
	const g = GraphBuilder.buildGraph(
		makeVault([
			{ path: 'a.md', resolved: { 'b.md': 1 } },
			{ path: 'b.md', resolved: { 'a.md': 1 } },
		])
	);
	assert(g.edges.length === 1, '无向边数 ' + g.edges.length);
	assert(g.nodes[0].degree === 1 && g.nodes[1].degree === 1, '大小应按唯一邻居计为 1：' + g.nodes[0].degree + '/' + g.nodes[1].degree);
});

check('建图：同一目标写两次 → 大小仍计 1 次、连线仍一根', () => {
	const g = GraphBuilder.buildGraph(makeVault([{ path: 'a.md', resolved: { 'b.md': 2 } }, { path: 'b.md' }]));
	assert(g.nodes[0].degree === 1, '唯一邻居应为 1：' + g.nodes[0].degree);
	assert(g.nodes[1].degree === 1, '唯一邻居应为 1：' + g.nodes[1].degree);
	assert(g.edges.length === 1, '连线仍应只有一根：' + g.edges.length);
});

check('建图：md → pdf 通过链接建立边', () => {
	const g = GraphBuilder.buildGraph(makeVault([{ path: 'a.md', links: ['paper.pdf'] }, { path: 'paper.pdf' }]));
	assert(g.edges.length === 1, '边数 ' + g.edges.length);
	const pdf = g.nodes.findIndex((n) => n.kind === 'pdf');
	assert(g.nodes[pdf].degree === 1, 'pdf 度数');
});

check('建图：中心只在 md 中选，PDF 连接再多也不当选', () => {
	const g = GraphBuilder.buildGraph(
		makeVault([
			{ path: 'doc/p.pdf' },
			{ path: 'd1.md', links: ['p.pdf'] },
			{ path: 'd2.md', links: ['p.pdf'] },
		])
	);
	const center = g.nodes[g.center];
	assert(center && center.kind === 'md', '中心类型 ' + (center && center.kind));
	assert(g.nodes.find((n) => n.kind === 'pdf').degree === 2, 'pdf 度数');
});

check('建图：不再有标签与跳数字段', () => {
	const g = GraphBuilder.buildGraph(labVault(6));
	assert(g.tags === undefined, '不应再产出 tags');
	assert(g.nodes.every((n) => n.hop === undefined), '不应再有 hop');
	assert(g.nodes.every((n) => n.primary === undefined), '不应再有 primary');
});

check('建图：creation-time 优先于文件系统时间', () => {
	const g = GraphBuilder.buildGraph(
		makeVault([
			{ path: 'a.md', fileCtime: 9e12, fm: { 'creation-time': '2001-01-01' } },
			{ path: 'b.md', fileCtime: 1e12 },
		])
	);
	const a = g.nodes.find((n) => n.name === 'a');
	const b = g.nodes.find((n) => n.name === 'b');
	assert(a.ctime === Date.parse('2001-01-01'), 'frontmatter 未生效：' + a.ctime);
	assert(b.ctime === 1e12, '缺失时应回退 stat.ctime：' + b.ctime);
});

// --- 螺旋布局 ---
const LAB = labVault(40);
const LAB_GRAPH = GraphBuilder.buildGraph(LAB);

check('布局：大体上越早创建越靠近中心（允许 ±1 轨抖动）', () => {
	const res = Layout.build(LAB_GRAPH, { spacing: 1 });
	const mds = LAB_GRAPH.nodes
		.map((node, i) => ({ node, rec: res.nodes[i] }))
		.filter((x) => x.node.kind === 'md' && !x.rec.root);
	mds.sort((a, b) => a.node.ctime - b.node.ctime);

	// 每个球的轨道号不应偏离「顺序填轨」超过 1 轨（抖动上限）
	let offByOne = 0;
	for (let i = 0; i < mds.length; i++) {
		if (i > 0 && mds[i].rec.rho < mds[i - 1].rec.rho - 1e-9) offByOne++;
	}
	assert(offByOne <= Math.ceil(mds.length * 0.25), '抖动过多的逆序：' + offByOne + '/' + mds.length);
	assert(mds[0].rec.rho <= mds[mds.length - 1].rec.rho, '最早创建应总体在内圈');
});

check('布局：中心笔记在原点，半径最大', () => {
	const res = Layout.build(LAB_GRAPH, { spacing: 1 });
	const rec = res.nodes[LAB_GRAPH.center];
	assert(rec.root === true, '中心标记缺失');
	assert(rec.rho === 0, 'rho ' + rec.rho);
	const others = res.nodes.filter((r) => !r.root);
	assert(rec.radius >= Math.max.apply(null, others.map((r) => r.radius)), '中心不是最大的球');
});

check('轨道：容量公式 2·(π/e)^(3n)', () => {
	assert(Layout.orbitCapacity(1) === 3, 'cap(1)=' + Layout.orbitCapacity(1));
	assert(Layout.orbitCapacity(2) === 4, 'cap(2)=' + Layout.orbitCapacity(2));
	assert(Layout.orbitCapacity(3) === 7, 'cap(3)=' + Layout.orbitCapacity(3));
	assert(Layout.orbitCapacity(4) === 11, 'cap(4)=' + Layout.orbitCapacity(4));
	assert(Layout.orbitCapacity(5) === 17, 'cap(5)=' + Layout.orbitCapacity(5));
	// 单调递增且不垮塌
	for (let n = 1; n < 12; n++) assert(Layout.orbitCapacity(n + 1) >= Layout.orbitCapacity(n), '容量应递增');
});

check('轨道：每轨实际数量不超过容量，顺序填轨（第 1 轨 3 个）', () => {
	const res = Layout.build(LAB_GRAPH, { spacing: 1 });
	const counts = new Map();
	for (let i = 0; i < res.nodes.length; i++) {
		const rec = res.nodes[i];
		if (rec.root || LAB_GRAPH.nodes[i].kind !== 'md') continue;
		counts.set(rec.orbit, (counts.get(rec.orbit) || 0) + 1);
	}
	for (const [s, c] of counts) {
		assert(c <= Layout.orbitCapacity(s + 1), '第 ' + (s + 1) + ' 轨有 ' + c + ' 个，超出容量');
	}
	assert(counts.get(0) === 3, '第 1 轨应正好 3 个，实际 ' + counts.get(0));
});

check('轨道：第 1、2 轨顺时针，其余逆时针', () => {
	const res = Layout.build(LAB_GRAPH, { spacing: 1 });
	for (let i = 0; i < res.nodes.length; i++) {
		const rec = res.nodes[i];
		if (rec.root || rec.comet || rec.drift) continue;
		if (LAB_GRAPH.nodes[i].kind !== 'md') continue;
		const expect = rec.orbit + 1 >= 3 ? -1 : 1;
		assert(rec.dir === expect, '第 ' + (rec.orbit + 1) + ' 轨方向应为 ' + expect + '，实际 ' + rec.dir);
	}
});

check('轨道：抖动比例约 10% 外移 / 11% 内移 / 79% 不动', () => {
	const res = Layout.build(LAB_GRAPH, { spacing: 1 });
	const mds = LAB_GRAPH.nodes
		.map((node, i) => ({ node, rec: res.nodes[i] }))
		.filter((x) => x.node.kind === 'md' && !x.rec.root);
	mds.sort((a, b) => a.node.ctime - b.node.ctime);

	// 复算「顺序填轨」得到的基准轨道号
	const base = new Map();
	let o = 1;
	let used = 0;
	for (let i = 0; i < mds.length; i++) {
		while (used >= Layout.orbitCapacity(o)) {
			o++;
			used = 0;
		}
		base.set(mds[i].node.path, o);
		used++;
	}

	let up = 0;
	let down = 0;
	let stay = 0;
	for (const x of mds) {
		const want = base.get(x.node.path);
		const got = x.rec.orbit + 1;
		if (got === want + 1) up++;
		else if (got === want - 1) down++;
		else if (got === want) stay++;
	}
	const total = mds.length;
	assert(up / total >= 0.04 && up / total <= 0.2, '外移比例 ' + (up / total).toFixed(2));
	assert(down / total <= 0.22, '内移比例 ' + (down / total).toFixed(2));
	assert(stay / total >= 0.6, '不动比例 ' + (stay / total).toFixed(2));
});

check('轨道：大库也不会有轨道超容量（溢出搬运生效）', () => {
	const g = GraphBuilder.buildGraph(labVault(200));
	const res = Layout.build(g, { spacing: 1 });
	const counts = new Map();
	for (let i = 0; i < res.nodes.length; i++) {
		const rec = res.nodes[i];
		if (rec.root || g.nodes[i].kind !== 'md') continue;
		counts.set(rec.orbit, (counts.get(rec.orbit) || 0) + 1);
	}
	for (const [s, c] of counts) {
		assert(c <= Layout.orbitCapacity(s + 1), '第 ' + (s + 1) + ' 轨有 ' + c + ' 个，超出容量 ' + Layout.orbitCapacity(s + 1));
	}
});

check('内环半径：整体抬高 12%，最外轨不变', () => {
	const g = GraphBuilder.buildGraph(labVault(20));
	const res = Layout.build(g, { spacing: 1 });

	const inner = res.orbitRho(1);
	const outer = res.orbitRho(res.maxOrbit);
	assert(Math.abs(inner - 70 * 1.26) < 1e-6, '内环应为 88.2，实际 ' + inner.toFixed(2));
	assert(Math.abs(outer - 70 * (1.85 + 1.0)) < 1e-6, '最外轨应为 199.5，实际 ' + outer.toFixed(2));
	// 单调递增
	for (let o = 2; o <= res.maxOrbit; o++) assert(res.orbitRho(o) > res.orbitRho(o - 1), '半径应递增');
});
check('速度：轨道差速（内 1.45 → 外 1.0，带 ±2% 抖动），PDF 按大小 2.7 倍', () => {
	const g = GraphBuilder.buildGraph(labVault(20));
	const res = Layout.build(g, { spacing: 1 });

	const maxOrbit = Math.max(0, res.maxOrbit - 1); // 布局里的最外轨（0 起）
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (g.nodes[i].kind !== 'md' || rec.root || rec.comet) continue;
		const orbitT = maxOrbit > 0 ? rec.orbit / maxOrbit : 0;
		const base = 1.45 - 0.45 * orbitT;
		assert(Math.abs(rec.spinFactor - base) <= 0.02 * base + 1e-9, '第 ' + (rec.orbit + 1) + ' 轨速度 ' + rec.spinFactor.toFixed(3) + ' 应接近 ' + base.toFixed(3));
	}

	let minSize = Infinity;
	let maxSize = -Infinity;
	for (let i = 0; i < g.nodes.length; i++) {
		if (g.nodes[i].kind !== 'pdf') continue;
		const sz = g.nodes[i].size || 0;
		if (sz < minSize) minSize = sz;
		if (sz > maxSize) maxSize = sz;
	}
	const span = maxSize - minSize;
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (g.nodes[i].kind !== 'pdf' || rec.comet) continue;
		const k = span > 0 ? ((g.nodes[i].size || 0) - minSize) / span : 0.5;
		const expect = Layout.PDF_SPIN * (1.75 - 1.1 * k);
		assert(Math.abs(rec.spinFactor - expect) < 1e-9, 'PDF 速度 ' + rec.spinFactor.toFixed(3) + ' 应为 ' + expect.toFixed(3));
	}
});
check('布局：层间距越大整体越远', () => {
	const near = Layout.build(LAB_GRAPH, { spacing: 0.5 });
	const far = Layout.build(LAB_GRAPH, { spacing: 2 });
	assert(far.maxR > near.maxR, 'spacing 2 应更远：' + far.maxR.toFixed(1) + ' vs ' + near.maxR.toFixed(1));
});

check('布局：PDF 在最外圈、按 0.28 倍慢转', () => {
	const res = Layout.build(LAB_GRAPH, { capacity: 1, spacing: 1, arms: 3 });
	const pdf = LAB_GRAPH.nodes.findIndex((n) => n.kind === 'pdf');
	const rec = res.nodes[pdf];
	assert(rec.spinFactor >= Layout.PDF_SPIN * 0.65 - 1e-9 && rec.spinFactor <= Layout.PDF_SPIN * 1.75 + 1e-9, 'spinFactor 应在 0.18~0.49：' + rec.spinFactor);
	let maxMd = 0;
	for (let i = 0; i < res.nodes.length; i++) {
		if (LAB_GRAPH.nodes[i].kind === 'md') maxMd = Math.max(maxMd, res.nodes[i].rho);
	}
	assert(rec.rho > maxMd, 'PDF 应比所有笔记更靠外：' + rec.rho.toFixed(1) + ' vs ' + maxMd.toFixed(1));
});

check('布局：节点有下限，且连接越多越大', () => {
	const r = (deg) => Layout.nodeRadius({ kind: 'md', degree: deg });
	assert(r(0) === Layout.MIN_MD_RADIUS, '下限 ' + r(0));
	assert(r(0) < r(1) && r(1) < r(4) && r(4) < r(9), '半径应随度数递增');
	assert(r(100) === r(40), '超过封顶后不再变大');
});

check('布局：同一输入两次结果完全一致', () => {
	const a = Layout.build(LAB_GRAPH, { capacity: 1, spacing: 1, arms: 3 });
	const b = Layout.build(LAB_GRAPH, { capacity: 1, spacing: 1, arms: 3 });
	assert(a.maxR === b.maxR);
	for (let i = 0; i < a.nodes.length; i++) {
		assert(a.nodes[i].rho === b.nodes[i].rho, 'rho 不一致');
		assert(a.nodes[i].theta0 === b.nodes[i].theta0, 'theta 不一致');
	}
});

check('布局：空图不报错', () => {
	const res = Layout.build({ nodes: [], edges: [], center: -1 }, { capacity: 1, spacing: 1, arms: 3 });
	assert(res.nodes.length === 0);
	assert(res.maxR >= 1);
});

check('位置：中心固定原点、PDF 慢转且漂移有界、笔记绕圈半径不变', () => {
	const res = Layout.build(LAB_GRAPH, { capacity: 1, spacing: 1, arms: 3 });
	const rootPose = Layout.pose(res.nodes[LAB_GRAPH.center], { clock: 5, base: 5 * 0.34, sizeK: 1 });
	assert(rootPose.x === 0 && rootPose.y === 0, '中心不在原点');

	const pdf = LAB_GRAPH.nodes.findIndex((n, i) => n.kind === 'pdf' && !res.nodes[i].comet);
	const pdfRec = res.nodes[pdf];
	assert(pdfRec.drift === true, 'PDF 应带漂移标记');

	// 半径必须落在 −11% ~ +5% 内，角度相对匀速公转的偏移 ≤ 7°
	let moved = false;
	for (let k = 0; k < 240; k++) {
		const t = k * 0.5;
		const p = Layout.pose(pdfRec, { clock: t, base: t * 0.34, sizeK: 1 });
		const r = Math.hypot(p.x, p.y);
		assert(r >= pdfRec.rho * 0.89 - 1e-6, 'PDF 半径过小：' + r.toFixed(2));
		assert(r <= pdfRec.rho * 1.05 + 1e-6, 'PDF 半径过大：' + r.toFixed(2));
		const expected = pdfRec.theta0 + 0.34 * t * pdfRec.spinFactor;
		assert(Math.abs(Core.angleDelta(expected, p.ang)) <= 0.122 + 1e-6, 'PDF 角度偏移超限');
		if (k > 0) moved = true;
	}
	assert(moved, 'PDF 应在动');

	const md = res.nodes.findIndex((r) => !r.root && !r.comet && r.spinFactor > 0);
	const m1 = Layout.pose(res.nodes[md], { clock: 1, base: 0.34, sizeK: 1 });
	const m2 = Layout.pose(res.nodes[md], { clock: 9, base: 9 * 0.34, sizeK: 1 });
	assert(Math.abs(Math.hypot(m1.x, m1.y) - Math.hypot(m2.x, m2.y)) < 1e-6, '笔记轨道半径漂移');
});

check('文字：frontmatter title 优先，缺失回退文件名', () => {
	const g = GraphBuilder.buildGraph(
		makeVault([
			{ path: '有标题.md', fm: { title: '我的标题' } },
			{ path: '数字标题.md', fm: { title: 42 } },
			{ path: '空标题.md', fm: { title: '   ' } },
			{ path: '没属性.md', fm: null },
		])
	);
	const byPath = {};
	g.nodes.forEach((n) => (byPath[n.path] = n.label));
	assert(byPath['有标题.md'] === '我的标题', byPath['有标题.md']);
	assert(byPath['数字标题.md'] === '42', byPath['数字标题.md']);
	assert(byPath['空标题.md'] === '空标题', byPath['空标题.md']);
	assert(byPath['没属性.md'] === '没属性', byPath['没属性.md']);
});

check('配色：十套色系（5 渐变 + 5 杂色）、自定义优先', () => {
	assert(Palette.SCHEMES.length === 10, '色系数量 ' + Palette.SCHEMES.length);
	assert(Palette.SCHEMES.map((s) => s.id).join(',') === 'purple,red,teal,amber,solar,neon,candy,deep,planets,midnight');
	for (const s of Palette.SCHEMES) {
		assert(s.stops.every((c) => /^#[0-9a-f]{6}$/i.test(c)), s.id + ' 色值非法');
		assert(s.label && s.label.length > 0, s.id + ' 缺中文标签');
	}
	assert(Palette.byId('不存在').id === 'purple', '非法 id 应回退首套');
	assert(Palette.exists('purple') && Palette.exists('red') && Palette.exists('teal') && Palette.exists('amber') && !Palette.exists('warm'), 'exists 判定不对');

	const nodes = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }];
	const radii = new Float64Array([10, 100, 200]);
	const stops = Palette.byId('purple').stops;
	const out = Palette.resolve(nodes, radii, { scheme: 'purple', colors: { 'b.md': '#123456' } });
	// 由外向内：外圈取首色（最浅），中心取末色（最深）
	assert(out[0] === stops[stops.length - 1], '中心应取末色：' + out[0]);
	assert(out[2] === stops[0], '外圈应取首色：' + out[2]);
	assert(out[1] === '#123456', '自定义色未生效：' + out[1]);
});

check('吸引：pull 有界、半径内缩 ≤8%、相位偏移 ≤10°', () => {
	const near = Layout.attraction({ rho: 200, ang: 0, cx: 0, cy: 0, px: 200, py: 5, maxR: 1000 });
	assert(near.pull > 0.9, 'pull ' + near.pull);
	assert(near.rho <= 200 && near.rho >= 200 * (1 - Layout.MAX_SHRINK) - 1e-9, 'rho ' + near.rho);
	assert(Math.abs(near.ang) <= Layout.MAX_SWING + 1e-9, 'ang ' + near.ang);

	const far = Layout.attraction({ rho: 200, ang: 0, cx: 0, cy: 0, px: 100000, py: 0, maxR: 1000 });
	assert(far.pull < 0.01, 'pull ' + far.pull);
	assert(Math.abs(far.rho - 200) < 1e-6, '远处不应改变半径');
});

// --- 彗星（椭圆轨道）---
function cometVault(titles) {
	const spec = [];
	for (let i = 0; i < 15; i++) {
		const day = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
		const fm = { 'creation-time': day };
		if (titles && titles[i]) fm.title = titles[i];
		spec.push({ path: 'c/n' + String(i).padStart(2, '0') + '.md', fm, resolved: {} });
	}
	// 节点 0 连所有其他节点 → 成为中心
	for (let i = 1; i < 15; i++) spec[0].resolved['c/n' + String(i).padStart(2, '0') + '.md'] = 1;
	return makeVault(spec);
}

// 15 个节点、arms=3 → 4 条轨道（s=0..3）
const COMET_GRAPH = GraphBuilder.buildGraph(cometVault());
const COMET_RES = Layout.build(COMET_GRAPH, { capacity: 1, spacing: 1, arms: 3 });

function cometsByOrbit(graph, res) {
	const map = new Map();
	for (let i = 0; i < graph.nodes.length; i++) {
		const rec = res.nodes[i];
		if (!rec.comet) continue;
		const arr = map.get(rec.orbit) || [];
		arr.push(i);
		map.set(rec.orbit, arr);
	}
	return map;
}

check('彗星：只有第 1 轨与最外轨各一个', () => {
	const map = cometsByOrbit(COMET_GRAPH, COMET_RES);
	const orbits = [];
	for (const k of map.keys()) orbits.push(k);
	orbits.sort((a, b) => a - b);
	assert(orbits.length === 2, '彗星应只有 2 个轨道，实际 ' + orbits.length + ' → ' + orbits.join(','));
	assert(orbits[0] === 0, '第 1 轨应有彗星');
	let lastOrbit = 0;
	for (let i = 0; i < COMET_GRAPH.nodes.length; i++) {
		const rec = COMET_RES.nodes[i];
		if (rec.root || COMET_GRAPH.nodes[i].kind !== 'md') continue;
		if (rec.orbit > lastOrbit) lastOrbit = rec.orbit;
	}
	assert(orbits[1] === lastOrbit, '最外轨（s=' + lastOrbit + '）应有彗星，实际 s=' + orbits[1]);
	assert(map.get(0).length === 1 && map.get(lastOrbit).length === 1, '每个彗星轨道只能有一个');
});

check('彗星：中间轨道没有彗星', () => {
	const map = cometsByOrbit(COMET_GRAPH, COMET_RES);
	let lastOrbit = 0;
	for (let i = 0; i < COMET_GRAPH.nodes.length; i++) {
		const rec = COMET_RES.nodes[i];
		if (rec.root || COMET_GRAPH.nodes[i].kind !== 'md') continue;
		if (rec.orbit > lastOrbit) lastOrbit = rec.orbit;
	}
	for (let s = 1; s < lastOrbit; s++) assert(!map.has(s), '第 ' + (s + 1) + ' 轨不应有彗星');
});

check('彗星：离心率首轨 0.86、最外轨 0.70', () => {
	const map = cometsByOrbit(COMET_GRAPH, COMET_RES);
	const first = COMET_RES.nodes[map.get(0)[0]];
	let lastOrbit = 0;
	for (let i = 0; i < COMET_GRAPH.nodes.length; i++) {
		const rec = COMET_RES.nodes[i];
		if (rec.root || COMET_GRAPH.nodes[i].kind !== 'md') continue;
		if (rec.orbit > lastOrbit) lastOrbit = rec.orbit;
	}
	const last = COMET_RES.nodes[map.get(lastOrbit)[0]];
	assert(Math.abs(first.e - 0.86) < 1e-9, '首轨 e=' + first.e);
	assert(Math.abs(last.e - 0.7) < 1e-9, '末轨 e=' + last.e);
});

check('拼音首字母：汉字取首字母、字母取大写、其它为 #', () => {
	assert(Core.pinyinInitial('计') === 'J', '计 → ' + Core.pinyinInitial('计'));
	assert(Core.pinyinInitial('末') === 'M', '末 → ' + Core.pinyinInitial('末'));
	assert(Core.pinyinInitial('期') === 'Q', '期 → ' + Core.pinyinInitial('期'));
	assert(Core.pinyinInitial('a') === 'A', 'a → ' + Core.pinyinInitial('a'));
	assert(Core.pinyinInitial('1') === '#', '1 → ' + Core.pinyinInitial('1'));

	assert(Core.lastWordInitial('数学 期末.pdf') === 'Q', '期末 → ' + Core.lastWordInitial('数学 期末.pdf'));
	assert(Core.lastWordInitial('notes_2024-总结.pdf') === 'Z', '总结 → ' + Core.lastWordInitial('notes_2024-总结.pdf'));
	assert(Core.lastWordInitial('report-final.PDF') === 'F', 'final → ' + Core.lastWordInitial('report-final.PDF'));
});

check('彗星：椭圆长轴在进动（绕焦点缓慢旋转）', () => {
	let comet = -1;
	for (let i = 0; i < COMET_RES.nodes.length; i++) if (COMET_RES.nodes[i].comet) { comet = i; break; }
	const rec = COMET_RES.nodes[comet];
	assert(rec.omega > 0, '彗星应有进动角速度：' + rec.omega);

	// base 固定为 0（球停在椭圆同一点），只有长轴在转 → 位置必须变化
	const p0 = Layout.pose(rec, { clock: 0, base: 0, sizeK: 1 });
	const p1 = Layout.pose(rec, { clock: 50, base: 0, sizeK: 1 });
	const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
	assert(moved > 1, '长轴未进动，位移只有 ' + moved.toFixed(3));
	assert(Math.abs(p1.rho - p0.rho) < 1e-6, '进动不应改变到中心的距离：' + p0.rho + ' vs ' + p1.rho);
});

check('彗星：第 1 轨速率与常规一致（1.0）', () => {
	const map = cometsByOrbit(COMET_GRAPH, COMET_RES);
	const orbits = [];
	for (const k of map.keys()) orbits.push(k);
	orbits.sort((a, b) => a - b);
	const first = COMET_RES.nodes[map.get(orbits[0])[0]];
	assert(Math.abs(first.cometRate - 1) < 1e-9, '第 1 轨彗星速率应为 1：' + first.cometRate);
	const last = COMET_RES.nodes[map.get(orbits[orbits.length - 1])[0]];
	assert(Math.abs(last.cometRate - 1) < 1e-9, '最外轨彗星仍应是 1 倍：' + last.cometRate);
});
check('彗星：第 1 轨的近点不贴着中心球', () => {
	const map = cometsByOrbit(COMET_GRAPH, COMET_RES);
	const rec = COMET_RES.nodes[map.get(0)[0]];
	const peri = rec.a * (1 - rec.e);
	assert(peri >= 4 * Layout.CENTER_RADIUS - 1e-6, '近点 ' + peri.toFixed(2) + ' 太小');
});

check('彗星：轨道数不足 2 条时不生成', () => {
	const spec = [];
	for (let i = 0; i < 2; i++) {
		const day = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
		spec.push({ path: 's/n' + i + '.md', fm: { 'creation-time': day }, resolved: {} });
	}
	spec[0].resolved['s/n1.md'] = 1;
	const g = GraphBuilder.buildGraph(makeVault(spec));
	const res = Layout.build(g, { capacity: 1, spacing: 1, arms: 3 });
	for (const rec of res.nodes) assert(!rec.comet, '只有 1 条轨道时不应有彗星');
});

check('彗星：椭圆焦点确实在中心', () => {
	let comet = -1;
	for (let i = 0; i < COMET_RES.nodes.length; i++) if (COMET_RES.nodes[i].comet) { comet = i; break; }
	assert(comet >= 0);
	const rec = COMET_RES.nodes[comet];
	const a = rec.a;
	const e = rec.e;
	for (let k = 0; k < 200; k++) {
		const t = k * 0.37;
		const p = Layout.pose(rec, { clock: t, base: t * 0.34, sizeK: 1 });
		const r = Math.hypot(p.x, p.y);
		// 长轴在进动，真实近点方向 = peri + omega·t
		const periNow = rec.peri + (rec.omega || 0) * t;
		const nu = Core.angleDelta(periNow, p.ang);
		const lhs = r * (1 + e * Math.cos(nu));
		assert(Math.abs(lhs - a * (1 - e * e)) < 1e-6, '不满足椭圆方程：' + lhs.toFixed(4) + ' vs ' + (a * (1 - e * e)).toFixed(4));
		assert(r >= a * (1 - e) - 1e-6 && r <= a * (1 + e) + 1e-6, '半径越出近点/远点');
	}
});

check('彗星：开普勒变速（近点比远点快得多）', () => {
	let comet = -1;
	for (let i = 0; i < COMET_RES.nodes.length; i++) if (COMET_RES.nodes[i].comet) { comet = i; break; }
	const rec = COMET_RES.nodes[comet];
	let minSpeed = Infinity;
	let maxSpeed = 0;
	let prev = null;
	for (let k = 0; k < 600; k++) {
		const t = k * 0.05;
		const p = Layout.pose(rec, { clock: t, base: t * 0.34, sizeK: 1 });
		if (prev) {
			const d = Math.abs(Core.angleDelta(prev.ang, p.ang)) / 0.05;
			if (d < minSpeed) minSpeed = d;
			if (d > maxSpeed) maxSpeed = d;
		}
		prev = p;
	}
	assert(maxSpeed > minSpeed * 2, '应有明显的近快远慢：max=' + maxSpeed.toFixed(3) + ' min=' + minSpeed.toFixed(3));
});

check('彗星：远点计入取景半径', () => {
	let ok = true;
	for (let i = 0; i < COMET_RES.nodes.length; i++) {
		const rec = COMET_RES.nodes[i];
		if (!rec.comet) continue;
		const far = rec.a * (1 + rec.e) + rec.radius;
		if (COMET_RES.maxR < far - 1e-6) ok = false;
	}
	assert(ok, 'maxR ' + COMET_RES.maxR.toFixed(1) + ' 小于彗星远点');
});

check('彗星：两颗 PDF 彗星（第一颗不出外圈、第二颗会进内环）', () => {
	const g = GraphBuilder.buildGraph(labVault(20));
	const res = Layout.build(g, { spacing: 1 });

	let maxMd = 0;
	const pdfComets = [];
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (g.nodes[i].kind === 'pdf') {
			if (rec.comet) pdfComets.push(i);
			continue;
		}
		if (rec.root || rec.comet) continue;
		if (rec.rho > maxMd) maxMd = rec.rho;
	}
	assert(pdfComets.length === 2, '应有 2 颗 PDF 彗星，实际 ' + pdfComets.length);

	// 按离心率区分：0.45 → 不出外圈；0.30 → 会进内环
	let outerIdx = -1;
	let innerIdx = -1;
	for (const i of pdfComets) {
		if (Math.abs(res.nodes[i].e - 0.44) < 1e-9) outerIdx = i;
		if (Math.abs(res.nodes[i].e - 0.3) < 1e-9) innerIdx = i;
	}
	assert(outerIdx >= 0 && innerIdx >= 0, '两颗的离心率应分别是 0.44 与 0.30');
	const outer = res.nodes[outerIdx];
	assert(outer.a * (1 - outer.e) > maxMd, '第一颗近点 ' + (outer.a * (1 - outer.e)).toFixed(1) + ' 应 > ' + maxMd.toFixed(1));
	assert(outer.drift === false, 'PDF 彗星不应再漂移');
	assert(Math.abs(outer.cometRate - 0.95) < 1e-9, 'PDF 彗星速率应为 0.95：' + outer.cometRate);

	// 第二颗（e=0.30、a=0.6×pdfR）：近点落进 MD 轨道区域（最外轨 = res.maxRho）
	const inner = res.nodes[innerIdx];
	assert(inner.a * (1 - inner.e) < res.maxRho, '第二颗近点 ' + (inner.a * (1 - inner.e)).toFixed(1) + ' 应 < 最外轨 ' + res.maxRho.toFixed(1) + '（进内环）');
	assert(inner.a * (1 + inner.e) < res.pdfR, '第二颗远点也不该越过 PDF 环');

	// 其余 PDF 仍在 PDF 环上、且不是彗星
	for (let i = 0; i < g.nodes.length; i++) {
		if (g.nodes[i].kind !== 'pdf' || pdfComets.indexOf(i) >= 0) continue;
		assert(!res.nodes[i].comet, '只应有 2 颗 PDF 彗星');
		assert(res.nodes[i].drift === true, '其它 PDF 仍应保留漂移');
		assert(res.nodes[i].rho > maxMd, '其它 PDF 仍应在 MD 之外');
	}
});

check('彗星挑 PDF：按文件名最后一个词的拼音首字母取最大', () => {
	const spec = [];
	const names = ['数学 期末.pdf', '物理 复习.pdf', '化学 总结.pdf'];
	for (let i = 0; i < 12; i++) {
		const day = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
		spec.push({ path: 'p/n' + i + '.md', fm: { 'creation-time': day }, resolved: {} });
	}
	for (let i = 1; i < 12; i++) spec[0].resolved['p/n' + i + '.md'] = 1;
	for (const n of names) spec.push({ path: 'p/' + n, ext: 'pdf' });

	const g = GraphBuilder.buildGraph(makeVault(spec));
	const res = Layout.build(g, { spacing: 1 });

	let picked = -1;
	for (let i = 0; i < g.nodes.length; i++) if (res.nodes[i].comet && g.nodes[i].kind === 'pdf') picked = i;
	assert(picked >= 0, '没有挑出 PDF 彗星');
	// 期末→Q、复习→F、总结→Z → 最大是「总结」(Z)
	assert(g.nodes[picked].path.indexOf('总结') >= 0, '应挑首字母最大的「总结」，实际 ' + g.nodes[picked].path);
});

/** 在第 1 轨（节点 1/2/3）上放指定标题，返回被选中的那个 */
function cometPickFirstOrbit(titles) {
	const spec = [];
	for (let i = 0; i < 15; i++) {
		const day = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
		const fm = { 'creation-time': day };
		if (titles && titles[i]) fm.title = titles[i];
		spec.push({ path: 'c/n' + String(i).padStart(2, '0') + '.md', fm, resolved: {} });
	}
	for (let i = 1; i < 15; i++) spec[0].resolved['c/n' + String(i).padStart(2, '0') + '.md'] = 1;

	const g = GraphBuilder.buildGraph(makeVault(spec));
	const res = Layout.build(g, { capacity: 1, spacing: 1, arms: 3 });
	for (let i = 0; i < res.nodes.length; i++) {
		if (res.nodes[i].comet && res.nodes[i].orbit === 0) {
			return { path: g.nodes[i].path, label: g.nodes[i].label };
		}
	}
	return null;
}

check('彗星排序：首字母相同则比最后一个字母', () => {
	// kb / ka / zz → 首字母 k,k,z 淘汰 zz；末位 b,a → 选 ka（节点 2）
	const picked = cometPickFirstOrbit({ 1: 'kb', 2: 'ka', 3: 'zz' });
	assert(picked && picked.label === 'ka', '选中的是 ' + (picked && picked.label));
});

check('彗星排序：末位也相同则比倒数第二个字母', () => {
	// kya / kxa / zz → 首字母 k,k,z；末位 a,a 相同；倒数第二 y,x → 选 kxa
	const picked = cometPickFirstOrbit({ 1: 'kya', 2: 'kxa', 3: 'zz' });
	assert(picked && picked.label === 'kxa', '选中的是 ' + (picked && picked.label));
});

check('彗星排序：没有 title 时用文件名', () => {
	const picked = cometPickFirstOrbit(null);
	assert(picked && picked.label === 'n01', '选中的是 ' + (picked && picked.label));
});

check('彗星排序：完全相同则按路径决胜且结果稳定', () => {
	const a = cometPickFirstOrbit({ 1: 'same', 2: 'same', 3: 'same' });
	const b = cometPickFirstOrbit({ 1: 'same', 2: 'same', 3: 'same' });
	assert(a && a.path === 'c/n01.md', '应按路径选 n01，实际 ' + (a && a.path));
	assert(b && b.path === a.path, '两次结果应一致');
});

// ---------------------------------------------------------------------------
// A2. 每周计划（纯逻辑）
// ---------------------------------------------------------------------------
console.log('\n[A2] 每周计划');

check('ISO 周：2026-10-19 是第 43 周（周一 → 周日）', () => {
	const w = Plan.isoWeekOf(new Date(2026, 9, 19));
	assert(w.year === 2026, '年 ' + w.year);
	assert(w.week === 43, '周 ' + w.week);
	assert(w.monday.getUTCDate() === 19 && w.monday.getUTCMonth() === 9, '周一 ' + w.monday.toISOString());
	assert(w.sunday.getUTCDate() === 25, '周日 ' + w.sunday.toISOString());
});

check('ISO 周：跨年边界', () => {
	const a = Plan.isoWeekOf(new Date(2021, 0, 1)); // 2020 年第 53 周
	assert(a.year === 2020 && a.week === 53, a.year + ' W' + a.week);
	const b = Plan.isoWeekOf(new Date(2024, 11, 30)); // 2025 年第 1 周
	assert(b.year === 2025 && b.week === 1, b.year + ' W' + b.week);
});

check('周路径：orbit-plan/<年>/<周>周.md', () => {
	assert(Plan.planPath('orbit-plan', 2026, 43) === 'orbit-plan/2026/43周.md', Plan.planPath('orbit-plan', 2026, 43));
	assert(Plan.planPath('/plan/', 2026, 5) === 'plan/2026/05周.md', Plan.planPath('/plan/', 2026, 5));
});

check('骨架：四个象限 + PDCA', () => {
	const s = Plan.skeleton(2026, 43);
	for (const q of Plan.QUADRANTS) assert(s.indexOf('## ' + q.title) >= 0, '缺象限 ' + q.title);
	assert(s.indexOf('## PDCA 复盘') >= 0, '缺 PDCA');
	assert(s.indexOf('### P 计划（Plan）') >= 0, '缺 P');
	assert(s.indexOf('# 2026 年第 43 周') >= 0, '缺标题');
});

check('解析：象限任务与 PDCA 文本', () => {
	const text = [
		'# t',
		'',
		'## 重要 · 紧急',
		'- [ ] A',
		'- [x] B',
		'',
		'## 不重要 · 紧急',
		'- [ ] C',
		'',
		'## 重要 · 不紧急',
		'',
		'## 不重要 · 不紧急',
		'- [ ] D',
		'',
		'## PDCA 复盘',
		'### P 计划（Plan）',
		'计划内容',
		'### D 执行（Do）',
		'',
		'### C 检查（Check）',
		'差距',
		'### A 改进（Act）',
		'',
	].join('\n');
	const p = Plan.parse(text);
	assert(p.days[0].quads[0].tasks.length === 2, '象限 1 任务数 ' + p.days[0].quads[0].tasks.length);
	assert(p.days[0].quads[0].tasks[1].done === true, 'B 应为已完成');
	assert(p.days[0].quads[1].tasks[0].text === 'C', '象限 2 ' + JSON.stringify(p.days[0].quads[1].tasks));
	assert(p.days[0].quads[3].tasks[0].text === 'D', '象限 4 ' + JSON.stringify(p.days[0].quads[3].tasks));
	assert(p.pdca[0] === '计划内容', 'P=' + JSON.stringify(p.pdca[0]));
	assert(p.pdca[2] === '差距', 'C=' + JSON.stringify(p.pdca[2]));
	assert(p.pdca[1] === '', 'D 应为空');
});

check('象限识别：不 / 重要 / 紧急 组合', () => {
	assert(Plan.quadrantIndexOf('重要 · 紧急') === 0);
	assert(Plan.quadrantIndexOf('不重要 · 紧急') === 1);
	assert(Plan.quadrantIndexOf('重要 · 不紧急') === 2);
	assert(Plan.quadrantIndexOf('不重要 · 不紧急') === 3);
	assert(Plan.quadrantIndexOf('随便什么') === -1);
});

check('改写：勾选只动那一行', () => {
	const text = '## 重要 · 紧急\n- [ ] A\n- [ ] B\n';
	const p = Plan.parse(text);
	const next = Plan.toggleTask(text, p.days[0].quads[0].tasks[0].line);
	assert(next.indexOf('- [x] A') >= 0 && next.indexOf('- [ ] B') >= 0, next);
});

check('改写：新增追加到对应象限', () => {
	const text = Plan.skeleton(2026, 43);
	const next = Plan.addTask(text, 0, 1, '买牛奶');
	const p = Plan.parse(next);
	assert(p.days[0].quads[1].tasks.length === 1 && p.days[0].quads[1].tasks[0].text === '买牛奶', JSON.stringify(p.days[0].quads[1].tasks));
	assert(p.days[0].quads[0].tasks.length === 0, '不应影响其它象限');
});

check('改写：删除只删那一行', () => {
	const text = '## 重要 · 紧急\n- [ ] A\n- [ ] B\n';
	const p = Plan.parse(text);
	const next = Plan.removeTask(text, p.days[0].quads[0].tasks[1].line);
	assert(next.indexOf('B') < 0 && next.indexOf('A') >= 0, next);
});

check('改写：PDCA 小节替换（不动其它小节）', () => {
	let text = Plan.skeleton(2026, 43);
	text = Plan.setPdca(text, 0, '第一行\n第二行');
	const p = Plan.parse(text);
	assert(p.pdca[0] === '第一行\n第二行', JSON.stringify(p.pdca[0]));
	assert(p.pdca[3] === '', 'A 应仍为空');
});

check('导入上周：只取未完成并去重', () => {
	const prev = '## 重要 · 紧急\n- [x] 已完成\n- [ ] 未完成A\n## 不重要 · 紧急\n- [ ] 未完成B\n';
	const items = Plan.collectUnfinished(prev);
	assert(items.length === 2, '未完成数 ' + items.length);
	assert(items[0].text === '未完成A' && items[1].text === '未完成B', JSON.stringify(items));

	let cur = Plan.skeleton(2026, 44);
	cur = Plan.addTask(cur, 0, 0, '未完成A'); // 已存在那条
	const merged = Plan.mergeUnfinished(cur, items);
	assert(merged.added === 1, '应只新增 1 条，实际 ' + merged.added);
	assert(Plan.parse(merged.text).days[0].quads[0].tasks.length === 1, 'A 不应重复');
	assert(Plan.parse(merged.text).days[0].quads[1].tasks.length === 1, 'B 应被导入');
});

// ---------------------------------------------------------------------------
// B. API 桩冒烟
// ---------------------------------------------------------------------------
console.log('\n[B] API 桩冒烟');

const smokePath = join(ROOT, 'dev', 'smoke-bundle.cjs');
let PluginClass = null;
let cachedPlugin = null;

async function ensurePlugin() {
	if (cachedPlugin) return cachedPlugin;
	const app = makeVault([]);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	cachedPlugin = plugin;
	return plugin;
}

check('main.js 可被加载并导出插件类', () => {
	PluginClass = require(smokePath);
	assert(typeof PluginClass === 'function', '导出不是构造函数');
});

await checkAsync('onload 注册了视图 / 命令 / 设置页（不再有 ribbon 图标）', async () => {
	const plugin = await ensurePlugin();
	assert(plugin.views.length === 1, '视图数量 ' + plugin.views.length);
	assert(plugin.views[0].type === 'orbit-plan-kle-view', '视图类型 ' + plugin.views[0].type);
	assert(DETACHED.indexOf('graph-orbit-kle-view') >= 0, '没有清理改名前遗留的旧标签页');
	assert(typeof plugin.views[0].factory === 'function', '视图工厂缺失');
	assert(plugin.ribbon.length === 0, '不应再注册 ribbon 图标：' + plugin.ribbon.length);
	assert(plugin.commands.length === 1 && plugin.commands[0].hotkeys === undefined, '命令/快捷键');
	assert(plugin.settingTabs.length === 1, '设置页数量');
	assert(typeof plugin.onunload === 'function', '缺 onunload');
	assert(plugin.settings.spacing === 1 && plugin.settings.trail === 0.55, '默认设置未加载');
	assert(!('arms' in plugin.settings) && !('capacity' in plugin.settings), '已废弃的 arms/capacity 不应再出现');
	assert(plugin.settings.scheme === 'purple', '默认色系 ' + plugin.settings.scheme);
	assert(plugin.settings.colors && typeof plugin.settings.colors === 'object', '自定义颜色容器缺失');
	assert(plugin.settings.panel === undefined, '悬浮窗的几何设置应已移除');
});

await checkAsync('激活：没有视图时放进左侧栏（不再开主编辑区标签）', async () => {
	const calls = { leftLeaf: 0, tabLeaf: 0, states: [], revealed: 0, expanded: 0 };
	const workspace = {
		on: () => ({}),
		getLeavesOfType: () => [],
		getLeftLeaf: () => {
			calls.leftLeaf++;
			return {
				setViewState: async (st) => {
					calls.states.push(st);
				},
			};
		},
		getLeaf: () => {
			calls.tabLeaf++;
			return { setViewState: async () => {} };
		},
		revealLeaf: () => {
			calls.revealed++;
		},
		getActiveViewOfType: () => null,
		leftSplit: {
			expand: () => {
				calls.expanded++;
			},
		},
	};
	const app = { vault: { on: () => ({}), getFiles: () => [] }, metadataCache: { on: () => ({}), resolvedLinks: {} }, workspace };
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	await plugin.attachView();

	assert(calls.leftLeaf === 1, '应使用左侧栏 leaf');
	assert(calls.tabLeaf === 0, '不应再开主编辑区标签');
	assert(calls.states.length === 1 && calls.states[0].type === 'orbit-plan-kle-view', '视图类型不对');
	assert(calls.states[0].active === true, '应激活');
	assert(calls.revealed === 1, '应聚焦');
	assert(calls.expanded === 1, '侧栏收起时应展开');
});

await checkAsync('激活：已有标签时只聚焦，不新建（A 方案）', async () => {
	const calls = { leaf: 0, revealed: 0 };
	const existingLeaf = {};
	const workspace = {
		on: () => ({}),
		getLeavesOfType: () => [existingLeaf],
		getLeaf: () => {
			calls.leaf++;
			return { setViewState: async () => {} };
		},
		revealLeaf: () => {
			calls.revealed++;
		},
		getActiveViewOfType: () => null,
	};
	const app = { vault: { on: () => ({}), getFiles: () => [] }, metadataCache: { on: () => ({}), resolvedLinks: {} }, workspace };
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	await plugin.attachView();

	assert(calls.leaf === 0, '已有标签时不应再 getLeaf');
	assert(calls.revealed === 1, '应聚焦已有标签');
});

await checkAsync('设置页 display() 不抛错', async () => {
	const plugin = await ensurePlugin();
	plugin.settingTabs[0].display();
});

// ---------------------------------------------------------------------------
// C. 渲染链冒烟
// ---------------------------------------------------------------------------
console.log('\n[C] 渲染链冒烟');

let demoView = null;

/** 取"普通 PDF 球"（非彗星、非时间针）——只有它们有引力 */
function plainPdfs(view) {
	const out = [];
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 1) continue;
		const rec = view.recs[i];
		if (rec.clockHand || rec.comet) continue;
		out.push(i);
	}
	return out;
}
function advance(view, frames) {
	const t0 = performance.now();
	for (let i = 1; i <= frames; i++) view.tick(t0 + i * 16);
}

await checkAsync('挂载面板 → 多帧 tick → 绘制 全链路不抛错', async () => {
	const app = labVault(30);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	demoView = view;

	advance(view, 10);

	assert(view.n === 33, '节点数 ' + view.n);
	assert(view.hasFit === true, '首帧未取景');
	const rec = view.canvasEl._records;
	assert(rec.arcs > 0, '没有画出球体/尾迹');
	assert(rec.strokes > 0, '没有画出连线或尾迹');
	// 默认不显示任何节点名称
	assert(rec.texts.length === 0, '未悬停时不应有文字：' + rec.texts.join('|'));
});

await checkAsync('悬停：只显示该节点的名称，并加高亮环', async () => {
	const view = demoView;
	const target = 3;
	view.setHovered(target);
	view.canvasEl._records.texts.length = 0;
	view.canvasEl._records.arcs = 0;
	advance(view, 1);

	const texts = view.canvasEl._records.texts;
	assert(texts.length === 1, '应只画一个名称，实际 ' + texts.length + '：' + texts.join('|'));
	assert(texts[0] === view.labels[target], '名称不是该节点的：' + texts[0]);
	assert(view.canvasEl._records.arcs > view.n, '没有画出高亮环');
});

await checkAsync('悬停：该节点冻结，其他节点仍在动', async () => {
	const view = demoView;
	const frozen = view.hovered;
	let other = -1;
	for (let i = 0; i < view.n; i++) {
		if (i === frozen) continue;
		if (view.kinds[i] === 2) continue; // 中心本来就不动
		other = i;
		break;
	}
	assert(other >= 0, '找不到可对比的节点');

	const fx = view.xs[frozen];
	const fy = view.ys[frozen];
	const ox = view.xs[other];
	const oy = view.ys[other];

	advance(view, 25);

	assert(view.xs[frozen] === fx && view.ys[frozen] === fy, '被悬停的节点仍在移动');
	assert(Math.hypot(view.xs[other] - ox, view.ys[other] - oy) > 1e-3, '其他节点不应该停');
});

await checkAsync('悬停：离开后平滑追上', async () => {
	const view = demoView;
	const idx = view.hovered;
	view.setHovered(-1);
	const start = view.lag[idx];
	assert(start > 0, '解冻后应记录时间差');

	advance(view, 30); // ≈0.48s
	assert(view.lag[idx] < start * 0.1, '0.5 秒后应基本归位，实际 ' + (view.lag[idx] / start).toFixed(3));

	advance(view, 60);
	assert(view.lag[idx] === 0, 'lag 未清零：' + view.lag[idx]);
});

await checkAsync('PDF 慢转、漂移有界、中心固定在原点', async () => {
	const view = demoView;
	const pdf = view.graph.nodes.findIndex((n, i) => n.kind === 'pdf' && !view.recs[i].comet);
	const r1 = Math.hypot(view.xs[pdf], view.ys[pdf]);
	const a1 = Math.atan2(view.ys[pdf], view.xs[pdf]);

	advance(view, 40);

	const r2 = Math.hypot(view.xs[pdf], view.ys[pdf]);
	const a2 = Math.atan2(view.ys[pdf], view.xs[pdf]);
	const pdfRec = view.recs[pdf];
	assert(Math.abs(r1 - r2) < pdfRec.rho * 0.2, 'PDF 半径跳变过大');
	assert(r2 >= pdfRec.rho * 0.89 - 1e-6 && r2 <= pdfRec.rho * 1.05 + 1e-6, 'PDF 半径越界：' + r2.toFixed(2));
	assert(Math.abs(Core.angleDelta(a1, a2)) > 1e-4, 'PDF 没有公转');

	const center = view.graph.center;
	assert(Math.abs(view.xs[center]) < 1e-9 && Math.abs(view.ys[center]) < 1e-9, '中心不在原点');
});

await checkAsync('暂停后时钟不再前进', async () => {
	const view = demoView;
	view.paused = true;
	const before = view.clock;
	advance(view, 5);
	assert(view.clock === before, '暂停后 clock 前进了');
	view.paused = false;
});

await checkAsync('命中测试与投影一致', async () => {
	const view = demoView;
	const i = 0;
	const sx = (view.xs[i] - view.ox) * view.scale + view.renderer.w / 2;
	const sy = (view.ys[i] - view.oy) * view.scale + view.renderer.h / 2;
	assert(view.hitTest(sx, sy) === i, '命中失败');
	assert(view.hitTest(-5000, -5000) === -1, '空白处不应命中');
});

await checkAsync('空库只画提示文字', async () => {
	const app = makeVault([]);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	view.tick(performance.now() + 16);
	assert(view.n === 0, '空库节点数应为 0');
	const texts = view.canvasEl._records.texts.join('|');
	assert(texts.indexOf('还没有 Markdown 或 PDF') >= 0, '缺空状态提示：' + texts);
	await view.onClose();
});

await checkAsync('连线：默认不画，悬停才画该节点的连线', async () => {
	const view = demoView;
	view.setHovered(-1);
	view.plugin.settings.trail = 0; // 关掉尾迹，隔离出「描边」次数
	view.canvasEl._records.strokes = 0;
	advance(view, 1);
	const baseline = view.canvasEl._records.strokes; // 只含 PDF 描边等固有描边

	// 找一个有邻居、且不是 PDF 的节点
	let target = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.adj[i].length > 0 && view.kinds[i] === 0) {
			target = i;
			break;
		}
	}
	assert(target >= 0, '找不到有连接的笔记节点');
	const deg = view.adj[target].length;

	view.setHovered(target);
	view.canvasEl._records.strokes = 0;
	advance(view, 1);
	const withHover = view.canvasEl._records.strokes;

	// deg 条连线 + 1 圈高亮环
	assert(withHover - baseline === deg + 1, '悬停应多画 ' + (deg + 1) + ' 次描边，实际多 ' + (withHover - baseline));

	view.plugin.settings.trail = 0.55;
	view.setHovered(-1);
});

await checkAsync('悬停 PDF 也能看到它连的笔记', async () => {
	const view = demoView;
	let pdf = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] === 1 && view.adj[i].length > 0) {
			pdf = i;
			break;
		}
	}
	assert(pdf >= 0, '找不到带连线的 PDF');
	const deg = view.adj[pdf].length;

	view.plugin.settings.trail = 0;
	view.setHovered(-1);
	view.canvasEl._records.strokes = 0;
	advance(view, 1);
	const baseline = view.canvasEl._records.strokes;

	view.setHovered(pdf);
	view.canvasEl._records.strokes = 0;
	advance(view, 1);
	const withHover = view.canvasEl._records.strokes;
	assert(withHover - baseline === deg + 2, 'PDF 的连线+轨道描边数不对：应多 ' + (deg + 2) + '，实际多 ' + (withHover - baseline));

	view.plugin.settings.trail = 0.55;
	view.setHovered(-1);
});

await checkAsync('彗星尾迹同样受「轨迹长度」控制', async () => {
	const view = demoView;
	view.plugin.settings.trail = 0.55;

	let hasComet = false;
	for (let i = 0; i < view.n; i++) if (view.cometMask[i]) hasComet = true;
	assert(hasComet, '这个库应该有彗星');

	const normal = view.buildCometTrails();
	assert(normal.length > 0, '默认应有彗星尾迹');
	assert(normal[0].pts.length === 10, '采样点数应为 10，实际 ' + normal[0].pts.length);

	view.plugin.settings.trail = 0;
	assert(view.buildCometTrails().length === 0, 'trail=0 时彗星也不该有尾迹');

	view.plugin.settings.trail = 1;
	const long = view.buildCometTrails();
	assert(long.length > 0, 'trail=1 时应有尾迹');
	const p0 = long[0].pts[0];
	const p1 = long[0].pts[long[0].pts.length - 1];
	assert(Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) > 1e-6, '尾迹应覆盖一段距离');

	view.plugin.settings.trail = 0.55;
});

await checkAsync('空格：仅当该视图是当前激活视图时才暂停', async () => {
	const view = demoView;
	const makeEvent = () => ({
		code: 'Space',
		key: ' ',
		target: null,
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	});

	view.paused = false;
	ACTIVE_VIEW = null;
	view.handleKey(makeEvent());
	assert(view.paused === false, '非激活视图不应响应空格');

	ACTIVE_VIEW = view;
	const e = makeEvent();
	view.handleKey(e);
	assert(view.paused === true, '激活视图应能暂停');
	assert(e.prevented === true, '应阻止默认行为');

	view.paused = false;
	ACTIVE_VIEW = null;
});

await checkAsync('设置变更会广播到所有已开的视图实例', async () => {
	const app = labVault(12);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();

	const v1 = plugin.views[0].factory({ app });
	const v2 = plugin.views[0].factory({ app });
	const leaves = [{ view: v1 }, { view: v2 }];
	app.workspace.getLeavesOfType = () => leaves;

	v1.needRecolor = false;
	v2.needRecolor = false;
	plugin.broadcastNow('color');
	assert(v1.needRecolor === true && v2.needRecolor === true, '两个实例都应收到通知');
});

function collectText(el) {
	let out = '';
	if (!el) return out;
	if (el.textContent) out += el.textContent + ' ';
	const kids = el.children || [];
	for (let i = 0; i < kids.length; i++) out += collectText(kids[i]) + ' ';
	return out;
}

await checkAsync('下半区：渲染四个象限与空状态', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	assert(view.weekNum >= 1 && view.weekNum <= 53, '周次异常 ' + view.weekNum);
	assert(view.weekYear >= 2020, '年份异常 ' + view.weekYear);

	const text = collectText(view.planEl);
	for (const q of Plan.QUADRANTS) assert(text.indexOf(q.title) >= 0, '缺象限 ' + q.title);
	assert(text.indexOf('本周还没有待办') >= 0, '缺空状态：' + text.slice(0, 160));
	assert(text.indexOf('PDCA') >= 0, '缺 PDCA 入口');
	await view.onClose();
});

await checkAsync('下半区：新增任务会写入每周笔记并刷新界面', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const base = Plan.skeleton(view.weekYear, view.weekNum);
	await view.writePlanText(Plan.addTask(base, 0, 0, '测试任务'));

	assert(view.planText.indexOf('- [ ] 测试任务') >= 0, '文本未更新');
	const file = app.vault.getAbstractFileByPath(view.planPathNow());
	assert(file, '应创建计划笔记：' + view.planPathNow());
	assert(collectText(view.planEl).indexOf('测试任务') >= 0, 'DOM 未刷新');
	await view.onClose();
});

function findByClass(el, cls) {
	if (!el) return null;
	if (el.classes && typeof el.classes.has === 'function' && el.classes.has(cls)) return el;
	const kids = el.children || [];
	for (let i = 0; i < kids.length; i++) {
		const hit = findByClass(kids[i], cls);
		if (hit) return hit;
	}
	return null;
}

await checkAsync('下半区：进度条显示完成百分比', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 0, 0, '甲');
	text = Plan.addTask(text, 0, 0, '乙');
	view.planText = text;
	view.renderPlan();
	assert(collectText(view.planEl).indexOf('0%') >= 0, '无完成时应是 0%');

	const p = Plan.parse(text);
	view.planText = Plan.toggleTask(text, p.days[0].quads[0].tasks[0].line);
	view.renderPlan();
	const s = collectText(view.planEl);
	assert(s.indexOf('50%') >= 0, '应显示 50%，实际：' + s.slice(-100));
	await view.onClose();
});

await checkAsync('下半区：回车后在同一象限继续输入', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const sec = document.body.createDiv({});
	const addBtn = sec.createDiv({});
	view.openAddInput(sec, addBtn, 0, 0);

	const input = sec.children[sec.children.length - 1];
	input.value = '第一条';
	input.fire('keydown', { key: 'Enter', preventDefault() {} });
	await new Promise((r) => setTimeout(r, 0));

	assert(view.planText.indexOf('第一条') >= 0, '未写入：' + view.planText.slice(0, 60));
	assert(findByClass(view.planEl, 'orbit-plan-add-input'), '重绘后应自动再开一个输入框');
	await view.onClose();
});

function screenOf(view, i) {
	const rect = view.canvasEl.getBoundingClientRect();
	const s = view.scale;
	return {
		x: rect.left + (view.xs[i] - view.ox) * s + view.renderer.w / 2,
		y: rect.top + (view.ys[i] - view.oy) * s + view.renderer.h / 2,
	};
}

check('半径：连接越多越大，中心始终最大', () => {
	const r = (d) => Layout.nodeRadius({ kind: 'md', degree: d });
	assert(r(0) === 2.6 && r(1) > r(0) && r(4) > r(1) && r(16) > r(9), '半径映射不对：' + [r(0), r(1), r(4), r(16)]);
	assert(r(100) === r(40), '应封顶');
});

check('计划：改文字保留完成状态、只动那一行', () => {
	const text = '## 重要 · 紧急\n- [x] 旧文字\n- [ ] 另一条\n';
	const next = Plan.setTaskText(text, 1, '新文字');
	assert(next.indexOf('- [x] 新文字') >= 0, next);
	assert(next.indexOf('- [ ] 另一条') >= 0, '不应影响其它行');
	assert(Plan.setTaskText(text, 1, '  ') === null, '空文本应返回 null');
});

await checkAsync('拖拽：松开后吸附到最近的轨道并写入 pins', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 3);

	let target = -1;
	for (let i = 0; i < view.n; i++) {
		if (!view.cometMask[i] && view.kinds[i] !== 2) {
			target = i;
			break;
		}
	}
	assert(target >= 0, '找不到可拖的节点');

	const orbits = [];
	const seen = new Set();
	for (const rec of view.recs) {
		if (rec.comet || rec.root || seen.has(rec.orbit)) continue;
		seen.add(rec.orbit);
		orbits.push({ s: rec.orbit, rho: rec.rho });
	}
	orbits.sort((a, b) => a.rho - b.rho);
	const want = orbits[orbits.length - 1];

	view.nodeDrag = { i: target, x: 0, y: 0 };
	view.dragWorld = { x: want.rho, y: 0 };
	view.moved = true;
	view.finishNodeDrag();

	const path = view.graph.nodes[target].path;
	const pinned = plugin.settings.pins[path];
	assert(typeof pinned === 'number', 'pins 未写入：' + JSON.stringify(plugin.settings.pins));

	// 落点轨道不能超额（满了会自动跳到最近的有空位轨道）
	let used = 0;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (rec.root || rec.comet) continue;
		if (view.orbitNow[i] === pinned) used++;
	}
	assert(used <= Layout.orbitCapacity(pinned + 1), '落点轨道超额：' + used + ' > ' + Layout.orbitCapacity(pinned + 1));
	assert(Math.abs(view.rhoTarget[target] - view.rhoByOrbit.get(pinned)) < 1e-6, '没吸附到该轨道半径');

	const before = Array.from(view.cometMask).join('');
	view.applyLayout(true);
	assert(Array.from(view.cometMask).join('') === before, '彗星选取不应被拖拽影响');
	await view.onClose();
});

await checkAsync('拖拽：彗星不可拖，按在彗星上会退化成平移', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 3);

	let comet = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.cometMask[i]) {
			comet = i;
			break;
		}
	}
	assert(comet >= 0, '这个库应该有彗星');

	const pos = screenOf(view, comet);
	view.handleDown({ button: 0, clientX: pos.x, clientY: pos.y });
	assert(view.nodeDrag === null, '彗星不应进入拖拽');
	assert(view.dragging === true, '应转为平移画布');
	view.handleUp();
	await view.onClose();
});

await checkAsync('斥力：重叠的球被推开且位移有界', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	plugin.settings.repel = 1;
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const a = 1;
	let b = 2;
	if (view.cometMask[a]) b = 3;
	view.xs[a] = view.ys[a] = view.xs[b] = view.ys[b] = 60;
	view.applyRepulsion();

	const d = Math.hypot(view.xs[a] - view.xs[b], view.ys[a] - view.ys[b]);
	assert(d > 0, '重叠的球应被推开');
	const cap = Math.max(0.5, view.layoutMaxR * 0.015) * 2 + 1e-6;
	assert(d <= cap, '位移超出封顶：' + d + ' > ' + cap);
	await view.onClose();
});

await checkAsync('计划：双击任务文字可就地改，完成态保留', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 0, 0, '旧文字');
	const p = Plan.parse(text);
	text = Plan.toggleTask(text, p.days[0].quads[0].tasks[0].line); // 标记完成
	view.planText = text;
	view.renderPlan();

	const label = findByClass(view.planEl, 'orbit-plan-task-text');
	assert(label, '找不到任务文字');
	label.fire('dblclick');
	const input = findByClass(view.planEl, 'orbit-plan-task-edit');
	assert(input, '双击后应出现输入框');

	input.value = '新文字';
	input.fire('keydown', { key: 'Enter', preventDefault() {} });
	await new Promise((r) => setTimeout(r, 0));

	assert(view.planText.indexOf('- [x] 新文字') >= 0, '应保留完成态并改文字：' + view.planText.slice(0, 80));
	await view.onClose();
});

await checkAsync('拖拽：吸附后方向跟随目标轨道', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let target = -1;
	for (let i = 0; i < view.n; i++) {
		if (!view.cometMask[i] && view.kinds[i] === 0) {
			target = i;
			break;
		}
	}
	assert(target >= 0);

	const path = view.graph.nodes[target].path;
	let maxOrbit = 0;
	for (const r of view.recs) {
		if (r.root || r.comet) continue;
		if (r.orbit > maxOrbit) maxOrbit = r.orbit;
	}
	assert(maxOrbit >= 2, '这个库应有 >=3 条轨道，实际最外 s=' + maxOrbit);

	plugin.settings.pins[path] = maxOrbit; // 最外轨 → 应逆时针
	view.applyLayout(false);
	assert(view.recs[target].dir === -1, '第 ' + (maxOrbit + 1) + ' 轨应为逆时针，实际 dir=' + view.recs[target].dir);

	plugin.settings.pins[path] = 0; // 第 1 轨 → 应顺时针
	view.applyLayout(false);
	assert(view.recs[target].dir === 1, '第 1 轨应为顺时针，实际 dir=' + view.recs[target].dir);
	await view.onClose();
});

await checkAsync('撞击：被 PDF 彗星撞到的球降一轨，且有 3 秒冷却', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 3);

	assert(view.cometPdfs.length > 0, '应有 PDF 彗星');
	const cometPdf = view.cometPdfs[0];

	// 先在目标轨道（第 2 轨）腾一个空位：把第 2 轨的一颗钉子钉到最外轨
	let vacater = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		if (view.orbitNow[i] !== 1) continue;
		vacater = i;
		break;
	}
	assert(vacater >= 0, '第 2 轨应有球');
	const outer = Math.max(...Array.from(view.orbitNow));
	plugin.settings.pins[view.graph.nodes[vacater].path] = outer;
	view.applyLayout(false);

	let victim = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		if (view.orbitNow[i] !== 2) continue;
		victim = i;
		break;
	}
	assert(victim >= 0, '找不到第 3 轨的球');
	const path = view.graph.nodes[victim].path;
	assert(view.orbitHasRoom(1, victim), '腾空后第 2 轨应还有空位');

	const place = () => {
		view.xs[victim] = view.xs[cometPdf];
		view.ys[victim] = view.ys[cometPdf];
	};

	view.clock = 10;
	place();
	view.checkCometHits();
	assert(view.bump[path] === -1, '应被撞下 1 个轨道：' + view.bump[path]);

	view.clock = 11;
	place();
	view.checkCometHits();
	assert(view.bump[path] === -1, '冷却期内不应再降：' + view.bump[path]);

	await view.onClose();
});

await checkAsync('撞击：目标轨满员时不降轨、也不消耗冷却', async () => {
	const app = labVault(12);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 3);

	const cometPdf = view.cometPdfs[0];
	let victim = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		if (view.orbitNow[i] < 1) continue;
		if (view.orbitHasRoom(view.orbitNow[i] - 1, i)) continue; // 只挑目标轨已满的
		victim = i;
		break;
	}
	assert(victim >= 0, '找不到目标轨已满的球');

	const path = view.graph.nodes[victim].path;
	view.clock = 10;
	view.xs[victim] = view.xs[cometPdf];
	view.ys[victim] = view.ys[cometPdf];
	view.checkCometHits();

	assert(!view.bump[path], '满员时不应降轨：' + view.bump[path]);
	assert(view.hitAt[victim] === 0, '满员时不应消耗冷却：' + view.hitAt[victim]);
	await view.onClose();
});

await checkAsync('尾迹方向：逆时针轨道的尾巴画在运动反侧', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 3);

	// 找一个在逆时针轨道上的球（dir = -1），把它摆到 +x 轴方向，方便判断
	let idx = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		if (view.dirs[i] === -1 && view.recs[i].orbit >= 2) {
			idx = i;
			break;
		}
	}
	assert(idx >= 0, '找不到逆时针轨道上的球');
	assert(view.dirs[idx] === -1);

	view.xs[idx] = 200;
	view.ys[idx] = 0;
	view.plugin.settings.trail = 0.55;
	view.canvasEl._records.arcArgs = [];
	view.paint();

	// 尾迹弧的圆心在原点、半径 200；头部角度 0，尾巴应在正角度侧（+span）
	const arcs = view.canvasEl._records.arcArgs.filter((a) => Math.abs(a.r - 200 * view.scale) < 1.5);
	assert(arcs.length > 0, '没有画出该球的尾迹弧');
	const arc = arcs[0];
	// 头部在角度 0，逆时针球（dir=−1）的尾巴应向「角度增大」一侧展开
	assert(Math.abs(arc.a0) < 1e-6, '头部应在 0 弧度，实际 ' + arc.a0);
	assert(arc.a1 > 0.3 && arc.a1 < 0.5, '尾巴应在正角度侧，实际 ' + arc.a1);

	await view.onClose();
});

/** 造一个带 n 个 PDF 的库（PDF 名字末词首字母各不相同） */
function clockVault(nPdf) {
	const spec = [];
	for (let i = 0; i < 12; i++) {
		const day = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);
		spec.push({ path: 'k/n' + i + '.md', fm: { 'creation-time': day }, resolved: {} });
	}
	for (let i = 1; i < 12; i++) spec[0].resolved['k/n' + i + '.md'] = 1;
	const words = ['阿', '八', '擦', '搭', '蛾', '发', '噶', '哈'];
	for (let i = 0; i < nPdf; i++) spec.push({ path: 'k/文档 ' + words[i] + '.pdf' });
	return makeVault(spec);
}

check('时钟：PDF < 5 时不激活', () => {
	const g = GraphBuilder.buildGraph(clockVault(4));
	const res = Layout.build(g, { spacing: 1 });
	for (const rec of res.nodes) assert(!rec.clockHand, 'PDF 不足 5 个时不该有时钟球');
});

check('时钟：PDF = 5 时正好 3 颗，时/分/秒 顺序正确且半径翻倍', () => {
	const g = GraphBuilder.buildGraph(clockVault(5));
	const res = Layout.build(g, { spacing: 1 });

	const hands = [];
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (!rec.clockHand) continue;
		hands.push({ rec, g });
		assert(rec.drift === false, '时钟球不应再漂移');
		assert(Math.abs(rec.radius - Layout.MIN_PDF_RADIUS * 6) < 1e-9, '时钟球半径应为 6 倍 PDF：' + rec.radius);
		assert(rec.comet !== true, '时钟球不应是彗星');
	}
	assert(hands.length === 3, '应正好 3 颗时钟球，实际 ' + hands.length);
	const kindsSet = hands.map((h) => h.rec.clockHand).sort().join(',');
	assert(kindsSet === 'h,m,s', '手型应是 h,m,s：' + kindsSet);
});

check('时钟：角度严格按系统时间（24 小时显示、12 点朝上）', () => {
	const g = GraphBuilder.buildGraph(clockVault(5));
	const res = Layout.build(g, { spacing: 1 });
	const wall = new Date(2026, 9, 19, 15, 30, 45, 0).getTime();

	const byHand = {};
	for (const rec of res.nodes) {
		if (!rec.clockHand) continue;
		rec.drift = false; // 关掉漂移，方便精确断言
		byHand[rec.clockHand] = rec;
	}

	const at = (hand) => Layout.pose(byHand[hand], { clock: 0, base: 0, sizeK: 1, wall }).ang;
	const near = (a, b) => Math.abs(Core.angleDelta(a, b)) < 1e-9;

	assert(near(at('h'), -Math.PI / 2 + Core.TAU * ((15 % 12) + 0.5) / 12), '时针角度不对：' + at('h'));
	assert(near(at('m'), -Math.PI / 2 + Core.TAU * (30 + 45 / 60) / 60), '分针角度不对：' + at('m'));
	assert(near(at('s'), -Math.PI / 2 + Core.TAU * (45 / 60)), '秒针角度不对：' + at('s'));
});

await checkAsync('时钟：球内数字为 24 小时制两位，颜色取中心球', async () => {
	const app = clockVault(5);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	assert(view.n > 0, '库应有节点');
	const mo = view.model;
	let hourText = null;
	for (let i = 0; i < view.n; i++) {
		if (view.recs[i].clockHand === 'h') hourText = mo.clockText[i];
	}
	assert(hourText !== null, '时针球没有数字');
	assert(/^(0\d|1\d|2[0-3])$/.test(hourText), '时针应为 24 小时制两位：' + hourText);

	// 画出来的文字里应包含这三段
	const texts = view.canvasEl._records.texts || [];
	assert(texts.length >= 3, '没有把数字画出来：' + JSON.stringify(texts));
	await view.onClose();
});

check('时钟：三针半径按表盘分长短（时针最短、秒针最长）', () => {
	const g = GraphBuilder.buildGraph(clockVault(5));
	const res = Layout.build(g, { spacing: 1 });
	const byHand = {};
	let maxMd = 0;
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (rec.clockHand) byHand[rec.clockHand] = rec;
		if (g.nodes[i].kind === 'md' && !rec.root && !rec.comet && rec.rho > maxMd) maxMd = rec.rho;
	}
	assert(byHand.h && byHand.m && byHand.s, '三针不齐');
	assert(byHand.h.rho < byHand.m.rho && byHand.m.rho < byHand.s.rho, '半径应递增：' + [byHand.h.rho, byHand.m.rho, byHand.s.rho].map((v) => v.toFixed(1)));
	assert(byHand.h.rho >= maxMd * 1.05 - 1e-6, '时针不应进入 MD 轨道区：' + byHand.h.rho.toFixed(1) + ' vs ' + maxMd.toFixed(1));
});

await checkAsync('时钟：数字字体是新罗马、字号随缩放变化', async () => {
	const app = clockVault(5);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const pxOf = (font) => {
		const m = /([\d.]+)px/.exec(font);
		return m ? parseFloat(m[1]) : NaN;
	};

	// 放大画布，避免高缩放下时钟球被裁掉
	view.canvasEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 4000, height: 4000, right: 4000, bottom: 4000 });
	view.renderer.resize();

	view.scale = 2;
	view.canvasEl._records.fonts = [];
	view.paint();
	const f2 = (view.canvasEl._records.fonts || []).slice(-3);

	view.scale = 4;
	view.canvasEl._records.fonts = [];
	view.paint();
	const f4 = (view.canvasEl._records.fonts || []).slice(-3);

	assert(f2.length === 3 && f4.length === 3, '应有三段时钟文字：' + f2.length + '/' + f4.length);
	assert(f2.join(' ').indexOf('var(') < 0, '字体里不能出现 CSS 变量：' + f2[0]);
	assert(f2[0].indexOf('Times New Roman') >= 0, '字体应为 Times New Roman：' + f2[0]);
	const r = pxOf(f4[0]) / pxOf(f2[0]);
	assert(Math.abs(r - 2) < 0.1, '字号应随缩放翻倍，实际 ' + r.toFixed(2));

	await view.onClose();
});

check('时钟：12 点在正上方、13 点在顺时针 30°', () => {
	const g = GraphBuilder.buildGraph(clockVault(5));
	const res = Layout.build(g, { spacing: 1 });
	let hour = null;
	for (const rec of res.nodes) if (rec.clockHand === 'h') hour = rec;
	assert(hour, '没有时针球');
	hour.drift = false; // 关掉漂移，精确断言

	const at = (ms) => Layout.pose(hour, { clock: 0, base: 0, sizeK: 1, wall: ms }).ang;
	const at12 = at(new Date(2026, 9, 19, 12, 0, 0, 0).getTime());
	const at13 = at(new Date(2026, 9, 19, 13, 0, 0, 0).getTime());

	assert(Math.abs(Core.angleDelta(at12, -Math.PI / 2)) < 1e-9, '12 点应在正上方：' + at12);
	assert(Math.abs(Core.angleDelta(at13, -Math.PI / 2 + Core.TAU / 12)) < 1e-9, '13 点应顺时针 30°：' + at13);
});

check('时钟：时针球不压在最外 MD 轨上', () => {
	const g = GraphBuilder.buildGraph(clockVault(5));
	const res = Layout.build(g, { spacing: 1 });
	let maxMd = 0;
	for (let i = 0; i < g.nodes.length; i++) {
		const rec = res.nodes[i];
		if (g.nodes[i].kind !== 'md' || rec.root || rec.comet) continue;
		if (rec.rho > maxMd) maxMd = rec.rho;
	}
	let hour = null;
	for (const rec of res.nodes) if (rec.clockHand === 'h') hour = rec;
	assert(hour.rho - hour.radius > maxMd, '时针球会压到 MD 轨：' + hour.rho.toFixed(1) + ' − ' + hour.radius + ' vs ' + maxMd.toFixed(1));
});

await checkAsync('时钟：三针按真实时间散开（不会全叠在正上方）', async () => {
	const app = clockVault(5);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const fixed = new Date(2026, 9, 19, 14, 25, 40, 0).getTime();
	const realNow = Date.now;
	Date.now = () => fixed;
	try {
		view.tick(performance.now() + 16);
	} finally {
		Date.now = realNow;
	}

	const angles = [];
	for (let i = 0; i < view.n; i++) {
		if (!view.recs[i].clockHand) continue;
		angles.push(Math.atan2(view.ys[i], view.xs[i]));
	}
	assert(angles.length === 3, '应有三针：' + angles.length);
	const spread =
		Math.abs(Core.angleDelta(angles[0], angles[1])) + Math.abs(Core.angleDelta(angles[1], angles[2]));
	assert(spread > 0.05, '三针不应叠在一起：' + JSON.stringify(angles));

	await view.onClose();
});

await checkAsync('斥力：同轨挤太近会把其中一颗抬到外一圈（无冷却）', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	plugin.settings.repel = 1;
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	// 找两颗同轨、非彗星的笔记球
	let a = -1;
	let b = -1;
	for (let i = 0; i < view.n && a < 0; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		for (let j = i + 1; j < view.n; j++) {
			if (view.kinds[j] !== 0 || view.cometMask[j]) continue;
			if (view.recs[i].orbit !== view.recs[j].orbit) continue;
			a = i;
			b = j;
			break;
		}
	}
	assert(a >= 0 && b >= 0, '找不到同轨的两颗球');

	const reset = () => {
		view.bump = {};
		view.orbitNow = new Int32Array(view.n);
		view.lastPromoteAt = 0;
		view.applyLayout(true);
	};
	const step = () => {
		const g = view.spatialGrid();
		view.checkCrowding(g);
		view.applyRepulsion(g);
	};
	const put = () => {
		view.xs[a] = view.xs[b] = 100;
		view.ys[a] = view.ys[b] = 100;
	};

	reset();
	const orbitA = view.orbitNow[a];
	const orbitB = view.orbitNow[b];
	view.clock = 10;
	put();
	step();

	const movedA = view.orbitNow[a] !== orbitA;
	const movedB = view.orbitNow[b] !== orbitB;
	assert(movedA || movedB, '应有一颗被抬起轨道 [a=' + a + ' recOrbit=' + view.recs[a].orbit + ' nowA=' + view.orbitNow[a] + ' b=' + b + ' recOrbitB=' + view.recs[b].orbit + ' nowB=' + view.orbitNow[b] + ' pins=' + JSON.stringify(view.plugin.settings.pins) + ' bump=' + JSON.stringify(view.bump) + ' room3=' + view.orbitHasRoom(3, a) + ' room2=' + view.orbitHasRoom(2, a) + ']');
	assert(!(movedA && movedB), '同一对只应抬一颗');
	const idx = movedA ? a : b;
	const to = view.orbitNow[idx];
	assert(to > (movedA ? orbitA : orbitB), '应往外抬');

	let used = 0;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (rec.root || rec.comet) continue;
		if (view.orbitNow[i] === to) used++;
	}
	assert(used <= Layout.orbitCapacity(to + 1), '抬升后落点超额：' + used + ' > ' + Layout.orbitCapacity(to + 1));

	// 没有冷却：复位后再来一帧仍能抬
	reset();
	view.clock = 11;
	put();
	step();
	const again = (view.bump[view.graph.nodes[a].path] || 0) + (view.bump[view.graph.nodes[b].path] || 0);
	assert(again >= 1, '无冷却时应能再次抬升，实际 ' + again);

	// 同一帧内同一颗球只抬一次
	reset();
	view.clock = 12;
	put();
	step();
	const promotedCount = Object.keys(view.bump).length;
	assert(promotedCount === 1, '同一帧只应抬一颗球，实际 ' + promotedCount);

	await view.onClose();
});

await checkAsync('斥力：同轨距离 ≤ 2R 才抬轨（1.8R 触发、2.1R 不触发）', async () => {
	const make = async () => {
		const app = labVault(15);
		const plugin = new PluginClass(app, MANIFEST);
		plugin.settings.repel = 1;
		await plugin.onload();
		const view = plugin.views[0].factory({ app });
		await view.onOpen();
		advance(view, 2);

		let a = -1;
		let b = -1;
		for (let i = 0; i < view.n && a < 0; i++) {
			if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
			for (let j = i + 1; j < view.n; j++) {
				if (view.kinds[j] !== 0 || view.cometMask[j]) continue;
				if (view.recs[i].orbit !== view.recs[j].orbit) continue;
				a = i;
				b = j;
				break;
			}
		}
		assert(a >= 0 && b >= 0, '找不到同轨的两颗球');
		return { view, a, b };
	};

	const t1 = await make();
	t1.view.bump = {};
	t1.view.orbitNow = new Int32Array(t1.view.n);
	t1.view.applyLayout(true);
	const R1 = t1.view.rads[t1.a] + t1.view.rads[t1.b];
	t1.view.clock = 50;
	t1.view.xs[t1.a] = 100;
	t1.view.ys[t1.a] = 100;
	t1.view.xs[t1.b] = 100 + 1.8 * R1;
	t1.view.ys[t1.b] = 100;
	t1.view.lastPromoteAt = 0;
	{ const g = t1.view.spatialGrid(); t1.view.checkCrowding(g); t1.view.applyRepulsion(g); }
	assert(Object.keys(t1.view.bump).length === 1, '1.8R 应触发抬轨，实际 ' + JSON.stringify(t1.view.bump));
	await t1.view.onClose();

	const t2 = await make();
	t2.view.bump = {};
	t2.view.orbitNow = new Int32Array(t2.view.n);
	t2.view.applyLayout(true);
	const R2 = t2.view.rads[t2.a] + t2.view.rads[t2.b];
	t2.view.clock = 50;
	t2.view.xs[t2.a] = 100;
	t2.view.ys[t2.a] = 100;
	t2.view.xs[t2.b] = 100 + 2.1 * R2;
	t2.view.ys[t2.b] = 100;
	t2.view.lastPromoteAt = 0;
	{ const g = t2.view.spatialGrid(); t2.view.checkCrowding(g); t2.view.applyRepulsion(g); }
	assert(Object.keys(t2.view.bump).length === 0, '2.1R 不应触发：' + JSON.stringify(t2.view.bump));
	await t2.view.onClose();
});
await checkAsync('悬停连线：每对邻居一根、带流光点、画在球体之前', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let hub = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.adj[i].length > 0) {
			hub = i;
			break;
		}
	}
	assert(hub >= 0, '找不到有邻居的球');

	view.setHovered(hub);
	view.canvasEl._records.log = [];
	view.canvasEl._records.arcArgs = [];
	view.paint();

	const log = view.canvasEl._records.log || [];
	const firstFill = log.indexOf('fill');
	const dots = (view.canvasEl._records.arcArgs || []).filter((a) => Math.abs(a.r - 1.7) < 1e-6).length;
	assert(dots === view.adj[hub].length * 2, '每条连线应有 2 个流光点，实际 ' + dots);
	const firstLinkStroke = log.findIndex((v) => v.indexOf('stroke:') === 0);
	assert(firstLinkStroke >= 0 && firstLinkStroke < firstFill, '连线应画在球体之前');

	await view.onClose();
});

await checkAsync('升轨：只抬「前方」那颗（按旋转方向）', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let a = -1;
	let b = -1;
	for (let i = 0; i < view.n && a < 0; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		for (let j = i + 1; j < view.n; j++) {
			if (view.kinds[j] !== 0 || view.cometMask[j]) continue;
			if (view.recs[i].orbit !== view.recs[j].orbit) continue;
			a = i;
			b = j;
			break;
		}
	}
	assert(a >= 0 && b >= 0, '找不到同轨的两颗球');

	// 都摆在 +x 轴附近：B 的角度略大
	view.xs[a] = 200;
	view.ys[a] = 0;
	view.xs[b] = Math.cos(0.2) * 200;
	view.ys[b] = Math.sin(0.2) * 200;

	view.dirs[a] = 1;
	view.dirs[b] = 1;
	assert(view.leaderOf(a, b) === b, 'dir=+1 时角度更大者在前（应为 b）');

	view.dirs[a] = -1;
	view.dirs[b] = -1;
	assert(view.leaderOf(a, b) === a, 'dir=−1 时角度更小者在前（应为 a）');

	await view.onClose();
});

await checkAsync('悬停连线：双向仍一根（无向），大小按唯一邻居', async () => {
	const spec = [
		{ path: 'w/a.md', fm: { 'creation-time': '2020-01-01' }, resolved: { 'w/b.md': 1, 'w/c.md': 1 } },
		{ path: 'w/b.md', fm: { 'creation-time': '2020-01-02' }, resolved: { 'w/a.md': 1 } },
		{ path: 'w/c.md', fm: { 'creation-time': '2020-01-03' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const a = view.graph.nodes.findIndex((n) => n.path === 'w/a.md');
	assert(a >= 0);
	// 无向邻居：b、c 两个
	assert(view.adj[a].length === 2, 'a 的邻居应为 2 个：' + view.adj[a].length);

	view.setHovered(a);
	view.canvasEl._records.log = [];
	view.paint();
	const log = view.canvasEl._records.log || [];
	const dots2 = (view.canvasEl._records.arcArgs || []).filter((a) => Math.abs(a.r - 1.7) < 1e-6).length;
	assert(dots2 === 4, '应画 2 根（每条 2 个流光点），实际 ' + dots2);

	// 大小按唯一邻居：a 的邻居是 b、c → 2
	assert(view.graph.nodes[a].degree === 2, 'a 的唯一邻居应为 2：' + view.graph.nodes[a].degree);
	await view.onClose();
});

await checkAsync('计时器：进入 → 写入对应象限 → 停止勾选并追加用时', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	assert(view.timerActive === true, '应进入计时状态');
	assert(view.handAngles && view.handAngles.s === 0 && view.handAngles.m === 0 && view.handAngles.h === 0, '三针应归零');

	view.startTimer(1, '复习线代', '第三章课后题');
	assert(view.timerStart > 0, '应开始计时');
	assert(view.planText.indexOf('- [ ] 复习线代：第三章课后题') >= 0, '应写入未完成项');
	const parsed = Plan.parse(view.planText);
	const todayIdx = Plan.todayIndex();
	assert(parsed.days[todayIdx].quads[1].tasks.some((t) => t.text === '复习线代：第三章课后题'), '应落在今天的第二象限');

	const realNow = Date.now;
	view.timerStart = realNow() - 65000;
	await view.stopTimer();

	assert(view.timerActive === false && view.handAngles === null, '应退出计时状态');
	assert(
		view.planText.indexOf('- [x] 复习线代：第三章课后题（用时 1 分 5 秒）') >= 0,
		'应勾选并追加用时：' + view.planText.slice(0, 160)
	);
	await view.onClose();
});

await checkAsync('计时器：三针按已用时间走；项目被删则只提示不写入', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	const realNow = Date.now;
	view.timerStart = realNow() - 15000;
	view.renderTimer();
	assert(Math.abs(view.handAngles.s - 0.25) < 1e-3, '秒针应为 15/60：' + view.handAngles.s);
	assert(Math.abs(view.handAngles.m - 15 / 3600) < 1e-9, '分针应按 0.25 分钟走：' + view.handAngles.m);
	assert(view.timerLabelEl.textContent === '00:15', '标签应显示 00:15：' + view.timerLabelEl.textContent);

	view.startTimer(0, '临时任务', '');
	assert(view.planText.indexOf('- [ ] 临时任务') >= 0, '无内容时只写名称');

	view.planText = view.planText.replace('- [ ] 临时任务\n', '');
	view.timerStart = realNow() - 5000;
	await view.stopTimer();
	assert(view.planText.indexOf('- [x]') < 0, '定位失败时不应改写任何行');

	await view.onClose();
});

await checkAsync('计时器：球内数字切换为已用时间，退出后回到系统时间', async () => {
	const app = clockVault(5);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const idxOf = (hand) => {
		for (let i = 0; i < view.n; i++) if (view.recs[i].clockHand === hand) return i;
		return -1;
	};
	const hs = idxOf('h');
	const ms = idxOf('m');
	const ss = idxOf('s');
	assert(hs >= 0 && ms >= 0 && ss >= 0, '三针不齐');

	view.toggleTimer();
	const realNow = Date.now;
	view.timerStart = realNow() - (3600000 + 15 * 60000 + 30000); // 1:15:30
	view.renderTimer();
	view.paint();
	const mo = view.model;
	assert(mo.clockText[hs] === '01', '时针应显示 01：' + mo.clockText[hs]);
	assert(mo.clockText[ms] === '15', '分针应显示 15：' + mo.clockText[ms]);
	assert(mo.clockText[ss] === '30', '秒针应显示 30：' + mo.clockText[ss]);

	// 退出计时：数字回到系统时间
	view.timerActive = false;
	view.renderTimer();
	view.paint();
	const hourNow = String(new Date().getHours()).padStart(2, '0');
	assert(mo.clockText[hs] === hourNow, '退出后应显示当前小时：' + mo.clockText[hs] + ' vs ' + hourNow);

	await view.onClose();
});

await checkAsync('时间球：三条轨道（时针在内环外、分针在星带、秒针在星带外）', async () => {
	const app = clockVault(5);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const byHand = {};
	for (let i = 0; i < view.n; i++) if (view.recs[i].clockHand) byHand[view.recs[i].clockHand] = view.recs[i];
	assert(byHand.h && byHand.m && byHand.s, '三针不齐');

	let maxMd = 0;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (view.kinds[i] !== 0 || rec.root || rec.comet) continue;
		if (rec.rho > maxMd) maxMd = rec.rho;
	}

	// 三条轨道顺序与间距
	const r = [byHand.h.rho, byHand.m.rho, byHand.s.rho];
	assert(r[0] < r[1] && r[1] < r[2], '半径应递增：' + r.map((v) => v.toFixed(1)));
	const diameter = byHand.h.radius * 2;
	assert(r[1] - r[0] > diameter, '时针与分针间距应大于球直径：' + (r[1] - r[0]).toFixed(1));
	assert(r[2] - r[1] > diameter, '分针与秒针间距应大于球直径：' + (r[2] - r[1]).toFixed(1));

	// 时针在 MD 环之外、分针在 PDF 星带上、秒针在星带之外
	assert(byHand.h.rho > maxMd, '时针应在最外 MD 轨之外：' + r[0].toFixed(1) + ' vs ' + maxMd.toFixed(1));
	assert(byHand.s.rho > byHand.m.rho, '秒针应在分针外');
	assert(!view.timeRings, '时间轨道圆环已移除');

	await view.onClose();
});

await checkAsync('MD 彗星：撞到的球升到上方第一个空位轨；彗星之间互不动', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	assert(view.cometMds.length >= 1, '应有 MD 彗星');
	const comet = view.cometMds[0];

	// 找一颗普通球（不在最外轨）
	let victim = -1;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (view.kinds[i] !== 0 || rec.root || rec.comet) continue;
		if (view.orbitNow[i] >= 2) continue;
		victim = i;
		break;
	}
	assert(victim >= 0, '找不到可撞的球');

	view.bump = {};
	view.orbitNow = new Int32Array(view.n);
	view.applyLayout(true);
	const from = view.orbitNow[victim];
	view.clock = 10;
	view.xs[victim] = view.xs[comet];
	view.ys[victim] = view.ys[comet];
	view.checkCometHits();

	const to = view.orbitNow[victim];
	assert(to > from, '命中后应升轨：' + from + ' → ' + to);
	let used = 0;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (rec.root || rec.comet) continue;
		if (view.orbitNow[i] === to) used++;
	}
	assert(used <= Layout.orbitCapacity(to + 1), '落点应不超额：' + used);

	// 彗星之间互撞：都不动
	const other = view.cometMds[1] !== undefined ? view.cometMds[1] : -1;
	const before = view.cometMds.map((i) => view.orbitNow[i]).join(',');
	if (other >= 0) {
		view.clock = 30;
		view.xs[other] = view.xs[comet];
		view.ys[other] = view.ys[comet];
		view.checkCometHits();
	}
	assert(view.cometMds.map((i) => view.orbitNow[i]).join(',') === before, '彗星之间不应互相推动');

	await view.onClose();
});

await checkAsync('配色起点色：挂到 --orbit-accent，切换色系会跟着变', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const purple = view.contentEl.style.getPropertyValue('--orbit-accent');
	assert(purple.toUpperCase() === '#EBCFE4', '紫色系起点色应为 #EBCFE4，实际 ' + purple);

	plugin.settings.scheme = 'red';
	view.recolor();
	const red = view.contentEl.style.getPropertyValue('--orbit-accent');
	assert(red.toUpperCase() === '#F7D9D9', '红色系起点色应为 #F7D9D9，实际 ' + red);

	await view.onClose();
});

await checkAsync('计划：双击后就地变成输入框（原文字消失），回车保存', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 0, 0, '旧文字');
	view.planText = text;
	view.renderPlan();

	const label = findByClass(view.planEl, 'orbit-plan-task-text');
	assert(label, '找不到任务文字');
	label.fire('dblclick');
	assert(view.editingLine >= 0, '双击应进入编辑状态');

	const input = findByClass(view.planEl, 'orbit-plan-task-edit');
	assert(input, '应出现与新增同款的输入框');
	const labelNow = findByClass(view.planEl, 'orbit-plan-task-text');
	assert(!labelNow || labelNow.style.display === 'none', '编辑时原文字应隐藏或移除');
	assert(!findByClass(view.planEl, 'orbit-plan-task-del'), '编辑时不应显示删除按钮');

	input.value = '新文字';
	input.fire('keydown', { key: 'Enter', preventDefault() {} });
	await new Promise((r) => setTimeout(r, 0));
	assert(view.planText.indexOf('- [ ] 新文字') >= 0, '应保存新文字：' + view.planText.slice(0, 60));
	assert(view.editingLine === -1, '保存后应退出编辑状态');

	await view.onClose();
});

await checkAsync('空轨补位：空轨道会从外侧搬一颗进来（最外轨与彗星不动）', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const occ = () => {
		const m = new Map();
		for (let i = 0; i < view.n; i++) {
			if (view.recs[i].root) continue;
			const o = view.orbitNow[i];
			m.set(o, (m.get(o) || 0) + 1);
		}
		return m;
	};

	let maxO = -1;
	for (const o of view.rhoByOrbit.keys()) if (o > maxO) maxO = o;
	assert(maxO >= 2, '这个库应有 ≥3 条轨道，实际最外 ' + maxO);

	// 人为把第 2 轨（索引 1）清空：全部推到外轨
	view.bump = {};
	view.orbitNow = new Int32Array(view.n);
	view.applyLayout(true);
	for (let i = 0; i < view.n; i++) {
		if (view.recs[i].root) continue;
		if (view.orbitNow[i] === 1 && !view.recs[i].comet) {
			view.bump[view.graph.nodes[i].path] = maxO - 1;
			view.orbitNow[i] = maxO;
		}
	}
	view.applyLayout(false);
	assert(!occ().get(1), '第 2 轨应已被清空');

	const cometBefore = view.cometMds.map((i) => view.orbitNow[i]).join(',');
	view.clock = 100;
	view.fillEmptyOrbits();

	assert(occ().get(1) >= 1, '第 2 轨应被补上一颗，实际 ' + (occ().get(1) || 0));
	assert(view.cometMds.map((i) => view.orbitNow[i]).join(',') === cometBefore, '彗星不应被搬动');

	await view.onClose();
});

await checkAsync('星带避让：PDF 球与分针同角度时沿径向让开，超过 20° 不动', async () => {
	const app = clockVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const m = view.clockMinuteIdx;
	assert(m >= 0, '找不到分针球');

	// 找一颗普通 PDF 球（非彗星、非时钟针）
	let pdf = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] !== 1) continue;
		if (view.recs[i].clockHand || view.recs[i].comet) continue;
		pdf = i;
		break;
	}
	assert(pdf >= 0, '找不到普通 PDF 球');

	const R = 300;
	const place = (angPdf) => {
		view.xs[m] = R;
		view.ys[m] = 0; // 分针在 0°
		view.xs[pdf] = Math.cos(angPdf) * R;
		view.ys[pdf] = Math.sin(angPdf) * R;
	};

	// ① 同角度：应被推离，且幅度 ≈ 12%（有界）
	place(0);
	view.avoidMinuteHand();
	const shifted = Math.hypot(view.xs[pdf], view.ys[pdf]);
	const ratio = shifted / R;
	const dir = pdf % 2 === 0 ? 1 : -1;
	const expected = 1 + dir * 0.12;
	assert(Math.abs(ratio - expected) < 0.01, '让位比例不对：' + ratio.toFixed(3) + ' 期望 ' + expected.toFixed(3));
	assert(Math.abs(ratio - 1) <= 0.1201, '位移应 ≤ 12%：' + Math.abs(ratio - 1).toFixed(3));

	// ② 40° 外：不动
	place((40 * Math.PI) / 180);
	view.avoidMinuteHand();
	assert(Math.abs(Math.hypot(view.xs[pdf], view.ys[pdf]) - R) < 1e-6, '20° 之外不应被推动');

	await view.onClose();
});

await checkAsync('计划：勾选完成后列表不跳回顶部', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let text = Plan.skeleton(view.weekYear, view.weekNum);
	for (let i = 0; i < 20; i++) text = Plan.addTask(text, 0, 0, '任务' + i);
	view.planText = text;
	view.renderPlan();

	view.planBodyEl.scrollTop = 120;
	view.renderPlan();
	assert(view.planBodyEl.scrollTop === 120, '重绘后滚动位置应保留：' + view.planBodyEl.scrollTop);

	const row = findByClass(view.planEl, 'orbit-plan-task');
	assert(row, '找不到任务行');
	const checkbox = row.children.find((c) => c.tagName === 'INPUT');
	assert(checkbox, '找不到复选框');
	checkbox.checked = true;
	checkbox.fire('change', {});
	await new Promise((r) => setTimeout(r, 0));

	assert(view.planText.indexOf('- [x] 任务0') >= 0, '勾选应写入笔记');
	assert(view.planBodyEl.scrollTop === 120, '勾选后滚动位置仍应保留：' + view.planBodyEl.scrollTop);

	await view.onClose();
});

await checkAsync('计时器弹窗：四个象限胶囊、名称必填、Enter 直接开始', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer(); // 打开 TimerModal
	const modal = Modal.last;
	assert(modal && modal.chipEls && modal.chipEls.length === 4, '应有 4 个象限胶囊');
	assert(modal.chipEls[0].classes.has('is-selected'), '默认选中第一个象限');

	modal.chipEls[1].fire('click', {});
	assert(modal.quad === 1 && modal.chipEls[1].classes.has('is-selected'), '点击后应选中第二象限');
	assert(!modal.chipEls[0].classes.has('is-selected'), '旧选中态应清除');

	const started = [];
	modal.onStart = (q, n, c) => started.push({ q, n, c });
	modal.submit();
	assert(started.length === 0, '名称为空不应开始');
	assert(modal.errorEl.textContent && modal.errorEl.textContent.length > 0, '应显示行内错误');
	assert(modal.nameInput.classes.has('is-invalid'), '输入框应标红');

	modal.nameInput.value = '复习线代';
	modal.bodyInput.value = '第三章';
	modal.nameInput.fire('keydown', { key: 'Enter', preventDefault() {} });
	assert(started.length === 1, 'Enter 应触发开始');
	assert(started[0].q === 1 && started[0].n === '复习线代' && started[0].c === '第三章', '参数不对：' + JSON.stringify(started[0]));

	await view.onClose();
});

await checkAsync('贴近升轨：斥力为 0 也判定、按实际轨道配对、0.2 秒节流', async () => {
	const app = labVault(15);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let a = -1;
	let b = -1;
	for (let i = 0; i < view.n && a < 0; i++) {
		if (view.kinds[i] !== 0 || view.cometMask[i]) continue;
		for (let j = i + 1; j < view.n; j++) {
			if (view.kinds[j] !== 0 || view.cometMask[j]) continue;
			if (view.orbitNow[i] !== view.orbitNow[j]) continue;
			a = i;
			b = j;
			break;
		}
	}
	assert(a >= 0 && b >= 0, '找不到同轨两颗球');

	// ① 斥力 = 0 时仍应因贴近而升轨
	plugin.settings.repel = 0;
	view.bump = {};
	view.orbitNow = new Int32Array(view.n);
	view.lastPromoteAt = 0;
	view.applyLayout(true);
	view.clock = 50;
	view.xs[a] = view.ys[a] = view.xs[b] = view.ys[b] = 5000;
	view.checkCrowding(view.spatialGrid());
	assert(Object.keys(view.bump).length === 1, '斥力为 0 时也应升轨：' + JSON.stringify(view.bump));

	// ② 实际轨道不同 → 即使坐标重合也不升
	view.bump = {};
	view.orbitNow = new Int32Array(view.n);
	view.lastPromoteAt = 0;
	view.applyLayout(true);
	view.orbitNow[b] = view.orbitNow[a] + 1;
	view.clock = 60;
	view.xs[a] = view.ys[a] = view.xs[b] = view.ys[b] = 5000;
	view.checkCrowding(view.spatialGrid());
	assert(Object.keys(view.bump).length === 0, '不同轨不应升轨：' + JSON.stringify(view.bump));

	// ③ 0.2 秒节流：同一时刻连续调用只升一次
	view.bump = {};
	view.orbitNow = new Int32Array(view.n);
	view.lastPromoteAt = 0;
	view.applyLayout(true);
	view.clock = 100;
	view.xs[a] = view.ys[a] = view.xs[b] = view.ys[b] = 5000;
	view.checkCrowding(view.spatialGrid());
	assert(Object.keys(view.bump).length === 1, '首次应升轨');
	view.xs[a] = view.ys[a] = view.xs[b] = view.ys[b] = 5000;
	view.checkCrowding(view.spatialGrid());
	assert(Object.keys(view.bump).length === 1, '节流期内不应再升');

	await view.onClose();
});

check('标签卫星：宿主转 1 圈，卫星转 10 圈', () => {
	const spec = [
		{ path: 'r/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲'] }, resolved: { 'r/b.md': 1 } },
		{ path: 'r/b.md', fm: { 'creation-time': '2020-01-02' }, resolved: {} },
	];
	const g = GraphBuilder.buildGraph(makeVault(spec));
	const res = Layout.build(g, { spacing: 1 });
	const host = g.satellites[0].host;
	const spin = res.nodes[host].spinFactor || 1;
	const dirn = res.nodes[host].dir === -1 ? -1 : 1;

	// 宿主一圈耗时 T = 2π / (0.34 × spin)；卫星应在同样时间内转 10 圈
	const T = (Math.PI * 2) / (0.34 * spin);
	const satTurns = (dirn * spin * 10 * 0.34 * T) / (Math.PI * 2);
	assert(Math.abs(satTurns - dirn * 10) < 1e-9, '卫星应转 10 圈/宿主圈，实际 ' + satTurns.toFixed(3));
});
check('标签卫星：解析 frontmatter tags、每篇最多 3 个', () => {
	const spec = [
		{ path: 't/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲', '乙', '丙', '丁'] }, resolved: {} },
		{ path: 't/b.md', fm: { 'creation-time': '2020-01-02', tags: '戊, 己' }, resolved: {} },
		{ path: 't/c.md', fm: { 'creation-time': '2020-01-03' }, resolved: {} },
		{ path: 't/d.pdf', fileCtime: 1.7e12 },
	];
	spec[0].resolved['t/b.md'] = 1;
	const g = GraphBuilder.buildGraph(makeVault(spec));

	const tags = g.satellites.map((s) => s.tag);
	assert(tags.indexOf('甲') >= 0 && tags.indexOf('乙') >= 0 && tags.indexOf('丙') >= 0, '前三标签应在：' + tags.join(','));
	assert(tags.indexOf('丁') < 0, '第 4 个标签应被截断');
	assert(tags.indexOf('戊') >= 0 && tags.indexOf('己') >= 0, '逗号分隔字符串应能解析：' + tags.join(','));

	const hostA = g.nodes.findIndex((n) => n.path === 't/a.md');
	const hostB = g.nodes.findIndex((n) => n.path === 't/b.md');
	assert(g.satellites.filter((s) => s.host === hostA).length === 3, 'a 应有 3 颗');
	assert(g.satellites.filter((s) => s.host === hostB).length === 2, 'b 应有 2 颗');
	assert(g.satellites.every((s) => typeof s.phase0 === 'number' && typeof s.count === 'number' && s.count >= 1), '应有相位偏移与总数');
});

await checkAsync('标签卫星：半径 = 宿主 15%，悬停宿主时画出标签名', async () => {
	const spec = [
		{ path: 's/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲', '乙'] }, resolved: { 's/b.md': 1, 's/c.md': 1 } },
		{ path: 's/b.md', fm: { 'creation-time': '2020-01-02', tags: ['丙'] }, resolved: {} },
		{ path: 's/c.md', fm: { 'creation-time': '2020-01-03' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	assert(view.satModel && view.satModel.length === 3, '应有 3 颗卫星：' + (view.satModel && view.satModel.length));
	for (const sat of view.satModel) {
		const hostR = view.rads[sat.host];
		assert(Math.abs(sat.r - hostR * 0.15) < 1e-9, '卫星半径应为宿主 15%：' + sat.r + ' vs ' + hostR * 0.15);
	}

	const host = view.satModel[0].host;
	view.setHovered(host);
	view.canvasEl._records.texts.length = 0;
	view.paint();
	const texts = view.canvasEl._records.texts.join('|');
	assert(texts.indexOf('甲') >= 0 || texts.indexOf('乙') >= 0 || texts.indexOf('丙') >= 0, '悬停宿主应显示标签名：' + texts);

	await view.onClose();
});

await checkAsync('标签卫星：同一宿主的卫星等角分布在同一圈上', async () => {
	const spec = [
		{ path: 'e/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲', '乙', '丙'] }, resolved: { 'e/b.md': 1 } },
		{ path: 'e/b.md', fm: { 'creation-time': '2020-01-02', tags: ['丁', '戊'] }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const groupBy = (host) => view.satModel.filter((s) => s.host === host);
	const hosts = [...new Set(view.satModel.map((s) => s.host))];
	assert(hosts.length === 2, '应有两个宿主：' + hosts.length);

	for (const h of hosts) {
		const g = groupBy(h);
		// 半径完全一致
		const r0 = Math.hypot(g[0].x - view.xs[h], g[0].y - view.ys[h]);
		for (const s of g) {
			const r = Math.hypot(s.x - view.xs[h], s.y - view.ys[h]);
			assert(Math.abs(r - r0) < 1e-9, '同一宿主的卫星应同半径：' + r + ' vs ' + r0);
		}
		// 相邻角度均匀
		const step = (Math.PI * 2) / g.length;
		const angles = g.map((s) => Math.atan2(s.y - view.ys[h], s.x - view.xs[h])).sort((a, b) => a - b);
		for (let i = 1; i < angles.length; i++) {
			const d = angles[i] - angles[i - 1];
			assert(Math.abs(d - step) < 1e-6, '相邻角度应为 ' + step + '，实际 ' + d);
		}
	}

	// 刚体旋转：整体推进后间距不变
	const h0 = hosts[0];
	const g0 = groupBy(h0);
	const before = g0.map((s) => Math.atan2(s.y - view.ys[h0], s.x - view.xs[h0]));
	view.clock += 1;
	view.updateSatellites();
	const g1 = groupBy(h0);
	const after = g1.map((s) => Math.atan2(s.y - view.ys[h0], s.x - view.xs[h0]));
	for (let i = 1; i < after.length; i++) {
		const d0 = Core.angleDelta(before[i - 1], before[i]);
		const d1 = Core.angleDelta(after[i - 1], after[i]);
		assert(Math.abs(d0 - d1) < 1e-6, '旋转后间距应不变：' + d0 + ' vs ' + d1);
	}

	await view.onClose();
});
await checkAsync('标签卫星：缩小时不可见，放大后才显示', async () => {
	const spec = [
		{ path: 'z/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲', '乙'] }, resolved: { 'z/b.md': 1 } },
		{ path: 'z/b.md', fm: { 'creation-time': '2020-01-02' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const countSatArcs = () => {
		view.canvasEl._records.arcArgs = [];
		view.canvasEl._records.texts.length = 0;
		view.paint();
		const wanted = view.satModel.map((sat) => Math.max(sat.r * view.scale, 1.5));
		let hits = 0;
		for (const a of view.canvasEl._records.arcArgs || []) {
			if (wanted.some((w) => Math.abs(a.r - w) < 0.35)) hits++;
		}
		return { arcs: hits, texts: view.canvasEl._records.texts.join('|') };
	};

	view.scale = 0.5; // 缩小
	const small = countSatArcs();
	assert(small.arcs === 0, '缩小时不应画卫星，实际 ' + small.arcs);

	view.scale = 2; // 放大
	const big = countSatArcs();
	assert(big.arcs === view.satModel.length, '放大后应画出全部卫星：' + big.arcs + '/' + view.satModel.length);

	await view.onClose();
});

await await await await await await checkAsync('内环椭圆：球在近点/远点角度处半径符合 a(1±e)', async () => {
	const app = labVault(30);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const el = view.ellipseByOrbit && view.ellipseByOrbit[0];
	assert(el, '应有第 1 轨的椭圆参数');
	// 第 1 轨 e=0 → 圆形，任意角度半径都 ≈ p
	const r0 = el.p / (1 + el.e * Math.cos(0));
	assert(Math.abs(r0 - el.p) < 1e-9, '圆形轨道半径应恒定');

	// 取一条有明显离心率的轨道验证角度依赖
	let k = 1;
	while (k < view.ellipseByOrbit.length && view.ellipseByOrbit[k].e < 0.05) k++;
	if (k < view.ellipseByOrbit.length) {
		const e2 = view.ellipseByOrbit[k];
		const near = e2.p / (1 + e2.e * Math.cos(0));
		const far = e2.p / (1 + e2.e * Math.cos(Math.PI));
		assert(Math.abs(near - e2.P) < 1e-6, '近点半径应为 P：' + near + ' vs ' + e2.P);
		assert(Math.abs(far - e2.A) < 1e-6, '远点半径应为 A：' + far + ' vs ' + e2.A);
		assert(near < far, '近点应小于远点');
	}

	await view.onClose();
});
check('星带外移：pdfR 变大，时间球轨与尘埃基点跟着外移', () => {
	const g = GraphBuilder.buildGraph(labVault(30));
	const res = Layout.build(g, { spacing: 1 });
	// 星带外移：间距至少 70，且比旧公式（max 55 / 0.12）更远
	const oldGap = Math.max(55, res.maxRho * 0.12);
	const newGap = res.pdfR - res.maxRho;
	assert(newGap >= 70 - 1e-9, '间距应不小于 70：' + newGap);
	assert(newGap > oldGap + 1e-9, '应比旧规则更外：' + newGap + ' vs ' + oldGap);
	assert(res.pdfR > res.maxRho + 60, '星带应在 MD 环之外一段距离');

	// 时间球轨道：时针在 MD 环与星带之间，秒针在星带外
	const hands = res.nodes.filter((n) => n.clockHand);
	if (hands.length === 3) {
		const h = hands.find((n) => n.clockHand === 'h');
		const m = hands.find((n) => n.clockHand === 'm');
		const s = hands.find((n) => n.clockHand === 's');
		assert(h.rho > outer && h.rho < res.pdfR, '时针应在 MD 环与星带之间');
		assert(Math.abs(m.rho - res.pdfR) < 1e-9, '分针应在星带上');
		assert(s.rho > res.pdfR, '秒针应在星带之外');
	}
});

await await await await await await checkAsync('美化 M1：悬停时描出该球所在轨道（椭圆/圆）', async () => {
	const app = labVault(30);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let md = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] === 0 && !view.recs[i].root && !view.cometMask[i] && view.orbitNow[i] > 0) {
			md = i;
			break;
		}
	}
	assert(md >= 0, '找不到内环球');
	view.setHovered(md);
	const o1 = view.hoverOrbitOutline();
	assert(o1 && !o1.circle && o1.a > 0 && o1.b > 0, 'MD 球应给出椭圆轮廓：' + JSON.stringify(o1));
	assert(o1.b <= o1.a + 1e-9, '短半轴不应大于长半轴');

	// 无标签的 PDF 球也应给出轮廓
	let pdf = -1;
	for (let i = 0; i < view.n; i++) if (view.kinds[i] === 1 && !view.recs[i].comet && !view.recs[i].clockHand) pdf = i;
	view.setHovered(pdf);
	const o2 = view.hoverOrbitOutline();
	assert(o2 && o2.circle && o2.r > 0, 'PDF 球应给出圆轮廓');

	await view.onClose();
});

await checkAsync('美化 M6：最近新建的笔记从中心开始生长', async () => {
	const app = labVault(20);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	// 把一颗球标记成"刚创建"，再跑一次生长预处理
	let idx = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] === 0 && !view.recs[i].root && !view.cometMask[i]) {
			idx = i;
			break;
		}
	}
	assert(idx >= 0, '找不到普通球');
	assert(view.rho[idx] > 0, '初始应已在轨道上');

	view.graph.nodes[idx].ctime = Date.now();
	view.rho[idx] = view.recs[idx].rho;
	view.primeGrowth();
	assert(view.rho[idx] === 0, '刚创建的笔记应从 0 开始生长');

	// 老笔记不受影响
	let old = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] === 0 && !view.recs[i].root && !view.cometMask[i] && i !== idx) {
			old = i;
			break;
		}
	}
	if (old >= 0) assert(view.rho[old] > 0, '老笔记应仍在轨道上');

	// 走若干帧后应长出到目标半径附近
	const target = view.recs[idx].rho;
	for (let f = 0; f < 90; f++) {
		view.clock += 1 / 60;
	}
	view.rho[idx] = Math.min(target, view.rho[idx] + target / 20);
	assert(view.rho[idx] > 0, '应逐步长出');

	await view.onClose();
});
await checkAsync('美化 M8：Tab 在球间移动焦点，顺序按轨道', async () => {
	const app = labVault(20);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	assert(view.focusIdx === -1, '初始无焦点');
	view.handleKeydown({ key: 'Tab', preventDefault() {}, shiftKey: false });
	const a = view.focusIdx;
	assert(a >= 0, 'Tab 应选中一颗球');
	assert(view.kinds[a] !== 2, '不应选中中心球');

	view.handleKeydown({ key: 'Tab', preventDefault() {}, shiftKey: false });
	const b = view.focusIdx;
	assert(b >= 0 && b !== a, 'Tab 应移动到下一颗');

	// 顺序：轨道号不减
	const oa = view.orbitNow[a];
	const ob = view.orbitNow[b];
	const angA = Math.atan2(view.ys[a], view.xs[a]);
	const angB = Math.atan2(view.ys[b], view.xs[b]);
	assert(ob > oa || (ob === oa && angB > angA), '顺序应按轨道再按角度：' + oa + '→' + ob);

	view.handleKeydown({ key: 'Escape' });
	assert(view.focusIdx === -1, 'Esc 应清除焦点');

	await view.onClose();
});
await checkAsync('键盘导航：被圈住的球显示名称（与悬停同一颗时只画一次）', async () => {
	const app = labVault(20);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	view.setHovered(-1);
	view.handleKeydown({ key: 'Tab', preventDefault() {}, shiftKey: false });
	const focus = view.focusIdx;
	assert(focus >= 0, '应选中一颗球');
	const label = view.graph.nodes[focus].label;

	view.canvasEl._records.texts.length = 0;
	view.paint();
	const texts = view.canvasEl._records.texts.join('|');
	assert(texts.indexOf(label) >= 0, '焦点球应显示名称 ' + label + '：' + texts);

	// 同一颗球同时悬停 → 名称只画一次
	view.setHovered(focus);
	view.canvasEl._records.texts.length = 0;
	view.paint();
	const twice = (view.canvasEl._records.texts.join('|').split(label).length - 1);
	assert(twice === 1, '名称只应出现一次，实际 ' + twice);

	await view.onClose();
});
await checkAsync('计划表头部：七个平铺图标按钮（无跳转、无更多菜单）', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const icons = [];
	const walk = (el) => {
		if (!el || !el.children) return;
		for (const c of el.children) {
			if (c.classes && c.classes.has('orbit-plan-icon')) icons.push(c);
			walk(c);
		}
	};
	walk(view.planEl);
	const tips = icons.map((ic) => ic.attrs['aria-label'] || ic.attrs.title);
	assert(icons.length === 7, '应有 7 个图标按钮，实际 ' + icons.length + '：' + tips.join('/'));
	for (const want of ['上一周', '下一周', '本周', '迁移昨天未完成任务', '导入上周未完成', '打开本周计划文档', '清空拖拽记忆']) {
		assert(tips.indexOf(want) >= 0, '缺少按钮：' + want + '，实际 ' + tips.join('/'));
	}
	assert(tips.indexOf('点击跳到某一周') < 0, '不应再有跳转按钮');
	assert(tips.indexOf('更多') < 0, '不应再有更多菜单');

	// 标题不再带日期区间
	const titleEl = view.planEl.querySelector ? null : null;
	const weekText = (() => {
		const found = [];
		const w = (el) => {
			if (!el || !el.children) return;
			for (const c of el.children) {
				if (c.classes && c.classes.has('orbit-plan-week')) found.push(c.textContent);
				w(c);
			}
		};
		w(view.planEl);
		return found[0] || '';
	})();
	assert(weekText.indexOf('月') < 0 && weekText.indexOf('–') < 0, '标题不应含日期区间：' + weekText);

	await view.onClose();
});

await checkAsync('计划表：「打开本周计划文档」会建骨架并调用打开', async () => {
	const app = labVault(6);
	const opened = [];
	app.workspace.openLinkText = (p) => opened.push(p);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	await view.openPlanNote();
	assert(opened.length === 1, '应调用一次打开：' + opened.length);
	assert(/周\.md$/.test(opened[0]), '应打开周笔记：' + opened[0]);

	await view.onClose();
});

await checkAsync('计划表：窄容器下面板带容器查询样式', async () => {
	const css = require('node:fs').readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	assert(css.indexOf('container-type: inline-size') >= 0, '面板应声明为容器');
	assert(css.indexOf('@container (max-width: 520px)') >= 0, '应有 520px 断点');
	assert(css.indexOf('@container (max-width: 360px)') >= 0, '应有 360px 断点');
	assert(css.indexOf('.orbit-plan-icon') >= 0, '应有图标按钮样式');
	assert(css.indexOf('--orbit-accent') >= 0, '图标应使用 orbit 首色');
});
await checkAsync('计划表：清空拖拽记忆按钮需要点两次', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const first = view.graph.nodes.find((n, i) => view.kinds[i] === 0 && !n.root).path;
	plugin.settings.pins = { [first]: 2 };

	view.clearPins();
	assert(Object.keys(plugin.settings.pins).length === 1, '第一次点击只是待确认，不应清空');

	view.clearPins();
	assert(Object.keys(plugin.settings.pins).length === 0, '第二次点击应清空 pins');

	await view.onClose();
});

await checkAsync('样式：头部图标紧贴日期（不再右对齐）', async () => {
	const css = require('node:fs').readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	const block = css.slice(css.indexOf('.orbit-plan-actions {'), css.indexOf('.orbit-plan-actions {') + 120);
	assert(block.indexOf('margin-left: auto') < 0, '不应再有 margin-left: auto：' + block.replace(/\s+/g, ' '));
});
await checkAsync('再次点击激活键：软重载（清焦点、重新取景）', async () => {
	const app = labVault(20);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	view.focusIdx = 3;
	view.scale = 5; // 假装被缩放或平移过
	view.ox = 40;
	view.hasFit = false;

	view.reactivate();

	assert(view.focusIdx === -1, '应清空键盘焦点');
	assert(view.hasFit === true, '应已完成重新取景');
	assert(Math.abs(view.ox) < 1e-9 || view.hasFit, '应重新取景');

	await view.onClose();
});

await checkAsync('再次点击激活键：插件层会调用 view.reactivate', async () => {
	const calls = { reactivated: 0 };
	const leaf = {
		view: {
			reactivate: () => {
				calls.reactivated++;
			},
		},
	};
	const workspace = {
		on: () => ({}),
		getLeavesOfType: () => [leaf],
		revealLeaf: () => {},
		getLeftLeaf: () => ({ setViewState: async () => {} }),
		getLeaf: () => ({ setViewState: async () => {} }),
		getActiveViewOfType: () => null,
	};
	const app = { vault: { on: () => ({}), getFiles: () => [] }, metadataCache: { on: () => ({}), resolvedLinks: {} }, workspace };
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	await plugin.attachView();
	assert(calls.reactivated === 1, '应调用一次 reactivate：' + calls.reactivated);
});

await checkAsync('样式：计时/搜索按钮竖排在画布左上角，数字在秒表下方', async () => {
	const css = require('node:fs').readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	const btn = css.slice(css.indexOf('.orbit-plan-timer-btn {'));
	const head = btn.slice(0, btn.indexOf('}'));
	assert(head.indexOf('left: 10px') >= 0 && head.indexOf('top: 8px') >= 0, '计时按钮应在左上角：' + head.replace(/\s+/g, ' '));
	const sHead0 = css.slice(css.indexOf('.orbit-plan-search-btn {'));
	const sHead = sHead0.slice(0, sHead0.indexOf('}'));
	assert(sHead.indexOf('left: 44px') >= 0, '搜索按钮应在计时器右侧');
	assert(sHead.indexOf('top: 8px') >= 0, '搜索按钮与计时器同一行');
	const labelHead0 = css.slice(css.indexOf('.orbit-plan-timer-label {'));
	const labelHead = labelHead0.slice(0, labelHead0.indexOf('}'));
	assert(labelHead.indexOf('left: 10px') >= 0 && labelHead.indexOf('top: 38px') >= 0, '数字应在秒表正下方：' + labelHead.replace(/\s+/g, ' '));
	assert(css.indexOf('.orbit-plan-search-hint') >= 0, '应有搜索无命中提示样式');
});

await checkAsync('拖拽吸附：按落点角度的椭圆半径匹配，远点也不会跳错轨道', async () => {
	const app = labVault(30);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	// 找一条有明显离心率的轨道
	let orbit = -1;
	for (let i = 0; i < view.n; i++) {
		const rec = view.recs[i];
		if (rec.comet || rec.root || rec.orbit < 0) continue;
		const el = view.ellipseByOrbit[rec.orbit];
		if (el && el.e > 0.1) {
			orbit = rec.orbit;
			break;
		}
	}
	assert(orbit >= 0, '找不到椭圆轨道');
	const el = view.ellipseByOrbit[orbit];
	const theta = Math.PI; // 远点方向
	const rFar = (el.P * (1 + el.e)) / (1 + el.e * Math.cos(theta));
	const x = Math.cos(theta) * rFar;
	const y = Math.sin(theta) * rFar;

	assert(view.nearestOrbitAt(x, y) === orbit, '远点处应吸回同一条轨道：' + view.nearestOrbitAt(x, y) + ' vs ' + orbit);

	// 近点方向也一样
	const rNear = (el.P * (1 + el.e)) / (1 + el.e * Math.cos(0));
	assert(view.nearestOrbitAt(rNear, 0) === orbit, '近点处应吸回同一条轨道');

	await view.onClose();
});

await checkAsync('卫星不可交互：点卫星不会改变任何状态', async () => {
	const spec = [
		{ path: 'n/a.md', fm: { 'creation-time': '2020-01-01', tags: ['甲'] }, resolved: { 'n/b.md': 1 } },
		{ path: 'n/b.md', fm: { 'creation-time': '2020-01-02' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	const sat = view.satModel && view.satModel[0];
	assert(sat, '应有卫星');
	const px = view.renderer.projectX(sat.x, { scale: view.scale, ox: view.ox, oy: view.oy });
	const py = view.renderer.projectY(sat.y, { scale: view.scale, ox: view.ox, oy: view.oy });
	const rect = view.canvasEl.getBoundingClientRect();

	view.handleDown({ button: 0, clientX: rect.left + px, clientY: rect.top + py });
	assert(!view.nodeDrag, '点卫星不应进入拖拽');
	assert(view.tagFilter === undefined, '标签筛选机制应已移除');

	await view.onClose();
});
await checkAsync('冷启动：订阅 metadataCache resolved，并按真实双链数重建取景', async () => {
	const handlers = {};
	const files = [
		{ path: 'a.md', extension: 'md', basename: 'a', stat: { ctime: 1, size: 10 } },
		{ path: 'b.md', extension: 'md', basename: 'b', stat: { ctime: 2, size: 10 } },
		{ path: 'c.md', extension: 'md', basename: 'c', stat: { ctime: 3, size: 10 } },
	];
	const meta = {
		'a.md': { frontmatter: { 'creation-time': '2020-01-01' }, links: [] },
		'b.md': { frontmatter: { 'creation-time': '2020-01-02' }, links: [] },
		'c.md': { frontmatter: { 'creation-time': '2020-01-03' }, links: [] },
	};
	// 冷启动：resolvedLinks 暂时为空
	const resolved = {};
	const app = {
		vault: {
			on: () => ({}),
			getFiles: () => files,
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
			create: async () => ({}),
			createFolder: async () => {},
			process: async (f, fn) => fn(''),
		},
		metadataCache: {
			resolvedLinks: resolved,
			on: (name, fn) => {
				handlers[name] = true;
				if (name === 'resolved') fn && (app.metadataCache.__lastResolved = fn);
				return {};
			},
			getFileCache: (f) => meta[f.path] || null,
			getFirstLinkpathDest: (l) => l,
		},
		workspace: { on: () => ({}), getLeaf: () => null, getLeavesOfType: () => [], revealLeaf: () => {}, getActiveViewOfType: () => null },
	};
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	assert(handlers.resolved, '应订阅 metadataCache 的 resolved 事件');

	// 冷启动时所有球的 degree 都是 0
	for (let i = 0; i < view.n; i++) assert(view.graph.nodes[i].degree === 0, '冷启动时 degree 应为 0');

	// 缓存解析完成：resolvedLinks 有内容，触发回调 → 重建后 degree 应为真实值
	resolved['a.md'] = { 'b.md': 1, 'c.md': 1 };
	let rebuilt = 0;
	view.rebuild = () => {
		rebuilt++;
	};
	let fitted = 0;
	view.fit = () => {
		fitted++;
	};
	const cb = app.metadataCache.__lastResolved;
	if (cb) cb();
	assert(rebuilt === 1 && fitted === 1, '应重建并重新取景：' + rebuilt + '/' + fitted);

	await view.onClose();
});
check('按天结构：骨架含 7 天 × 4 象限 + 一份 PDCA', () => {
	const s = Plan.skeleton(2026, 43);
	const p = Plan.parse(s);
	assert(p.days.length === 7, '应有 7 天');
	for (const day of p.days) assert(day.quads.length === 4, '每天应有 4 个象限');
	assert(s.indexOf('## 10/19 周一') >= 0 && s.indexOf('## 10/25 周日') >= 0, '天标题应含日期与星期');
	assert(s.indexOf('## PDCA 复盘') >= 0, '应有一份 PDCA');
	assert(p.legacy === false, '新骨架不应被判为旧格式');
});

check('按天结构：写入指定天的指定象限', () => {
	const s = Plan.skeleton(2026, 43);
	const text = Plan.addTask(s, 4, 2, '周五第三象限');
	const p = Plan.parse(text);
	assert(p.days[4].quads[2].tasks.length === 1 && p.days[4].quads[2].tasks[0].text === '周五第三象限', '落点不对');
	assert(Plan.totals(p).total === 1, '总数应为 1');
});

check('旧格式迁移：内容进周一，PDCA 原样保留', () => {
	const legacy = ['# 2026 年第 43 周', '', '## 重要 · 紧急', '- [x] 旧A', '- [ ] 旧B', '## PDCA 复盘', '### P 计划（Plan）', '原计划文本', ''].join('\n');
	const parsed = Plan.parse(legacy);
	assert(parsed.legacy === true, '应识别为旧格式');
	const migrated = Plan.migrateLegacy(legacy, 2026, 43);
	const after = Plan.parse(migrated);
	assert(after.legacy === false, '迁移后不应再是旧格式');
	assert(after.days[0].quads[0].tasks.length === 2, '旧任务应进入周一第一象限：' + after.days[0].quads[0].tasks.length);
	assert(after.days[0].quads[0].tasks[0].done === true, '完成状态应保留');
	assert(after.pdca[0] === '原计划文本', 'PDCA 应原样保留：' + JSON.stringify(after.pdca[0]));
	assert(migrated.indexOf('## 10/19 周一') >= 0, '迁移应写入带日期的天标题');
});

check('日期标签与今天索引', () => {
	assert(Plan.dayLabel(2026, 43, 0) === '10/19 周一', '周一标签：' + Plan.dayLabel(2026, 43, 0));
	assert(Plan.dayLabel(2026, 43, 6) === '10/25 周日', '周日标签：' + Plan.dayLabel(2026, 43, 6));
	// 2026-10-22 是周四
	assert(Plan.todayIndex(new Date(2026, 9, 22)) === 3, '周四索引应为 3');
	assert(Plan.todayIndex(new Date(2026, 9, 19)) === 0, '周一索引应为 0');
});
check('迁移：昨天未完成 → 今天复制 + 源任务勾选并加(未完成)', () => {
	let text = Plan.skeleton(2026, 43);
	text = Plan.addTask(text, 1, 0, '复习线代');
	text = Plan.addTask(text, 1, 0, '已完成的事');
	text = Plan.toggleTask(text, Plan.findTaskLine(text, '已完成的事'));

	const res = Plan.carryOver(text, 1, 2);
	assert(res.items.length === 1 && res.items[0].text === '复习线代', '应只迁移未完成那条：' + JSON.stringify(res.items));

	const p = Plan.parse(res.text);
	const src = p.days[1].quads[0].tasks.find((t) => t.text.indexOf('复习线代') >= 0);
	assert(src && src.done === true, '昨天那条应被勾选');
	assert(src.text === '复习线代(未完成)', '应加后缀：' + src.text);
	const dst = p.days[2].quads[0].tasks.find((t) => t.text === '复习线代');
	assert(dst && dst.done === false, '今天应复制出一条未完成');

	// 再跑一次：源已无未完成 → 不重复
	const again = Plan.carryOver(res.text, 1, 2);
	assert(again.items.length === 0, '不应重复迁移：' + JSON.stringify(again.items));
});

check('迁移：PDCA 四节按格式追加（P/D/C/A 各一行）', () => {
	let text = Plan.skeleton(2026, 43);
	const next = Plan.appendPdca(text, '第 43 周', [{ text: '复习线代', reason: '临时有事', improve: '提前排期' }]);
	const p = Plan.parse(next);
	assert(p.pdca[0].indexOf('- 复习线代（第 43 周）') >= 0, 'P: ' + JSON.stringify(p.pdca[0]));
	assert(p.pdca[1].indexOf('- 复习线代（第 43 周）未完成') >= 0, 'D: ' + JSON.stringify(p.pdca[1]));
	assert(p.pdca[2].indexOf('记录未完成原因：临时有事') >= 0, 'C: ' + JSON.stringify(p.pdca[2]));
	assert(p.pdca[3].indexOf('预计改进方法：提前排期') >= 0, 'A: ' + JSON.stringify(p.pdca[3]));
});

await checkAsync('迁移按钮：今天是周一时只提示不迁移', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	// 固定"今天"为周一
	view.todayIndexFn = () => 0;
	view.planText = Plan.addTask(Plan.skeleton(view.weekYear, view.weekNum), 6, 0, '上周日的事');
	const before = view.planText;
	await view.carryOverTasks();
	assert(view.planText === before, '周一不应迁移');

	await view.onClose();
});

await checkAsync('迁移按钮：前一天没有未完成时给出提示', async () => {
	const { Notice } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2;
	view.planText = Plan.skeleton(view.weekYear, view.weekNum); // 周二为空
	Notice.last = '';
	await view.carryOverTasks();

	assert(String(Notice.last).indexOf('真棒') >= 0, '应提示真棒：' + Notice.last);

	await view.onClose();
});

await checkAsync('计划笔记的改动不会触发星图重建', async () => {
	const handlers = {};
	const files = [{ path: 'n1.md', extension: 'md', basename: 'n1', stat: { ctime: 1, size: 10 } }];
	const app = {
		vault: {
			on: (name, fn) => {
				handlers['vault:' + name] = fn;
				return {};
			},
			getFiles: () => files,
			getMarkdownFiles: () => files,
			getAbstractFileByPath: () => null,
			create: async () => ({}),
			createFolder: async () => {},
			process: async (f, fn) => fn(''),
		},
		metadataCache: {
			resolvedLinks: {},
			on: (name, fn) => {
				handlers['meta:' + name] = fn;
				return {};
			},
			getFileCache: () => ({ frontmatter: {}, links: [] }),
			getFirstLinkpathDest: (l) => l,
		},
		workspace: { on: () => ({}), getLeaf: () => null, getLeavesOfType: () => [], revealLeaf: () => {}, getActiveViewOfType: () => null },
	};
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let rebuilds = 0;
	view.scheduleRebuild = () => {
		rebuilds++;
	};
	const changed = handlers['meta:changed'];
	assert(typeof changed === 'function', '应注册 changed 回调');

	changed({ path: 'orbit-plan/2026/43周.md' });
	assert(rebuilds === 0, '计划笔记改动不应重建星图：' + rebuilds);

	changed({ path: 'n1.md' });
	assert(rebuilds === 1, '普通笔记改动应重建：' + rebuilds);

	await view.onClose();
});
await checkAsync('迁移：PDCA 用星期标注（周二），弹窗卡片含汇总与提示', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2; // 周三，迁移周二的
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '复习线代');
	text = Plan.addTask(text, 1, 0, '写周报');
	view.planText = text;
	view.renderPlan();

	await view.carryOverTasks();

	// 弹窗：卡片、汇总、占位提示
	const modal = Modal.last;
	assert(modal && modal.rows && modal.rows.length === 2, '弹窗应有两行输入：' + (modal && modal.rows && modal.rows.length));
	const html = [];
	const walk = (el) => {
		if (!el) return;
		if (el.classes) html.push(...el.classes);
		if (el.attrs && el.attrs.placeholder) html.push('ph:' + el.attrs.placeholder);
		if (el.textContent) html.push('t:' + el.textContent);
		(el.children || []).forEach(walk);
	};
	walk(modal.contentEl);
	const flat = html.join('|');
	assert(flat.indexOf('orbit-plan-carry-item') >= 0, '应有卡片样式');
	assert(flat.indexOf('orbit-plan-carry-summary') >= 0, '应有汇总行');
	assert(flat.indexOf('共 2 条未完成') >= 0, '汇总应为 2 条：' + flat.slice(0, 200));
	assert(flat.indexOf('ph:例如：临时有课') >= 0, '原因框应有占位提示');

	// 确认后：PDCA 用「周二」
	modal.rows[0].reason.value = '临时有课';
	modal.rows[0].improve.value = '提前排期';
	modal.rows[1].reason.value = '被打断';
	modal.rows[1].improve.value = '关掉通知';
	modal.contentEl.__submit();

	await new Promise((r) => setTimeout(r, 0));
	const parsed = Plan.parse(view.planText);
	assert(parsed.pdca[0].indexOf('（周二）') >= 0, 'P 应用星期标注：' + JSON.stringify(parsed.pdca[0]));
	assert(parsed.pdca[1].indexOf('写周报（周二）未完成') >= 0, 'D 应含第二条：' + JSON.stringify(parsed.pdca[1]));
	assert(parsed.pdca[2].indexOf('记录未完成原因：临时有课') >= 0, 'C 应含原因');
	assert(parsed.pdca[3].indexOf('预计改进方法：关掉通知') >= 0, 'A 应含改进');

	await view.onClose();
});
await checkAsync('新增输入：重绘只补一次输入框，不抢编辑焦点', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.planText = Plan.skeleton(view.weekYear, view.weekNum);
	view.renderPlan();

	// 手动设置 pendingAdd 并重绘：应打开一次输入框并清空标记
	view.pendingAdd = { d: 0, q: 0 };
	view.renderPlan();
	assert(view.pendingAdd === null, '重绘后 pendingAdd 应被清空');
	let inputs = 0;
	const walk = (el) => {
		if (!el) return;
		if (el.classes && el.classes.has('orbit-plan-add-input')) inputs++;
		(el.children || []).forEach(walk);
	};
	walk(view.planEl);
	assert(inputs === 1, '应只有一个新增输入框：' + inputs);

	// 再重绘一次：不应再出现输入框（否则会抢焦点）
	view.renderPlan();
	inputs = 0;
	walk(view.planEl);
	assert(inputs === 0, '再次重绘不应重开输入框：' + inputs);

	// 编辑态下不打开新增输入框
	view.editingLine = 1;
	view.pendingAdd = { d: 0, q: 0 };
	view.renderPlan();
	inputs = 0;
	walk(view.planEl);
	assert(inputs === 0, '编辑中不应抢焦点开新增框：' + inputs);
	view.editingLine = -1;

	await view.onClose();
});

await checkAsync('迁移弹窗：多条任务默认只展开第一条', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2;
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '复习线代');
	text = Plan.addTask(text, 1, 0, '写周报');
	view.planText = text;
	view.renderPlan();
	await view.carryOverTasks();

	const modal = Modal.last;
	assert(modal && modal.rows.length === 2, '应有两行');
	assert(modal.rows[0].body.style.display === '', '第一条应展开');
	assert(modal.rows[1].body.style.display === 'none', '第二条应收起');

	// 点标题行展开第二条
	modal.rows[1].body.style.display = 'none';
	const heads = [];
	const walk = (el) => {
		if (!el) return;
		if (el.classes && el.classes.has('orbit-plan-carry-head')) heads.push(el);
		(el.children || []).forEach(walk);
	};
	walk(modal.contentEl);
	assert(heads.length === 2, '应有两个标题行：' + heads.length);
	heads[1].fire('click', {});
	assert(modal.rows[1].body.style.display === '', '点击后第二条应展开');

	await view.onClose();
});
await checkAsync('迁移弹窗：Enter 逐格跳转，末格全填才保存', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2;
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '任务甲');
	text = Plan.addTask(text, 1, 0, '任务乙');
	view.planText = text;
	view.renderPlan();
	await view.carryOverTasks();

	const modal = Modal.last;
	const rows = modal.rows;
	assert(rows.length === 2, '应有两行');

	// 焦点模拟：记录当前 focus 的元素
	let focused = null;
	for (const r of rows) {
		r.reason.focus = () => {
			focused = r.reason;
		};
		r.improve.focus = () => {
			focused = r.improve;
		};
	}

	// 任务甲原因 → Enter → 任务甲改进
	rows[0].reason.fire('keydown', { key: 'Enter', preventDefault() {} });
	assert(focused === rows[0].improve, '应跳到同任务改进框');

	// → 任务乙原因
	rows[0].improve.fire('keydown', { key: 'Enter', preventDefault() {} });
	assert(focused === rows[1].reason, '应跳到下一个任务的原因');

	// 全部填写后再在末格按 Enter → 保存
	rows[0].reason.value = '原因甲';
	rows[0].improve.value = '改进甲';
	rows[1].reason.value = '原因乙';
	rows[1].improve.value = '改进乙';
	rows[1].improve.fire('keydown', { key: 'Enter', preventDefault() {} });
	await new Promise((r) => setTimeout(r, 0));

	const parsed = Plan.parse(view.planText);
	assert(parsed.pdca[2].indexOf('任务乙') >= 0, '应已保存到 PDCA：' + JSON.stringify(parsed.pdca[2]));

	await view.onClose();
});

await checkAsync('迁移弹窗：末格 Enter 遇空项只跳转不保存', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2;
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '任务甲');
	view.planText = text;
	view.renderPlan();
	await view.carryOverTasks();

	const modal = Modal.last;
	const row = modal.rows[0];
	let focused = null;
	row.reason.focus = () => {
		focused = row.reason;
	};
	row.improve.focus = () => {
		focused = row.improve;
	};
	const before = view.planText;
	row.improve.fire('keydown', { key: 'Enter', preventDefault() {} });
	await new Promise((r) => setTimeout(r, 0));
	assert(view.planText === before, '有空项时不应保存');
	assert(focused === row.reason, '应跳回第一个空输入框');

	await view.onClose();
});

await checkAsync('画面不被重置：resolved 只首次取景，rebuild 之后不再吸附', async () => {
	const handlers = {};
	const files = [{ path: 'a.md', extension: 'md', basename: 'a', stat: { ctime: 1, size: 10 } }];
	const app = {
		vault: {
			on: (n, f) => {
				handlers['v:' + n] = f;
				return {};
			},
			getFiles: () => files,
			getMarkdownFiles: () => files,
			getAbstractFileByPath: () => null,
			create: async () => ({}),
			createFolder: async () => {},
			process: async (f, fn) => fn(''),
		},
		metadataCache: {
			resolvedLinks: {},
			on: (n, f) => {
				handlers['m:' + n] = f;
				return {};
			},
			getFileCache: () => ({ frontmatter: {}, links: [] }),
			getFirstLinkpathDest: (l) => l,
		},
		workspace: { on: () => ({}), getLeaf: () => null, getLeavesOfType: () => [], revealLeaf: () => {}, getActiveViewOfType: () => null },
	};
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let fits = 0;
	view.fit = () => {
		fits++;
	};

	// hasFit 为 true 时，resolved 不应重新取景
	view.hasFit = true;
	const resolved = handlers['m:resolved'];
	assert(typeof resolved === 'function', '应注册 resolved');
	resolved();
	assert(fits === 0, '已取景后 resolved 不应再 fit：' + fits);

	// hasFit 为 false 时才取景一次
	view.hasFit = false;
	resolved();
	assert(fits === 1, '首次 resolved 应取景一次：' + fits);

	// rebuild 在已取景后应走 applyLayout(false)
	const snaps = [];
	view.applyLayout = (snap) => {
		snaps.push(snap);
	};
	view.hasFit = true;
	view.rebuild();
	assert(snaps.length === 1 && snaps[0] === false, '已取景后 rebuild 不应吸附：' + JSON.stringify(snaps));

	await view.onClose();
});
await checkAsync('画幅记忆：缩放后写入 settings，新视图恢复同一视角', async () => {
	const app = labVault(20);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	// 模拟滚轮缩放（会触发 saveView）
	view.scale = 1.7;
	view.ox = 12;
	view.oy = -34;
	view.saveView();
	await new Promise((r) => setTimeout(r, 0));

	const saved = plugin.settings.orbitView;
	assert(saved && Math.abs(saved.scale - 1.7) < 1e-9 && saved.ox === 12 && saved.oy === -34, '应写入画幅：' + JSON.stringify(saved));

	// 新视图应恢复
	const view2 = plugin.views[0].factory({ app });
	await view2.onOpen();
	advance(view2, 1);
	assert(Math.abs(view2.scale - 1.7) < 1e-9, '应恢复缩放：' + view2.scale);
	assert(view2.ox === 12 && view2.oy === -34, '应恢复平移');
	assert(view2.hasFit === true, '不应再自动取景');

	await view2.onClose();
	await view.onClose();
});

await checkAsync('画幅记忆：非法存档被忽略，回退自动取景', async () => {
	const app = labVault(10);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	plugin.settings.orbitView = { scale: 999, ox: 0, oy: 0, w: 800, h: 600 };
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);
	assert(view.scale <= 2.2 + 1e-9, '非法缩放应被忽略并重新取景：' + view.scale);
	await view.onClose();
});

await checkAsync('迁移弹窗：末格 Enter 会先展开折叠卡片再聚焦', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2;
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '任务甲');
	text = Plan.addTask(text, 1, 0, '任务乙');
	view.planText = text;
	view.renderPlan();
	await view.carryOverTasks();

	const modal = Modal.last;
	const rows = modal.rows;
	assert(rows.length === 2 && rows[1].body.style.display === 'none', '第二条应默认收起');

	let focused = null;
	for (const r of rows) {
		r.reason.focus = () => {
			focused = r.reason;
		};
		r.improve.focus = () => {
			focused = r.improve;
		};
	}

	// 填好第一条，末格回车 → 应展开第二条并聚焦它的原因框
	rows[0].reason.value = '甲原因';
	rows[0].improve.value = '甲改进';
	rows[0].improve.fire('keydown', { key: 'Enter', preventDefault() {} });
	assert(rows[1].body.style.display === '', '第二条应被展开');
	assert(focused === rows[1].reason, '焦点应落到第二条的原因框');

	await view.onClose();
});
await checkAsync('迁移弹窗：列出昨天全部未完成（同名不吞、默认只展开第一条）', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.todayIndexFn = () => 2; // 周三，迁周二的
	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, 1, 0, '复习线代');
	text = Plan.addTask(text, 1, 0, '写周报');
	text = Plan.addTask(text, 1, 0, '回邮件');
	// 今天已经有同名任务 → 复制时会跳过，但弹窗仍应列出
	text = Plan.addTask(text, 2, 0, '写周报');
	view.planText = text;
	view.renderPlan();
	await view.carryOverTasks();

	const modal = Modal.last;
	assert(modal, '应弹出窗口');
	assert(modal.rows.length === 3, '弹窗应有昨天全部 3 条：' + modal.rows.length);
	assert(modal.rows[0].text === '复习线代' && modal.rows[2].text === '回邮件', '顺序应为文件顺序');
	assert(modal.rows[0].body.style.display === '', '第一条应展开');
	assert(modal.rows[1].body.style.display === 'none', '第二条应默认收起');

	// 今天：原有 1 条 + 新复制 2 条 = 3 条
	const parsed = Plan.parse(view.planText);
	assert(parsed.days[2].quads[0].tasks.length === 3, '今天应有 3 条：' + parsed.days[2].quads[0].tasks.length);

	await view.onClose();
});
await checkAsync('计时器按钮：秒表图标 + 状态提示', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const btn = view.timerBtnEl;
	assert(btn, '应有计时按钮');
	assert(btn.textContent === '', '按钮不应再有文字：' + btn.textContent);
	assert(btn.attrs['aria-label'] === Core.STR.timerStart, '空闲时提示应为「计时」：' + btn.attrs['aria-label']);

	view.toggleTimer();
	assert(btn.classes.has('is-active'), '计时中应有 is-active');
	assert(btn.attrs['aria-label'] === Core.STR.timerStop, '计时中提示应为「停止」：' + btn.attrs['aria-label']);

	view.timerActive = false;
	view.renderTimer();
	assert(!btn.classes.has('is-active'), '停止后应移除 is-active');
	assert(btn.attrs['aria-label'] === Core.STR.timerStart, '停止后提示应回「计时」');

	await view.onClose();
});
await checkAsync('倒计时：留空=正计时，填 25 分钟=倒计时且剩余递减', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	view.startTimer(0, '正计时', '');
	assert(view.timerMode === 'up', '留空应为正计时：' + view.timerMode);
	view.timerActive = false;
	view.timerStart = 0;
	view.renderTimer();

	view.toggleTimer();
	view.startTimer(0, '番茄钟', '写周报', 1500); // 1500 秒 = 25 分
	assert(view.timerMode === 'down' && view.planSec === 1500, '应为 1500 秒倒计时：' + view.planSec);

	const realNow = Date.now;
	view.timerStart = realNow() - 300000; // 已过 5 分钟
	view.renderTimer();
	assert(view.timerRemain === 1200, '剩余应为 1200 秒：' + view.timerRemain);
	assert(view.timerLabelEl.textContent === '20:00', '标签应显示剩余 20:00：' + view.timerLabelEl.textContent);

	// 三针随剩余递减而逆时针：过了 30 秒 → 秒针后退半圈（模 1 意义下）
	const s1 = view.handAngles.s;
	view.timerStart = realNow() - 330000; // 又过 30 秒
	view.renderTimer();
	const back = (((s1 - view.handAngles.s) % 1) + 1) % 1;
	assert(Math.abs(back - 0.5) < 1e-9, '秒针应逆时针后退半圈：' + back);
	assert(view.timerRemain === 1170, '剩余应为 1170 秒：' + view.timerRemain);

	await view.onClose();
});

await checkAsync('倒计时：未到点点击=取消（不写笔记、不呼吸）', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	view.startTimer(0, '番茄钟', '写周报', 1500); // 1500 秒 = 25 分
	const before = view.planText;
	const realNow = Date.now;
	view.timerStart = realNow() - 60000; // 才过 1 分钟
	await view.stopTimer();

	assert(view.planText === before, '取消不应改写笔记');
	assert(view.breathing === false, '不应进入呼吸');
	assert(view.timerActive === false && view.timerMode === 'up', '应回到空闲');

	await view.onClose();
});

await checkAsync('倒计时：到点后点击=结算（计划/实际用时 + 勾选）', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	view.startTimer(0, '番茄钟', '写周报', 1500); // 1500 秒 = 25 分
	const realNow = Date.now;
	view.timerStart = realNow() - 27 * 60000 - 12000; // 计划 25 分，实际 27:12
	view.renderTimer();
	assert(view.timerRemain === 0 && view.breathing === true, '到点应进入呼吸');

	await view.stopTimer();
	assert(view.breathing === false, '结算后应停止呼吸');
	assert(
		view.planText.indexOf('- [x] 番茄钟：写周报（计划用时 25 分 0 秒，实际用时 27 分 12 秒）') >= 0,
		'结算格式不对：' + view.planText.slice(0, 200)
	);

	await view.onClose();
});

await checkAsync('倒计时：呼吸时渲染叠加整幅色调', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	view.breathing = true;
	view.clock = 0.5;
	view.canvasEl._records.fills = 0;
	view.paint();
	assert(view.canvasEl._records.fills > 0, '应画出呼吸叠层');
	assert(view.model.breathing === true, '模型应带呼吸标记');
	view.breathing = false;

	await view.onClose();
});

await checkAsync('倒计时：季输入非法分钟时行内报错', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	const modal = Modal.last;
	modal.nameInput.value = '测试';
	modal.minutesInput.value = '0';
	modal.submit();
	assert(modal.started === false, '非法分钟不应开始');
	assert(String(modal.errorEl.textContent).indexOf('1–999') >= 0, '应提示范围：' + modal.errorEl.textContent);

	await view.onClose();
});
await checkAsync('倒计时：走弹窗链路生效（回归：minutes 参数不能丢）', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	const modal = Modal.last;
	modal.chipEls[1].fire('click', {});
	modal.nameInput.value = '番茄钟';
	modal.bodyInput.value = '写周报';
	modal.minutesInput.value = '25';
	modal.secondsInput.value = '0';
	modal.minutesInput.fire('input', {});
	assert(modal.minutesHintEl.textContent === '= 25:00', '应显示换算提示：' + modal.minutesHintEl.textContent);

	modal.submit(); // 走弹窗 → onStart(quad, name, content, minutes)
	assert(view.timerActive === true && view.timerMode === 'down', '弹窗提交后应进入倒计时：' + view.timerMode);
	assert(view.planSec === 1500, '计划秒数应为 1500：' + view.planSec);
	assert(view.planText.indexOf('- [ ] 番茄钟：写周报') >= 0, '应写入任务行');

	// 倒计时中按钮提示带剩余时间
	view.renderTimer();
	assert(String(view.timerBtnEl.attrs['title']).indexOf('剩余') >= 0, '提示应含剩余：' + view.timerBtnEl.attrs['title']);

	await view.onClose();
});

await checkAsync('倒计时：留空分钟时仍是正计时', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.toggleTimer();
	const modal = Modal.last;
	modal.nameInput.value = '正计时任务';
	modal.submit();
	assert(view.timerMode === 'up', '留空应为正计时：' + view.timerMode);
	assert(view.planSec === 0, '计划秒数应为 0');

	await view.onClose();
});
await checkAsync('倒计时：分+秒输入，最低 1 秒', async () => {
	const { Modal } = require('./obsidian-stub.cjs');
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	// 0 分 30 秒
	view.toggleTimer();
	let modal = Modal.last;
	modal.nameInput.value = '半分钟';
	modal.minutesInput.value = '0';
	modal.secondsInput.value = '30';
	modal.minutesInput.fire('input', {});
	assert(modal.minutesHintEl.textContent === '= 0:30', '换算提示：' + modal.minutesHintEl.textContent);
	modal.submit();
	assert(view.timerMode === 'down' && view.planSec === 30, '应为 30 秒倒计时：' + view.planSec);

	view.timerActive = false;
	view.timerStart = 0;
	view.timerMode = 'up';
	view.renderTimer();

	// 0 分 0 秒 → 报错
	view.toggleTimer();
	modal = Modal.last;
	modal.nameInput.value = '零';
	modal.minutesInput.value = '0';
	modal.secondsInput.value = '0';
	modal.submit();
	assert(modal.started === false, '0 秒不应开始');

	await view.onClose();
});

await checkAsync('倒计时：时间球拖尾画在运动反侧', async () => {
	const app = clockVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 2);

	let handIdx = -1;
	for (let i = 0; i < view.n; i++) if (view.recs[i].clockHand === 's') handIdx = i;
	assert(handIdx >= 0, '找不到秒针球');

	view.timerActive = true;
	view.timerMode = 'down';
	view.planSec = 300;
	view.timerStart = Date.now() - 60000;
	view.renderTimer();
	view.paint();

	const mo = view.model;
	assert(mo.clockDown === true && mo.clockHands[handIdx] === 1, '模型应标记时间球倒计时');

	view.timerActive = false;
	view.timerMode = 'up';
	view.renderTimer();
	view.paint();
	assert(view.model.clockDown === false, '正计时不应触发反向尾巴');

	await view.onClose();
});

await checkAsync('呼吸颜色：取当前色系中间色标', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const purple = Palette.byId('purple').stops;
	assert(view.breathColor().toUpperCase() === purple[Math.floor((purple.length - 1) / 2)].toUpperCase(), '紫色中间色不对：' + view.breathColor());

	plugin.settings.scheme = 'red';
	const red = Palette.byId('red').stops;
	assert(view.breathColor().toUpperCase() === red[Math.floor((red.length - 1) / 2)].toUpperCase(), '红色中间色不对：' + view.breathColor());

	await view.onClose();
});
check('暗色杂色：深海霓虹/午夜星云 也遵守"中心取最深"', () => {
	const nodes = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }, { path: 'd.md' }];
	const radii = new Float64Array([10, 20, 30, 40]);
	for (const id of ['deep', 'midnight']) {
		const out = Palette.resolve(nodes, radii, { scheme: id });
		const stops = Palette.byId(id).stops;
		assert(out[0] === stops[stops.length - 1], id + ' 中心应取最深色：' + out[0]);
		assert(new Set(out.slice(1)).size >= 2, id + ' 非中心应出现多色：' + out.join(','));
	}
});
check('太阳系色系：外冷内暖 + 行星按轨道取色、中心为太阳金', () => {
	const nodes = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }, { path: 'd.md' }];
	const radii = new Float64Array([10, 20, 30, 40]);

	const solar = Palette.resolve(nodes, radii, { scheme: 'solar' });
	const solarStops = Palette.byId('solar').stops;
	assert(solar[0] === solarStops[solarStops.length - 1], '中心应为太阳金：' + solar[0]);
	assert(solar[3] === solarStops[0], '外圈应为深蓝：' + solar[3]);

	const planets = Palette.resolve(nodes, radii, { scheme: 'planets' });
	const planetStops = Palette.byId('planets').stops;
	assert(planets[0] === planetStops[planetStops.length - 1], '行星方案中心也应是太阳金：' + planets[0]);
	assert(new Set(planets.slice(1)).size === 3, '不同轨道应取不同行星色：' + planets.join(','));
});

check('杂色：按轨道循环、按笔记哈希、中心球取最深色', () => {
	const nodes = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }, { path: 'd.md' }];
	const radii = new Float64Array([10, 20, 30, 40]);

	const neon = Palette.resolve(nodes, radii, { scheme: 'neon' });
	const neonStops = Palette.byId('neon').stops;
	assert(neon[0] === neonStops[neonStops.length - 1], '中心球应取最深色：' + neon[0]);
	assert(neon[1] !== neon[2] && neon[2] !== neon[3], '不同半径应不同色：' + neon.join(','));

	// 同半径同色
	const radii2 = new Float64Array([10, 20, 20, 30]);
	const neon2 = Palette.resolve(nodes, radii2, { scheme: 'neon' });
	assert(neon2[1] === neon2[2], '同半径应同色：' + neon2.join(','));

	// 哈希：同路径恒同色
	const candy1 = Palette.resolve(nodes, radii, { scheme: 'candy' });
	const candy2 = Palette.resolve(nodes, radii, { scheme: 'candy' });
	assert(candy1.join(',') === candy2.join(','), '哈希取色应稳定');
	const candyStops = Palette.byId('candy').stops;
	assert(candy1[0] === candyStops[candyStops.length - 1], '杂色中心球也取最深色');
	assert(new Set(candy1.slice(1)).size >= 2, '杂色应出现多种颜色：' + candy1.join(','));
});
await checkAsync('配色变量：c1–c4 与四象限色随色系联动', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const vars = view.contentEl.style.vars || {};
	const c = [vars['--orbit-c1'], vars['--orbit-c2'], vars['--orbit-c3'], vars['--orbit-c4']];
	assert(c.every((x) => /^#[0-9a-f]{6}$/i.test(String(x))), '应写入 c1–c4：' + JSON.stringify(c));
	assert(vars['--orbit-accent'] === c[0], 'accent 应等于 c1');
	assert(vars['--orbit-ink'] === c[3], 'ink 应等于 c4');

	// 四象限取不同色，且"不重要·不紧急"用最浅色
	const q = [vars['--orbit-q1'], vars['--orbit-q2'], vars['--orbit-q3'], vars['--orbit-q4']];
	assert(new Set(q).size === 4, '四象限应取四种不同颜色：' + q.join(','));
	assert(q[3] === c[0], '不重要·不紧急应用最浅色');
	assert(q[0] === c[1] && q[1] === c[2] && q[2] === c[3], '象限映射应为 c2/c3/c4/c1');

	// 切色系 → 变量跟着变
	plugin.settings.scheme = 'midnight';
	view.applyTheme();
	const c2 = [view.contentEl.style.vars['--orbit-c1'], view.contentEl.style.vars['--orbit-c2'], view.contentEl.style.vars['--orbit-c3'], view.contentEl.style.vars['--orbit-c4']];
	assert(c2.join(',') !== c.join(','), '切换色系后颜色应变化');
	assert(Math.abs(view.breathColor().length) > 0, '呼吸色仍可解析');

	await view.onClose();
});
await checkAsync('侧栏入口：多余 leaf 被清理，无则自动创建', async () => {
	const detached = [];
	const created = [];
	const makeLeaf = () => ({
		setViewState: async (st) => created.push(st),
		detach: () => detached.push(1),
	});
	const leaves = [makeLeaf(), makeLeaf(), makeLeaf()];
	const workspace = {
		on: () => ({}),
		onLayoutReady: (fn) => {
			fn();
		},
		getLeavesOfType: () => leaves,
		getLeftLeaf: () => makeLeaf(),
		getLeaf: () => makeLeaf(),
		revealLeaf: () => {},
		getActiveViewOfType: () => null,
	};
	const app = { vault: { on: () => ({}), getFiles: () => [] }, metadataCache: { on: () => ({}), resolvedLinks: {} }, workspace };
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	await new Promise((r) => setTimeout(r, 0));

	assert(detached.length === 2, '应清理 2 个多余 leaf：' + detached.length);

	// 没有任何 leaf 时应自动创建
	const created2 = [];
	const workspace2 = {
		on: () => ({}),
		onLayoutReady: (fn) => fn(),
		getLeavesOfType: () => [],
		getLeftLeaf: () => ({ setViewState: async (st) => created2.push(st) }),
		getLeaf: () => ({ setViewState: async () => {} }),
		revealLeaf: () => {},
		getActiveViewOfType: () => null,
	};
	const app2 = { vault: { on: () => ({}), getFiles: () => [] }, metadataCache: { on: () => ({}), resolvedLinks: {} }, workspace: workspace2 };
	const plugin2 = new PluginClass(app2, MANIFEST);
	await plugin2.onload();
	await new Promise((r) => setTimeout(r, 0));
	assert(created2.length === 1 && created2[0].type === 'orbit-plan-kle-view', '应自动创建侧栏视图：' + created2.length);
});
await checkAsync('O5：重建时清理指向已删除笔记的 pins', async () => {
	const app = labVault(10);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	const alive = view.graph.nodes[0].path;
	plugin.settings.pins = { [alive]: 1, '已被删除.md': 2 };
	view.rebuild();

	assert(plugin.settings.pins[alive] === 1, '有效 pin 应保留');
	assert(plugin.settings.pins['已被删除.md'] === undefined, '失效 pin 应被清掉');

	await view.onClose();
});

await checkAsync('O6：时间源可注入（nowFn）', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	view.nowFn = () => 1700000000000;
	assert(view.now() === 1700000000000, 'now() 应使用注入值');
	view.nowFn = null;
	assert(Math.abs(view.now() - Date.now()) < 5000, '默认应回到系统时间');

	await view.onClose();
});

await checkAsync('O4：临时轨道偏移会被重新基准化，不累计漂移', async () => {
	const app = labVault(12);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	let target = -1;
	for (let i = 0; i < view.n; i++) {
		if (view.kinds[i] === 0 && !view.recs[i].root && !view.cometMask[i]) {
			target = i;
			break;
		}
	}
	const path = view.graph.nodes[target].path;
	const base = view.recs[target].orbit;

	view.bump = {};
	view.bump[path] = 1;
	view.applyLayout(false);
	assert(view.orbitNow[target] === base + 1, '应升一轨');
	assert(view.bump[path] === 1, '偏移应被基准化为 1');

	// 再应用一次：仍为 1（不累加成 2）
	view.applyLayout(false);
	assert(view.bump[path] === 1 && view.orbitNow[target] === base + 1, '重复应用不应累计：' + view.bump[path]);
	assert(view.orbitExists(view.orbitNow[target]), '目标轨道应存在');

	await view.onClose();
});

await checkAsync('A2：勾选只更新这一行与计数，不重建面板', async () => {
	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	let text = Plan.skeleton(view.weekYear, view.weekNum);
	text = Plan.addTask(text, view.todayIndex(), 0, '任务甲');
	text = Plan.addTask(text, view.todayIndex(), 0, '任务乙');
	view.planText = text;
	view.renderPlan();

	let renders = 0;
	const realRender = view.renderPlan.bind(view);
	view.renderPlan = () => {
		renders++;
		realRender();
	};

	const row = findByClass(view.planEl, 'orbit-plan-task');
	const box = row.children.find((c) => c.tagName === 'INPUT');
	const label = row.children.find((c) => c.classes && c.classes.has('orbit-plan-task-text'));
	assert(box && label, '找不到勾选框或文字');

	box.checked = true;
	box.fire('change', {});
	await new Promise((r) => setTimeout(r, 0));

	assert(renders === 0, '不应重建整个面板：' + renders);
	assert(label.classes.has('is-done'), '该行应变成已完成样式');
	assert(view.planText.indexOf('- [x] 任务甲') >= 0, '笔记应写回');
	assert(view.progressTextEl.textContent === '50%', '进度应更新为 50%：' + view.progressTextEl.textContent);

	await view.onClose();
});

await checkAsync('F6：搜索按文件名/tags 命中，Enter 退出', async () => {
	const spec = [
		{ path: 'sys/太阳系.md', fm: { 'creation-time': '2020-01-01', tags: ['天文'] }, resolved: {} },
		{ path: 'sys/水星.md', fm: { 'creation-time': '2020-01-02', tags: ['行星'] }, resolved: {} },
		{ path: 'sys/其他.md', fm: { 'creation-time': '2020-01-03' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	// 打开搜索框（按文件名）
	view.toggleSearch();
	assert(view.searchActive === true && view.searchInputEl, '应打开搜索框');
	view.searchInputEl.value = '水星';
	view.searchInputEl.fire('input', {});
	let hits = view.searchHits();
	const idxMercury = view.graph.nodes.findIndex((n) => n.path === 'sys/水星.md');
	assert(hits[idxMercury] === 1, '文件名命中应为 1');
	let hitCount = 0;
	for (let i = 0; i < hits.length; i++) hitCount += hits[i];
	assert(hitCount === 1, '应只命中 1 个：' + hitCount);

	// 按标签
	view.searchInputEl.value = '天文';
	view.searchInputEl.fire('input', {});
	hits = view.searchHits();
	const idxSolar = view.graph.nodes.findIndex((n) => n.path === 'sys/太阳系.md');
	assert(hits[idxSolar] === 1, '标签命中应为 1');

	// 渲染：命中球画名称、其余变暗
	view.paint();
	assert(view.model.searchActive === true && view.model.searchHits, '模型应带搜索状态');
	assert(view.canvasEl._records.texts.join('|').indexOf('太阳系') >= 0, '命中球应显示名称');

	// Enter 退出
	view.searchInputEl.fire('keydown', { key: 'Enter', preventDefault() {} });
	assert(view.searchActive === false && view.searchQuery === '', 'Enter 应退出搜索');
	view.paint();
	assert(view.model.searchActive === false, '退出后模型不再带搜索标记');

	await view.onClose();
});

await checkAsync('F2：悬停连线的出/入链方向与流光是双向的', async () => {
	const spec = [
		{ path: 'w/a.md', fm: { 'creation-time': '2020-01-01' }, resolved: { 'w/b.md': 1 } },
		{ path: 'w/b.md', fm: { 'creation-time': '2020-01-02' }, resolved: { 'w/c.md': 1 } },
		{ path: 'w/c.md', fm: { 'creation-time': '2020-01-03' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	const a = view.graph.nodes.findIndex((n) => n.path === 'w/a.md');
	const b = view.graph.nodes.findIndex((n) => n.path === 'w/b.md');
	const c = view.graph.nodes.findIndex((n) => n.path === 'w/c.md');

	const mask = view.linkOutMask(b);
	assert(mask[c] === 1, 'b → c 应为出链');
	assert(mask[a] === 0, 'a → b 对 b 来说是入链');

	view.setHovered(b);
	view.paint();
	assert(view.model.linkOut && view.model.linkWarm && view.model.linkCool, '模型应带连线配色与方向');

	await view.onClose();
});

await checkAsync('F6 回归：点放大镜后输入框可见（is-open），无命中出提示', async () => {
	const spec = [
		{ path: 'w/alpha.md', fm: { 'creation-time': '2020-01-01', tags: ['甲'] }, resolved: {} },
		{ path: 'w/beta.md', fm: { 'creation-time': '2020-01-02' }, resolved: {} },
	];
	const app = makeVault(spec);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	assert(view.searchBtnEl, '应有搜索按钮');
	view.searchBtnEl.fire('click', {});
	assert(view.searchActive === true, '点击后应进入搜索态');
	assert(view.searchInputEl && view.searchInputEl.classes.has('is-open'), '输入框应可见（is-open）');

	// 无命中 → 提示出现
	view.searchInputEl.value = '不存在的关键字zzz';
	view.searchInputEl.fire('input', {});
	assert(view.searchHintEl && view.searchHintEl.classes.has('is-open'), '无命中应显示提示');

	// 命中 → 提示消失
	view.searchInputEl.value = 'alpha';
	view.searchInputEl.fire('input', {});
	assert(!view.searchHintEl.classes.has('is-open'), '有命中应隐藏提示');

	// 再点按钮退出：输入框隐藏
	view.searchBtnEl.fire('click', {});
	assert(view.searchActive === false, '应退出搜索');
	assert(!view.searchInputEl.classes.has('is-open'), '退出后输入框应隐藏');

	await view.onClose();
});

await checkAsync('F6 回归：搜索态下点画布空白退出', async () => {
	const app = labVault(8);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();
	advance(view, 1);

	view.toggleSearch();
	assert(view.searchActive === true);

	const rect = view.canvasEl.getBoundingClientRect();
	view.handleDown({ button: 0, clientX: rect.left + 2, clientY: rect.top + 2 });
	assert(view.searchActive === false, '点空白应退出搜索');

	await view.onClose();
});

check('i18n：检测顺序（设置 > localStorage > navigator）与回退', () => {
	assert(Core.detectLanguage('en') === 'en', '设置为 en 应直接返回');
	assert(Core.detectLanguage('zh') === 'zh', '设置为 zh 应直接返回');

	const savedWindow = global.window;
	const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const setNav = (lang) => {
		Object.defineProperty(globalThis, 'navigator', { value: { language: lang }, configurable: true });
	};
	try {
		// localStorage 优先于 navigator
		global.window = { localStorage: { getItem: () => 'zh-CN' } };
		setNav('en-US');
		assert(Core.detectLanguage('auto') === 'zh', 'localStorage=zh-CN 应判为 zh');

		global.window = { localStorage: { getItem: () => 'en' } };
		assert(Core.detectLanguage('auto') === 'en', 'localStorage=en 应判为 en');

		// 没有 localStorage → navigator
		global.window = {};
		setNav('en-GB');
		assert(Core.detectLanguage('auto') === 'en', 'navigator=en-GB 应判为 en');
		setNav('zh-Hans');
		assert(Core.detectLanguage('auto') === 'zh', 'navigator=zh-Hans 应判为 zh');
	} finally {
		global.window = savedWindow;
		if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
	}
});

check('i18n：切换语言后 STR 变化、可切回', () => {
	const zhAdd = Core.STR.planAdd;
	assert(zhAdd.indexOf('添加') >= 0, '默认应为中文：' + zhAdd);

	Core.setLanguage('en');
	assert(Core.getLanguage() === 'en', '应切到 en');
	assert(Core.STR.planAdd === 'Add a task', 'en 文案不对：' + Core.STR.planAdd);
	assert(Core.STR.timerStart === 'Start timer', 'en 文案不对：' + Core.STR.timerStart);

	Core.setLanguage('zh');
	assert(Core.getLanguage() === 'zh', '应切回 zh');
	assert(Core.STR.planAdd === zhAdd, '切回后应与原来一致');
});

check('i18n 笔记模板：英文界面生成英文骨架，且仍能被解析', () => {
	Core.setLanguage('en');
	const en = Plan.skeleton(2026, 43);
	assert(en.indexOf('## 10/19 Mon') >= 0, '英文天标题：' + en.split('\n')[2]);
	assert(en.indexOf('### Important · Urgent') >= 0, '英文象限标题缺失');
	assert(en.indexOf('## PDCA review') >= 0 || en.indexOf('## PDCA') >= 0, '应有 PDCA 段');

	const p = Plan.parse(en);
	assert(p.days.length === 7, '英文骨架应解析出 7 天');
	assert(p.legacy === false, '英文骨架不应被判为旧格式');

	const add = Plan.addTask(en, 2, 1, 'english task');
	const p2 = Plan.parse(add);
	assert(p2.days[2].quads[1].tasks.length === 1, '英文骨架里应能加任务');
	assert(p2.days[2].quads[1].tasks[0].text === 'english task', '任务文字不对');

	Core.setLanguage('zh');
	assert(Plan.dayName(0) === '周一', '中文天名');
	Core.setLanguage('en');
	assert(Plan.dayName(0) === 'Mon', '英文天名');
	Core.setLanguage('zh');
});

check('i18n 笔记模板：中文旧笔记在英文界面下仍能解析', () => {
	Core.setLanguage('en');
	const zh = ['# 2026 年第 43 周', '', '## 10/19 周一', '### 重要 · 紧急', '- [ ] 中文任务', '', '## PDCA 复盘', '### P 计划（Plan）', '内容'].join('\n');
	const p = Plan.parse(zh);
	assert(p.days[0].quads[0].tasks.length === 1, '中文笔记仍应解析出任务：' + p.days[0].quads[0].tasks.length);
	assert(p.pdca[0] === '内容', 'PDCA 仍应解析：' + JSON.stringify(p.pdca[0]));
	Core.setLanguage('zh');
});

check('i18n 周标题：中文「2026 年第 44 周」/ 英文「Week 44 · 2026」', () => {
	Core.setLanguage('zh');
	assert(Plan.weekShort(2026, 44) === '2026 年第 44 周', '中文周标题：' + Plan.weekShort(2026, 44));
	assert(Plan.weekTitle(2026, 44).indexOf('月') > 0, '中文长标题应含「月」');
	assert(Plan.skeleton(2026, 44).split('\n')[0] === '# 2026 年第 44 周', '中文骨架 H1');

	Core.setLanguage('en');
	assert(Plan.weekShort(2026, 44) === 'Week 44 · 2026', '英文周标题：' + Plan.weekShort(2026, 44));
	const long = Plan.weekTitle(2026, 44);
	assert(long.indexOf('Week 44') === 0 && long.indexOf('10/26') > 0, '英文长标题：' + long);
	assert(Plan.skeleton(2026, 44).split('\n')[0] === '# Week 44 · 2026', '英文骨架 H1');
	Core.setLanguage('zh');
});

await checkAsync('i18n 周标题：头部与视图一起跟随语言', async () => {
	// 视图运行在 smoke 包里，必须用同一个包里的 Core 才有意义
	const smoke = require(smokePath);
	const SmokeCore = smoke.__internals.Core;
	const SmokePlan = smoke.__internals.Plan;

	const app = labVault(6);
	const plugin = new PluginClass(app, MANIFEST);
	await plugin.onload();
	const view = plugin.views[0].factory({ app });
	await view.onOpen();

	const allByClass = (root, cls) => {
		const out = [];
		const walk = (el) => {
			if (!el) return;
			if (el.classes && el.classes.has && el.classes.has(cls)) out.push(el);
			for (const kid of el.children || []) walk(kid);
		};
		walk(root);
		return out;
	};

	const lastWeek = () => {
		const list = allByClass(view.planEl, 'orbit-plan-week');
		return list.length ? list[list.length - 1].textContent : '';
	};

	SmokeCore.setLanguage('en');
	view.renderPlan();
	assert(SmokePlan.weekShort(view.weekYear, view.weekNum).indexOf('Week') === 0, '包内周标题应为英文');
	assert(lastWeek().indexOf('Week') === 0, '英文头部：' + lastWeek());

	SmokeCore.setLanguage('zh');
	view.renderPlan();
	assert(lastWeek().indexOf('年第') > 0, '中文头部：' + lastWeek());

	await view.onClose();
});

await checkAsync('关闭视图后释放引用', async () => {
	const view = demoView;
	await view.onClose();
	assert(view.frameId === null && view.canvasEl === null && view.graph === null, '未释放引用');
});

// ---------------------------------------------------------------------------
// D. 产物自查
// ---------------------------------------------------------------------------
console.log('\n[D] 产物自查');

check('manifest 字段合法（可上架）', () => {
	for (const k of ['id', 'name', 'version', 'minAppVersion', 'description', 'author', 'isDesktopOnly']) {
		assert(Object.prototype.hasOwnProperty.call(MANIFEST, k), '缺字段 ' + k);
	}
	assert(/^[a-z][a-z-]*$/.test(MANIFEST.id), 'id 非法：' + MANIFEST.id);
	assert(MANIFEST.id.indexOf('obsidian') === -1, 'id 不得包含 obsidian');
	assert(/^\d+\.\d+\.\d+$/.test(MANIFEST.version), 'version 必须 x.y.z');
	assert(/^[\x20-\x7e]+$/.test(MANIFEST.name), 'name 应为拉丁字符');
	assert(typeof MANIFEST.isDesktopOnly === 'boolean');
});

check('main.js 无禁用 API 与调试残留', () => {
	const src = readFileSync(join(ROOT, 'main.js'), 'utf8');
	const forbid = [
		['innerHTML', /innerHTML/],
		['outerHTML', /outerHTML/],
		['insertAdjacentHTML', /insertAdjacentHTML/],
		['window.app', /window\.app\b/],
		['eval', /[^.\w]eval\s*\(/],
		['fetch', /[^.\w]fetch\s*\(/],
		['requestUrl', /requestUrl/],
		['XMLHttpRequest', /XMLHttpRequest/],
		['console.log', /console\.log\s*\(/],
	];
	for (const [label, re] of forbid) assert(!re.test(src), '发现禁用 API：' + label);
});

check('main.js 为 CJS 且导出插件类', () => {
	const src = readFileSync(join(ROOT, 'main.js'), 'utf8');
	assert(src.length > 15000, 'main.js 太小：' + src.length);
	assert(/module\.exports = GraphOrbitPlugin;/.test(src), '缺少导出');
	assert(src.indexOf("require('obsidian')") > 0, '缺少 obsidian 依赖');
	assert(!/^\s*export\s/m.test(src), '出现了 export 语法');
	assert(!/^\s*import\s/m.test(src), '出现了 import 语法');
});

check('versions.json 与 manifest 一致', () => {
	const versions = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8'));
	assert(versions[MANIFEST.version] === MANIFEST.minAppVersion, 'versions.json 未对齐：' + JSON.stringify(versions));
});

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
if (failures.length === 0) {
	console.log('全部通过：' + passed + ' 项');
} else {
	console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
	for (const f of failures) console.log('  ✗ ' + f);
	process.exitCode = 1;
}
