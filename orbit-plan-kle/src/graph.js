// ============================================================================
// graph.js — 从 vault 建图（Markdown + PDF），不再有标签层
//
// 节点：.md 与 .pdf。
// 关系：md↔md 用 metadataCache.resolvedLinks（无向去重）；
//       md→pdf 用 cache.links / cache.embeds 逐个解析。
// 时间：优先 frontmatter 的 creation-time，缺失时回退文件系统 ctime。
// 中心：md 中双链连接数最多者（PDF 不参与）。
//
// 纯逻辑：只接收 app 门面，不 import obsidian，可在 Node 里用假 app 断言。
// ============================================================================
const GraphBuilder = (function () {
	const KIND_MD = 'md';
	const KIND_PDF = 'pdf';

	function isDate(v) {
		return Object.prototype.toString.call(v) === '[object Date]';
	}

	/**
	 * 把 frontmatter 的时间值归一化成毫秒时间戳。
	 * 兼容：Date 对象、"2024-03-05"、"2024-03-05 14:30"、"2024/3/5"、ISO 串、
	 * 秒级/毫秒级数字时间戳。
	 * @returns {number|null}
	 */
	function parseDate(value) {
		if (value === null || value === undefined) return null;

		if (isDate(value)) {
			const t = value.getTime();
			return isFinite(t) ? t : null;
		}

		if (typeof value === 'number') {
			if (!isFinite(value)) return null;
			return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
		}

		const raw = String(value).trim();
		if (!raw) return null;

		// 统一分隔：2024/3/5 → 2024-3-5，空格时间 → T
		let normalized = raw.replace(/[./]/g, '-').replace(/\s+/, 'T');
		// 把 2024-3-5 补成 2024-03-05，避免非 ISO 日期按本地时区解析
		normalized = normalized.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/, (m, y, mo, d, rest) => {
			return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') + rest;
		});

		let t = Date.parse(normalized);
		if (isFinite(t)) return t;

		t = Date.parse(raw);
		if (isFinite(t)) return t;

		// 只有年月（2024-03）时补日
		const ym = /^(\d{4})-(\d{1,2})$/.exec(normalized);
		if (ym) {
			t = Date.parse(ym[1] + '-' + ym[2] + '-01');
			if (isFinite(t)) return t;
		}
		return null;
	}

	function frontmatterOf(app, file) {
		try {
			const cache = app.metadataCache.getFileCache(file);
			return (cache && cache.frontmatter) || null;
		} catch (e) {
			return null;
		}
	}

	/** frontmatter 的 title；缺失时回退文件名（不含扩展名） */
	function titleOf(app, file) {
		const fm = frontmatterOf(app, file);
		if (fm) {
			const raw = fm.title;
			if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
			if (typeof raw === 'number' && isFinite(raw)) return String(raw);
			if (Array.isArray(raw)) {
				for (let i = 0; i < raw.length; i++) {
					const v = raw[i];
					if (typeof v === 'string' && v.trim().length > 0) return v.trim();
					if (typeof v === 'number' && isFinite(v)) return String(v);
				}
			}
		}
		return file.basename;
	}

	function creationOf(app, file) {
		const fm = frontmatterOf(app, file);
		if (fm) {
			const parsed = parseDate(fm['creation-time']);
			if (parsed !== null) return parsed;
		}
		const stat = file.stat || {};
		return typeof stat.ctime === 'number' ? stat.ctime : 0;
	}

	/** frontmatter 的 tags：数组或逗号/空格分隔的字符串都认；去重、最多 limit 个 */
	function tagsOf(app, file, limit) {
		const fm = frontmatterOf(app, file);
		const raw = fm && fm.tags;
		if (raw === undefined || raw === null) return [];
		let list = [];
		if (Array.isArray(raw)) list = raw;
		else list = String(raw).split(/[,;，；\s]+/);
		const out = [];
		const seen = new Set();
		for (let i = 0; i < list.length; i++) {
			const t = String(list[i] === null || list[i] === undefined ? '' : list[i]).trim().replace(/^#/, '');
			if (!t || seen.has(t)) continue;
			seen.add(t);
			out.push(t);
			if (out.length >= limit) break;
		}
		return out;
	}

	/**
	 * @param {object} app Obsidian App（用到 vault 与 metadataCache 两个门面）
	 */
	function buildGraph(app) {
		const all = app.vault.getFiles ? app.vault.getFiles() : app.vault.getMarkdownFiles() || [];
		const files = [];
		for (let i = 0; i < all.length; i++) {
			const ext = String(all[i].extension || '').toLowerCase();
			if (ext === 'md' || ext === 'pdf') files.push(all[i]);
		}

		const n = files.length;
		const nodes = new Array(n);
		const index = new Map();
		const pdfIndex = new Map();

		for (let i = 0; i < n; i++) {
			const f = files[i];
			const ext = String(f.extension || '').toLowerCase();
			const kind = ext === 'pdf' ? KIND_PDF : KIND_MD;
			const stat = f.stat || {};
			nodes[i] = {
				path: f.path,
				kind,
				name: f.basename,
				label: kind === KIND_PDF ? f.basename : titleOf(app, f),
				ctime: kind === KIND_PDF ? (typeof stat.ctime === 'number' ? stat.ctime : 0) : creationOf(app, f),
				size: typeof stat.size === 'number' ? stat.size : 0,
				degree: 0,
			};
			index.set(f.path, i);
			if (kind === KIND_PDF) pdfIndex.set(f.path, i);
		}

		const seen = new Set();
		const edges = [];
		const degrees = new Int32Array(n);

		const addEdge = (a, b) => {
			if (a === b) return;
			const key = a < b ? a + ',' + b : b + ',' + a;
			if (seen.has(key)) return;
			seen.add(key);
			edges.push([a, b]);
			degrees[a]++;
			degrees[b]++;
		};

		// md ↔ md：无向边（按对去重），大小按唯一邻居数（与 1.0.0 一致）
		const resolved = app.metadataCache.resolvedLinks || {};
		for (const sourcePath in resolved) {
			const a = index.get(sourcePath);
			if (a === undefined || nodes[a].kind !== KIND_MD) continue;
			const targets = resolved[sourcePath];
			if (!targets) continue;
			for (const targetPath in targets) {
				const b = index.get(targetPath);
				if (b === undefined) continue;
				if (nodes[b].kind !== KIND_MD) continue;
				addEdge(a, b);
			}
		}

		// md → pdf
		if (pdfIndex.size > 0 && typeof app.metadataCache.getFirstLinkpathDest === 'function') {
			for (let i = 0; i < n; i++) {
				if (nodes[i].kind !== KIND_MD) continue;
				let cache = null;
				try {
					cache = app.metadataCache.getFileCache(files[i]);
				} catch (e) {
					cache = null;
				}
				if (!cache) continue;
				const items = [];
				if (Array.isArray(cache.links)) items.push.apply(items, cache.links);
				if (Array.isArray(cache.embeds)) items.push.apply(items, cache.embeds);
				for (let k = 0; k < items.length; k++) {
					const link = items[k] && items[k].link;
					if (!link || String(link).toLowerCase().indexOf('.pdf') === -1) continue;
					let dest = null;
					try {
						dest = app.metadataCache.getFirstLinkpathDest(link, nodes[i].path);
					} catch (e) {
						dest = null;
					}
					if (!dest) continue;
					const b = pdfIndex.get(dest.path);
					if (b === undefined) continue;
					addEdge(i, b);
				}
			}
		}

		for (let i = 0; i < n; i++) nodes[i].degree = degrees[i];

		// 标签卫星：每篇 md 最多 3 个，彗星宿主由视图层过滤
		const satellites = [];
		const SAT_LIMIT = 3;
		for (let i = 0; i < n; i++) {
			if (nodes[i].kind !== KIND_MD) continue;
			const tags = tagsOf(app, files[i], SAT_LIMIT);
			for (let k = 0; k < tags.length; k++) {
				satellites.push({
					host: i,
					tag: tags[k],
					index: k,
					count: tags.length,
					phase0: Core.unitHash(i * 71 + 7) * Core.TAU, // 每个宿主的固定偏移
				});
			}
		}

		// 中心：只在 md 中选，连接数最多；并列取创建更早、再取路径
		let center = -1;
		for (let i = 0; i < n; i++) {
			if (nodes[i].kind !== KIND_MD) continue;
			if (center < 0) {
				center = i;
				continue;
			}
			const a = nodes[i];
			const b = nodes[center];
			if (a.degree !== b.degree) {
				if (a.degree > b.degree) center = i;
			} else if (a.ctime !== b.ctime) {
				if (a.ctime < b.ctime) center = i;
			} else if (Core.compareText(a.path, b.path) < 0) {
				center = i;
			}
		}

		return { nodes, edges, index, center, satellites };
	}

	return { buildGraph, parseDate, creationOf, titleOf, KIND_MD, KIND_PDF };
})();
