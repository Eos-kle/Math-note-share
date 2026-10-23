// ============================================================================
// palette.js — 色系定义与「按半径取色」的解析
//
// 两套色系，色标按「最外圈 → 中心」排列：外圈取首色（最浅），中心取末色（最深）。
// 由 Core.rampColor 在色标之间线性插值。纯逻辑，不依赖 obsidian。
// ============================================================================
const Palette = (function () {
	const SCHEMES = [
		{ id: 'purple', label: '粉紫 → 深紫', stops: ['#EBCFE4', '#CE9BC7', '#9B62A8', '#4E2A66'] },
		{ id: 'red', label: '浅红 → 玫红', stops: ['#F7D9D9', '#D88090', '#DD4E70'] },
		{ id: 'teal', label: '浅青 → 墨绿', stops: ['#D7EFEA', '#8FCFC4', '#3F9B90', '#1E4F4A'] },
		{ id: 'amber', label: '米黄 → 赭石', stops: ['#F8E6C8', '#E8BE86', '#C4854A', '#6B3E1E'] },
		// 太阳系：外圈冷（海王星深蓝）→ 中心暖（太阳金）
		{ id: 'solar', label: '太阳系（外冷内暖）', stops: ['#1B3A5C', '#2C6285', '#4E9FA6', '#C98C3C', '#E8A33D', '#F2C14E'] },
	];

	// 两套"杂色"：不按半径渐变，而是多个明显不同的颜色
	const MULTI = [
		{
			id: 'neon',
			label: '霓虹轨道（按轨道）',
			mode: 'orbit',
			stops: ['#E0556B', '#E8913A', '#E0C23A', '#4FB477', '#3F8FD1', '#8E5BC9'],
		},
		{
			id: 'candy',
			label: '糖果星云（按笔记）',
			mode: 'hash',
			stops: ['#F2A6B3', '#F7C99A', '#F2E39A', '#A8DDB5', '#A6C8F0', '#C3AEE8'],
		},
		{
			id: 'deep',
			label: '深海霓虹（按轨道）',
			mode: 'orbit',
			stops: ['#2F6E7C', '#33578C', '#4A4691', '#7A4062', '#8A4E2A', '#3B4757'],
		},
		{
			id: 'planets',
			label: '行星轨道（水星→海王星）',
			mode: 'orbit',
			stops: ['#8C7B6B', '#D9A05B', '#3F7FBF', '#B5523B', '#C9A67B', '#D8C08A', '#7FC6D9', '#3B5FA8', '#F2C14E'],
		},
		{
			id: 'midnight',
			label: '午夜星云（按笔记）',
			mode: 'hash',
			stops: ['#6A5478', '#4E6288', '#557066', '#7C6147', '#6E4E5E', '#43505F'],
		},
	];
	for (const m of MULTI) SCHEMES.push(m);

	function byId(id) {
		for (let i = 0; i < SCHEMES.length; i++) {
			if (SCHEMES[i].id === id) return SCHEMES[i];
		}
		return SCHEMES[0];
	}

	function exists(id) {
		for (let i = 0; i < SCHEMES.length; i++) {
			if (SCHEMES[i].id === id) return true;
		}
		return false;
	}

	function options() {
		const out = {};
		for (let i = 0; i < SCHEMES.length; i++) out[SCHEMES[i].id] = SCHEMES[i].label;
		return out;
	}

	function stopsOf(settings) {
		return byId(settings && settings.scheme).stops;
	}

	/**
	 * 解析每个节点的最终颜色：单节点自定义颜色优先，否则按半径归一化取色。
	 * 方向为「由外向内」：半径最大 → 首色（最浅），半径最小 → 末色（最深）。
	 * @param {Array<{path:string}>} nodes
	 * @param {Float64Array|number[]} radii
	 * @param {object} settings
	 * @returns {string[]}
	 */
	function resolve(nodes, radii, settings) {
		const stops = stopsOf(settings);
		const overrides = (settings && settings.colors) || {};
		const n = nodes.length;

		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < n; i++) {
			const r = radii[i];
			if (r < lo) lo = r;
			if (r > hi) hi = r;
		}
		const span = hi - lo;

		const scheme = byId(settings && settings.scheme);
		const mode = scheme.mode || 'ramp';

		// 杂色·按轨道：把唯一半径排序，作为"轨道序号"
		let radiusRank = null;
		if (mode === 'orbit') {
			const uniq = [];
			for (let i = 0; i < n; i++) {
				if (uniq.indexOf(radii[i]) < 0) uniq.push(radii[i]);
			}
			uniq.sort((a, b) => a - b);
			radiusRank = new Map();
			for (let k = 0; k < uniq.length; k++) radiusRank.set(uniq[k], k);
		}

		const out = new Array(n);
		for (let i = 0; i < n; i++) {
			const path = nodes[i].path;
			const custom = Object.prototype.hasOwnProperty.call(overrides, path) ? overrides[path] : null;
			if (custom) {
				out[i] = custom;
				continue;
			}
			// 中心球（半径最小）固定取该方案最深色，杂色方案也遵守这个语义
			const isCenter = radii[i] <= lo + 1e-9;
			if (isCenter) {
				out[i] = stops[stops.length - 1];
				continue;
			}
			if (mode === 'orbit') {
				const rank = radiusRank.get(radii[i]) || 0;
				out[i] = stops[rank % stops.length];
				continue;
			}
			if (mode === 'hash') {
				const h = Core.unitHash(String(path).split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 100003, 7));
				out[i] = stops[Math.floor(h * stops.length) % stops.length];
				continue;
			}
			const inner = span > 0.0001 ? (radii[i] - lo) / span : 0.5; // 0=中心, 1=外圈
			out[i] = Core.rampColor(stops, 1 - inner); // 由外向内：外圈取首色
		}
		return out;
	}

	return { SCHEMES, byId, exists, options, stopsOf, resolve };
})();
