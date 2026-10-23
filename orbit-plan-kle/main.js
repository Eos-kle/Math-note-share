/*!
 * Orbit Plan — Obsidian 关系图谱 + 每周计划插件
 * 构建产物，请勿直接修改；源码在 src/，用 `node build.mjs` 重新生成。
 */
'use strict';
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, Modal, debounce, setIcon } = require('obsidian');

// ---- src/core.js ----
// ============================================================================
// core.js — 通用数学/文本/颜色工具与全部中文文案
// 该模块不依赖 obsidian，可在 Node 里直接跑断言。
// ============================================================================
const Core = (function () {
	const TAU = Math.PI * 2;

	const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
	const lerp = (a, b, t) => a + (b - a) * t;

	/** 取最短角差，结果落在 (-PI, PI]，避免 359° → 1° 绕远路 */
	function angleDelta(from, to) {
		let d = (to - from) % TAU;
		if (d > Math.PI) d -= TAU;
		if (d < -Math.PI) d += TAU;
		return d;
	}

	/** 黄金比小数部分，用作确定性伪随机（同一输入永远同一结果） */
	function unitHash(i) {
		const x = (i + 1) * 0.6180339887498949;
		return x - Math.floor(x);
	}

	// 文本排序：创建时间相同时的稳定次序（路径按拼音/字典序）
	let collatorCache = null;
	let collatorTried = false;

	function collator() {
		if (collatorTried) return collatorCache;
		collatorTried = true;
		try {
			collatorCache = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
		} catch (e) {
			collatorCache = null;
		}
		return collatorCache;
	}

	function compareText(a, b) {
		const sa = String(a == null ? '' : a);
		const sb = String(b == null ? '' : b);
		const c = collator();
		if (c) {
			const r = c.compare(sa, sb);
			if (r !== 0) return r < 0 ? -1 : 1;
		}
		return sa < sb ? -1 : sa > sb ? 1 : 0;
	}

	// ---- 拼音首字母 -------------------------------------------------------
	// 不引字典：用系统自带的 zh 排序表，对 23 个「区间起点字」做比较，
	// 落在哪一段就是哪个首字母。
	const PY_BOUNDARY = [
		['A', '阿'],
		['B', '八'],
		['C', '擦'],
		['D', '搭'],
		['E', '蛾'],
		['F', '发'],
		['G', '噶'],
		['H', '哈'],
		['J', '击'],
		['K', '喀'],
		['L', '拉'],
		['M', '妈'],
		['N', '拿'],
		['O', '哦'],
		['P', '啪'],
		['Q', '期'],
		['R', '然'],
		['S', '撒'],
		['T', '塌'],
		['W', '挖'],
		['X', '昔'],
		['Y', '压'],
		['Z', '匝'],
	];

	/** 单个字符的首字母：汉字→拼音首字母，字母→大写，其它→'#' */
	function pinyinInitial(ch) {
		const c = String(ch == null ? '' : ch).charAt(0);
		if (!c) return '#';
		if (/[a-zA-Z]/.test(c)) return c.toUpperCase();
		if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(c)) return '#';
		const coll = collator();
		if (!coll) return '#';
		let out = '#';
		for (let i = 0; i < PY_BOUNDARY.length; i++) {
			if (coll.compare(PY_BOUNDARY[i][1], c) <= 0) out = PY_BOUNDARY[i][0];
		}
		return out;
	}

	/** 文件名「最后一个词」的首字母（按空格 / _ / - / · / . 切词） */
	function lastWordInitial(name) {
		const base = String(name == null ? '' : name).replace(/\.[^.]+$/, '');
		const parts = base.split(/[\s_\-·.]+/).filter(Boolean);
		const last = parts.length ? parts[parts.length - 1] : base;
		return pinyinInitial(last);
	}

	/** 比较顺序：第 1 个字符 → 最后 1 个 → 倒数第 2 个 → … */
	function charOrder(len) {
		const out = [];
		if (len > 0) out.push(0);
		for (let i = len - 1; i >= 1; i--) out.push(i);
		return out;
	}

	/**
	 * 彗星选人用的比较器：先比首字符，首字符相同再从尾部倒着比，
	 * 最后才退化成整串比较（调用方再退到路径，保证确定性）。
	 */
	function compareByFirstAndTail(a, b) {
		const sa = String(a == null ? '' : a);
		const sb = String(b == null ? '' : b);
		if (sa === sb) return 0;

		const oa = charOrder(sa.length);
		const ob = charOrder(sb.length);
		const n = Math.min(oa.length, ob.length);
		for (let i = 0; i < n; i++) {
			const r = compareText(sa.charAt(oa[i]), sb.charAt(ob[i]));
			if (r !== 0) return r;
		}
		if (oa.length !== ob.length) return oa.length < ob.length ? -1 : 1;
		return compareText(sa, sb);
	}

	// ------------------------------------------------------------------------
	// 颜色
	// ------------------------------------------------------------------------
	function hexToRgb(hex) {
		let h = String(hex || '').replace('#', '').trim();
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		const n = parseInt(h, 16);
		if (!isFinite(n)) return { r: 128, g: 128, b: 128 };
	

	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
	}

	function rgbToHex(r, g, b) {
		const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
		return '#' + c(r) + c(g) + c(b);
	}

	function mixHex(a, b, t) {
		const A = hexToRgb(a);
		const B = hexToRgb(b);
		return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
	}

	/** 多段色带取色，t ∈ [0,1]；t=0 取首段（中心），t=1 取末段（外圈） */
	function rampColor(stops, t) {
		if (!stops || stops.length === 0) return '#888888';
		if (stops.length === 1) return stops[0];
		const x = clamp(t, 0, 1) * (stops.length - 1);
		if (x <= 0) return stops[0];
		if (x >= stops.length - 1) return stops[stops.length - 1];
		const i = Math.min(Math.floor(x), stops.length - 2);
		return mixHex(stops[i], stops[i + 1], x - i);
	}

	function parseCssColor(str) {
		const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(str || ''));
		if (!m) return { r: 140, g: 140, b: 140 };
		return { r: +m[1], g: +m[2], b: +m[3] };
	}

	const rgba = (c, a) => 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + a + ')';

	// ------------------------------------------------------------------------
	// 界面文案：集中一处，后续要加英文只需替换这张表
	// ------------------------------------------------------------------------
	const STR_ZH = {
		viewTitle: '关系图谱',
		openView: '打开关系图谱',
		commandOpen: '打开关系图谱视图',

		emptyTitle: '这个仓库里还没有 Markdown 或 PDF 文件',
		noLinkHint: '笔记与 PDF 都会出现在图上；越早创建的笔记越靠近中心',
		pausedHint: '已暂停 · 按空格继续',

		colorTitle: '节点颜色',
		colorDesc: '选一个颜色，只作用于这个节点；「恢复色系」会回到按半径渐变的配色。',
		colorApply: '应用',
		colorClear: '恢复色系',
		colorCancel: '取消',

		noticeFail: '无法创建图谱视图',
		noticeRelayout: '已重新计算布局',
		noticeCleared: '已清除全部自定义颜色',
		noticeColorSet: '已为节点设置自定义颜色',
		noticeColorCleared: '已恢复该节点的色系配色',

		setScheme: '色系',
		setSchemeDesc: '节点颜色按「到中心的距离」渐变：中心取首色，最外圈取末色',
		setSpacing: '层间距',
		setSpacingDesc: '最外圈半径：越大球摆得越开，越小越紧凑',
		setSpin: '自转速度',
		setSpinDesc: '整体旋转速度（PDF 层按 0.28 倍跟随）；设为 0 即静止',
		setTrail: '轨迹长度',
		setTrailDesc: '节点身后那条淡尾巴有多长；设为 0 即关闭',
		setNodeScale: '节点大小',
		setNodeScaleDesc: '所有球体的统一缩放，不会小于屏幕 2.2px',
		setColors: '自定义颜色',
		setColorsDesc: '右键视图里的任意节点即可单独调色',
		setClearColors: '全部清除',
		setRepel: '球间斥力',
		setRepelDesc: '越大越会把挨在一起的球推开（0 关闭）；彗星与普通球参与程度相同',
		setClearPins: '轨道吸附',
		setClearPinsDesc: '被拖拽过的球会固定在吸附到的那条轨道上，这里可以一键还原',
		setClearPinsBtn: '清除全部吸附',
		noticePinsCleared: '已清除全部轨道吸附',

		// ---- 下半区：每周计划 ----
		dragDivider: '拖动调整上下比例',
		planThisWeek: '本周',
		planPrev: '上一周',
		planNext: '下一周',
		planOpenDoc: '打开本周计划文档',
		planMore: '更多',
		planClearPins: '清空拖拽记忆',
		planPinsCleared: '已清空拖拽记忆',
		planClearPinsAgain: '再点一次确认清空拖拽记忆',
		reactivated: '已重新激活星图',
		planMigrated: '旧格式计划已迁移为「按天」格式',
		planCarry: '迁移昨天未完成任务',
		planCarryTitle: '未完成任务记录',
		planCarryReason: '未完成原因',
		planCarryImprove: '预计改进方法',
		planCarryOk: '保存到本周 PDCA',
		planCarryCancel: '取消',
		planCarryEmpty: '真棒，没有未完成任务需要迁移哦',
		planCarryMonday: '今天是周一，没有前一天可迁移',
		planCarrySaved: '已写入本周 PDCA 复盘',
		planCarrySummary: '共 {n} 条未完成',
		planCarryReasonHint: '例如：临时有课 / 状态不好',
		planCarryImproveHint: '例如：提前排期 / 拆小任务',
		planTodayHint: '将写入本周 {day}',
		planOpenDocTip: '打开本周计划文档',
		planDocMissing: '已新建本周计划文档',
		planImport: '导入上周未完成',
		planAdd: '添加一个待办事项',
		planAddHint: '写点什么，回车保存',
		planEmpty: '本周还没有待办',
		planDelete: '删除这条',
		planPdca: 'PDCA 复盘',
		planJump: '点击跳到某一周',
		planJumpTitle: '跳到某一周',
		planYear: '年',
		planWeek: '周',
		planOk: '确定',
		planCancel: '取消',
		planNoPrev: '上一周的笔记还不存在',
		planNoUnfinished: '上一周没有未完成的任务',
		planImported: '已导入 {n} 条未完成任务',
		planSaveFail: '写入计划笔记失败，请在笔记里手动检查',

		// ---- 计时器 ----
		timerStart: '计时',
		timerStop: '停止',
		timerTitle: '开始计时',
		timerQuad: '象限',
		timerName: '计划名称',
		timerContent: '计划内容',
		timerNameHint: '例如：复习线代',
		timerContentHint: '例如：第三章课后题',
		timerOk: '确认并开始',
		timerCancel: '取消',
		timerNeedName: '请先填写计划名称',
		timerUsed: '（用时 {m} 分 {s} 秒）',
		timerCountdown: '倒计时（分钟）',
		timerCountdownHint: '留空 = 正计时',
		timerUnitMin: '分',
		timerUnitSec: '秒',
		timerUnitSecHint: '0–59',
		timerCountdownInvalid: '请输入 1–999 分钟',
		timerCancelDown: '已取消倒计时',
		searchTip: '搜索文件名或标签',
		searchHint: '文件名 / #标签',
		searchEmpty: '没有匹配的星体',
		timerDownUsed: '（计划用时 {pm} 分 {ps} 秒，实际用时 {am} 分 {as} 秒）',
		timerLost: '计划项已被修改或删除，用时未写入',

		setPlanFolder: '计划笔记位置',
		setPlanFolderDesc: '每周一篇笔记，按「目录/年/周.md」存放（留空则用 orbit-plan）',
		setSplit: '上下比例',
		setSplitDesc: '上半星图占整个视图高度的比例（也可直接拖动中间的分隔条）',
		setResetSplit: '恢复 55%',
		setLanguage: '语言',
		setLanguageDesc: '默认跟随 Obsidian 的界面语言',
		languageAuto: '跟随系统',
		languageZh: '中文',
		languageEn: 'English',
	};


	// ------------------------------------------------------------------
	// 多语言：STR 是「当前语言」的可变对象，切换时逐键覆盖
	// ------------------------------------------------------------------
	const STR_EN = {
		viewTitle: 'Orbit Plan',
		openView: 'Open Orbit Plan',
		commandOpen: 'Open orbit graph',
		emptyTitle: 'The vault is empty',
		noLinkHint: 'Create some notes with links to see the galaxy',
		pausedHint: 'Paused (Space)',
		colorTitle: 'Pick a color',
		colorDesc: 'This color only applies to the selected node',
		colorApply: 'Apply',
		colorClear: 'Reset',
		colorCancel: 'Cancel',
		noticeFail: 'Could not open the view',
		noticeRelayout: 'Layout rebuilt',
		noticeCleared: 'Custom colors cleared',
		noticeColorSet: 'Color applied',
		noticeColorCleared: 'Color reset',
		setScheme: 'Color scheme',
		setSchemeDesc: 'Gradient schemes shade by orbit; multi-color schemes assign distinct colors',
		setSpacing: 'Orbit spacing',
		setSpacingDesc: 'Scales the outer radius (wider = more space between rings)',
		setSpin: 'Rotation speed',
		setSpinDesc: 'Global multiplier for orbital motion',
		setTrail: 'Trail length',
		setTrailDesc: '0 = no trails',
		setNodeScale: 'Node scale',
		setNodeScaleDesc: 'Multiplier for node sizes',
		setColors: 'Custom colors',
		setColorsDesc: 'Right-click a node to give it its own color',
		setClearColors: 'Clear custom colors',
		setRepel: 'Repulsion',
		setRepelDesc: '0–1; 0 disables pushing (crowding promotion still works)',
		setClearPins: 'Orbit pins',
		setClearPinsDesc: 'Nodes you dragged stay on the snapped orbit; reset them here',
		setClearPinsBtn: 'Clear all pins',
		noticePinsCleared: 'All orbit pins cleared',
		dragDivider: 'Drag to resize',
		planThisWeek: 'This week',
		planPrev: 'Previous week',
		planNext: 'Next week',
		planOpenDoc: 'Open this week note',
		planMore: 'More',
		planClearPins: 'Clear orbit pins',
		planPinsCleared: 'Orbit pins cleared',
		planClearPinsAgain: 'Click again to confirm',
		reactivated: 'Galaxy reloaded',
		planMigrated: 'Plan migrated to the per-day format',
		planCarry: 'Move yesterday’s unfinished tasks',
		planCarryTitle: 'Unfinished tasks',
		planCarryReason: 'Reason',
		planCarryImprove: 'Improvement',
		planCarryOk: 'Save to PDCA',
		planCarryCancel: 'Cancel',
		planCarryEmpty: 'Great — nothing to move!',
		planCarryMonday: 'It is Monday; there is no previous day',
		planCarrySaved: 'Saved to this week’s PDCA',
		planCarrySummary: '{n} unfinished',
		planCarryReasonHint: 'e.g. ran out of time / got interrupted',
		planCarryImproveHint: 'e.g. start earlier / split the task',
		planTodayHint: 'Writes to {day} of this week',
		planOpenDocTip: 'Open this week note',
		planDocMissing: 'Created this week’s note',
		planImport: 'Import last week’s unfinished',
		planAdd: 'Add a task',
		planAddHint: 'Type and press Enter',
		planEmpty: 'Nothing planned yet',
		planDelete: 'Delete',
		planPdca: 'PDCA review',
		planJump: 'Jump to a week',
		planJumpTitle: 'Jump to week',
		planYear: 'Year',
		planWeek: 'Week',
		planOk: 'OK',
		planCancel: 'Cancel',
		planNoPrev: 'No note for last week',
		planNoUnfinished: 'Last week had no unfinished tasks',
		planImported: 'Imported {n} unfinished task(s)',
		planSaveFail: 'Could not write the plan note',
		timerStart: 'Start timer',
		timerStop: 'Stop',
		timerTitle: 'Start timer',
		timerQuad: 'Quadrant',
		timerName: 'Task name',
		timerContent: 'Details',
		timerNameHint: 'e.g. Linear algebra review',
		timerContentHint: 'e.g. chapter 3 exercises',
		timerOk: 'Start',
		timerCancel: 'Cancel',
		timerNeedName: 'Please enter a task name',
		timerUsed: ' (took {m} min {s} s)',
		timerCountdown: 'Countdown',
		timerCountdownHint: 'empty = count up',
		timerUnitMin: 'min',
		timerUnitSec: 's',
		timerUnitSecHint: '0–59',
		timerCountdownInvalid: 'Enter 1–999 minutes (seconds 0–59)',
		timerCancelDown: 'Countdown cancelled',
		searchTip: 'Search notes or tags',
		searchHint: 'file name / #tag',
		searchEmpty: 'No matching nodes',
		timerDownUsed: ' (planned {pm} min {ps} s, actual {am} min {as} s)',
		timerLost: 'The task was edited or removed; duration not written',
		setPlanFolder: 'Plan folder',
		setPlanFolderDesc: 'One note per week at <folder>/<year>/<week>.md',
		setSplit: 'Split ratio',
		setSplitDesc: 'Height share of the galaxy pane (or drag the divider)',
		setResetSplit: 'Reset to 55%',
		setLanguage: 'Language',
		setLanguageDesc: 'Auto follows Obsidian’s interface language',
		languageAuto: 'Auto',
		languageZh: '中文',
		languageEn: 'English',
	};

	const STR = {};
	let currentLang = 'zh';

	function applyLanguage(lang) {
		const src = lang === 'en' ? STR_EN : STR_ZH;
		for (const k of Object.keys(STR)) delete STR[k];
		for (const k of Object.keys(STR_ZH)) STR[k] = STR_ZH[k];
		if (src !== STR_ZH) {
			for (const k of Object.keys(src)) STR[k] = src[k];
		}
		currentLang = lang === 'en' ? 'en' : 'zh';
	}

	/** 检测语言：设置优先，其次 Obsidian 的 language，再退回 navigator */
	function detectLanguage(setting) {
		if (setting === 'zh' || setting === 'en') return setting;
		try {
			const stored = window.localStorage && window.localStorage.getItem('language');
			if (stored) return String(stored).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
		} catch (e) {
			/* ignore */
		}
		try {
			const nav = (navigator.language || '').toLowerCase();
			return nav.indexOf('zh') === 0 ? 'zh' : 'en';
		} catch (e) {
			/* ignore */
		}
		return 'zh';
	}

	function setLanguage(lang) {
		applyLanguage(lang === 'en' ? 'en' : 'zh');
	}

	function getLanguage() {
		return currentLang;
	}

	applyLanguage('zh');

	return {
		TAU,
		clamp,
		lerp,
		angleDelta,
		unitHash,
		compareText,
		compareByFirstAndTail,
		pinyinInitial,
		lastWordInitial,
		hexToRgb,
		rgbToHex,
		mixHex,
		rampColor,
		parseCssColor,
		rgba,
		STR,
		setLanguage,
		getLanguage,
		detectLanguage,
	};
})();

// ---- src/palette.js ----
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

// ---- src/graph.js ----
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

// ---- src/layout.js ----
// ============================================================================
// layout.js — 螺旋臂布局 + 纯圆周运动（无迭代、无收敛、必然确定性）
//
// 形态参考「旋涡星系」：
//   · 中心笔记固定在原点；
//   · 其余 Markdown 按 creation-time 升序，轮流分到 arms 条旋臂；
//     同一条臂上相邻两个节点，角度前进 step、半径乘 (1+g)，
//     于是每条臂都是一条渐开螺旋，节点稀疏地挂在上面对角前进；
//   · PDF 在最外圈，以 0.28 倍速度绕中心公转。
//
// 所有轨道都是圆；节点身后那条「淡尾巴」由渲染层按当前角度反推画弧。
// 纯逻辑，不依赖 obsidian。
// ============================================================================
const Layout = (function () {
	const R0 = 70; // 第 1 轨的半径
	const INNER_LIFT = 1.26; // 内环整体外移 26%（配合 SPAN_BASE 提升周长、减少同轨碰撞）

	// 外径/内径 ≈ SPAN_BASE + SPAN_K × 层间距（按最外轨归一化，笔记再多外径也稳定）
	const SPAN_BASE = 1.85;
	const SPAN_K = 1.0;

	// 每轨容量：2·(π/e)^(3n)，n 从 1 起（PDF 不占容量）
	const ORBIT_BASE = Math.pow(Math.PI / Math.E, 3); // ≈ 1.54366

	function orbitCapacity(n) {
		return Math.max(1, Math.floor(2 * Math.pow(ORBIT_BASE, n)));
	}

	const PDF_GAP_MIN = 70;
	const PDF_GAP_RATIO = 0.18;
	const PDF_SPIN = 0.28;

	// 尺寸：中心最大，其余按连接数，且有下限
	const CENTER_RADIUS = 5.8;
	const MIN_MD_RADIUS = 2.6;
	const MIN_PDF_RADIUS = 3.2;

	const MAX_SHRINK = 0.08; // 吸引最多让半径内缩 8%
	const MAX_SWING = 0.174533; // 吸引最多让相位偏 10°

	const PARENT_ROOT = 'root';

	// PDF 的缓慢无规则漂移（有界）：半径 −11% ~ +5%，角度 ±7°
	const DRIFT_RISE = 0.05;
	const DRIFT_FALL = 0.11;
	const DRIFT_ANGLE = 0.122;

	// 彗星轨道（椭圆，焦点在中心）：只在第 1 轨与最外轨各放一个
	const COMET_E_FIRST = 0.86; // 第 1 轨离心率（更扁、更像彗星）
	const COMET_FIRST_SPEED = 1.0; // 第 1 轨彗星速率（与常规一致，靠轨道更小显得快）
	const COMET_E_LAST = 0.7; // 最外轨离心率
	const COMET_MIN_PERI_FACTOR = 4; // 第 1 轨彗星的近点至少是中心球半径的 4 倍
	const COMET_PRECESS = 0.03; // 椭圆长轴绕焦点进动（rad/s，约 3.5 分钟一圈）
	const KEPLER_ITER = 3; // 牛顿迭代次数

	// PDF 彗星：温和的椭圆 + 比常规彗星快 1.2 倍
	const ELLIPSE_MAX_E = 0.32; // 最外内环的离心率（0 → 0.32 线性）
	const ELLIPSE_JITTER = 0.05; // 每颗球的离心率抖动（±0.05）
	const ELLIPSE_PRECESS = 0.025; // 椭圆近点方向的缓慢进动（rad/s）
	const ELLIPSE_AP_CAP = 1.05; // 远点上限 = pdfR × 1.05（允许轻微侵入星带内缘）
	const PDF_COMET_E = 0.44; // 第 1 颗：偏扁、几乎不出星带
	const PDF_COMET_E_INNER = 0.3; // 第 2 颗：仍然会穿进内环
	const PDF_COMET_INNER_A = 0.6; // 第 2 颗的长半轴 = 0.6 × pdfR
	const PDF_COMET_INNER_REACH = 0.85; // 保证第 2 颗的近点至少到最外 MD 轨的 0.85 倍（真的进内环）
	const PDF_COMET_SPEED = 0.95;
	const PDF_COMET_PERI_MARGIN = 1.08; // 近点 = 最外轨 × 1.08

	// 时钟：PDF ≥ 5 时，第 3~5 个 PDF 变成时/分/秒针
	const CLOCK_HANDS = ['h', 'm', 's'];

	/** 解 kepler 方程 M = E − e·sinE */
	function solveKepler(M, e) {
		let E = M + e * Math.sin(M);
		for (let k = 0; k < KEPLER_ITER; k++) {
			const f = E - e * Math.sin(E) - M;
			const fp = 1 - e * Math.cos(E);
			E -= f / fp;
		}
		return E;
	}

	/** 节点视觉半径（未乘 nodeScale）：连接越多越大 */
	function nodeRadius(node) {
		if (node.kind === GraphBuilder.KIND_PDF) return MIN_PDF_RADIUS;
		// 0 链接 = 2.6，链接越多越明显变大，16 个以上封顶 12.6
		return Math.max(MIN_MD_RADIUS, 2.6 + Math.min(10, Math.sqrt(Math.max(0, node.degree)) * 2.4));
	}

	/**
	 * @param {object} graph GraphBuilder.buildGraph 的结果
	 * @param {{spacing:number}} opts
	 */
	function build(graph, opts) {
		const nodes = graph.nodes;
		const n = nodes.length;

		const spacing = Core.clamp(Number(opts && opts.spacing) || 1, 0.4, 2.5);

		const out = new Array(n);
		for (let i = 0; i < n; i++) {
			out[i] = {
				root: false,
				drift: false,
				driftSeed: 0,
				orbit: 0,
				dir: 1,
				comet: false,
				e: 0,
				a: 0,
				peri: 0,
				M0: 0,
				rho: 0,
				theta0: 0,
				spinFactor: 1,
				wobAmp: 0,
				wobSpeed: 0,
				wobPhase: 0,
				radius: nodeRadius(nodes[i]),
			};
		}

		// --- Markdown：按创建时间升序，按「每轨容量」顺序填轨 ---
		const md = [];
		for (let i = 0; i < n; i++) {
			if (nodes[i].kind !== GraphBuilder.KIND_MD) continue;
			if (i === graph.center) continue;
			md.push(i);
		}
		md.sort((a, b) => {
			const na = nodes[a];
			const nb = nodes[b];
			if (na.ctime !== nb.ctime) return na.ctime - nb.ctime;
			return Core.compareText(na.path, nb.path);
		});

		// 外径/内径比：层间距越大，螺旋伸得越远
		const span = SPAN_BASE + SPAN_K * spacing;

		// 1) 顺序填轨：第 1 轨 3 个 → 第 2 轨 4 个 → 第 3 轨 7 个 …
		const orbitOf = new Map(); // idx → 轨道号（1 起）
		let fillOrbit = 1;
		let fillUsed = 0;
		for (let i = 0; i < md.length; i++) {
			while (fillUsed >= orbitCapacity(fillOrbit)) {
				fillOrbit++;
				fillUsed = 0;
			}
			orbitOf.set(md[i], fillOrbit);
			fillUsed++;
		}

		// 2) 抖动：10% 向外一轨、11% 向内一轨、79% 不动（按路径确定性，不随帧变化）
		for (let i = 0; i < md.length; i++) {
			const idx = md[i];
			let o = orbitOf.get(idx);
			const roll = Core.unitHash(idx * 37 + 11);
			if (roll < 0.1) o += 1;
			else if (roll < 0.21) o -= 1;
			orbitOf.set(idx, Math.max(1, o));
		}

		// 3) 溢出：超容量的轨道里，title 比较「最大」的那颗挪到最近的有空位轨道（优先向外）
		const titleCmp = (x, y) => {
			const r = Core.compareByFirstAndTail(nodes[x].label, nodes[y].label);
			if (r !== 0) return r;
			return Core.compareText(nodes[x].path, nodes[y].path);
		};
		const slotOf = new Map(); // 轨道号 → 已用数量
		for (const o of orbitOf.values()) slotOf.set(o, (slotOf.get(o) || 0) + 1);

		let maxOrbit = 1;
		for (const o of slotOf.keys()) if (o > maxOrbit) maxOrbit = o;

		const orbitHasRoom = (o) => (slotOf.get(o) || 0) < orbitCapacity(o);
		const nearestFreeOrbit = (from) => {
			for (let d = 1; d < 256; d++) {
				if (orbitHasRoom(from + d)) return from + d;
				if (from - d >= 1 && orbitHasRoom(from - d)) return from - d;
			}
			return from + 1;
		};
		const worstIn = (o) => {
			let worst = -1;
			for (const [idx, oo] of orbitOf) {
				if (oo !== o) continue;
				if (worst < 0 || titleCmp(idx, worst) > 0) worst = idx;
			}
			return worst;
		};

		for (let guard = md.length * 4 + 16; guard > 0; guard--) {
			let over = -1;
			for (const [o, c] of slotOf) {
				if (c > orbitCapacity(o)) {
					over = o;
					break;
				}
			}
			if (over < 0) break;
			const victim = worstIn(over);
			if (victim < 0) break;
			const target = nearestFreeOrbit(over);
			orbitOf.set(victim, target);
			slotOf.set(over, slotOf.get(over) - 1);
			slotOf.set(target, (slotOf.get(target) || 0) + 1);
			if (target > maxOrbit) maxOrbit = target;
		}

		// 4) 半径：内环抬升 INNER_LIFT、外环钉在 R0×span，中间等比插值
		const orbitRatio = maxOrbit > 1 ? Math.pow(span / INNER_LIFT, 1 / (maxOrbit - 1)) : 1;
		const orbitRho = (o) => R0 * INNER_LIFT * Math.pow(orbitRatio, o - 1);


		let maxRho = R0 * INNER_LIFT;
		const byOrbit = new Map(); // s（0 起） → [nodeIndex]
		const perOrbit = new Map();
		for (const [idx, o] of orbitOf) {
			let arr = perOrbit.get(o);
			if (!arr) perOrbit.set(o, (arr = []));
			arr.push(idx);
		}
		const orbitKeys = [];
		for (const o of perOrbit.keys()) orbitKeys.push(o);
		orbitKeys.sort((a, b) => a - b);

		for (let oi = 0; oi < orbitKeys.length; oi++) {
			const o = orbitKeys[oi];
			const arr = perOrbit.get(o);
			arr.sort((a, b) => nodes[a].ctime - nodes[b].ctime || Core.compareText(nodes[a].path, nodes[b].path));

			const rho = orbitRho(o);
			if (rho > maxRho) maxRho = rho;
			const slots = Math.max(arr.length, orbitCapacity(o));

			let bucket = byOrbit.get(o - 1);
			if (!bucket) byOrbit.set(o - 1, (bucket = []));

			for (let k = 0; k < arr.length; k++) {
				const idx = arr[k];
				const rec = out[idx];
				rec.orbit = o - 1;
				rec.rho = rho;
				rec.theta0 = (Core.TAU * k) / slots + (o - 1) * 0.42;
			rec.seed = Core.unitHash(idx * 53 + 3); // 椭圆离心率抖动用
				rec.dir = o >= 3 ? -1 : 1; // 第 1、2 轨顺时针，其余逆时针
				// 内环按轨道线性给速度：最内 1 倍 → 最外 1.5 倍（轨道越大越快）
				// 差速旋转：内圈快、外圈慢（更像星系盘），再给 ±2% 个体差异
			const orbitT = maxOrbit > 1 ? (o - 1) / (maxOrbit - 1) : 0;
			rec.spinFactor = (1.45 - 0.45 * orbitT) * (1 + 0.04 * (Core.unitHash(idx * 41 + 7) - 0.5));
				// 每个节点一个确定性的小摆动，让整体不像一块钢板
				rec.wobAmp = 0.02 + 0.03 * Core.unitHash(idx * 13 + 5);
				rec.wobSpeed = 0.25 + 0.35 * Core.unitHash(idx * 29 + 11);
				rec.wobPhase = Core.unitHash(idx * 7 + 3) * Core.TAU;
				bucket.push(idx);
			}
		}

		// --- 彗星：只有第 1 轨与最外轨各一个 ---
		// 选人：名称取 title（缺失用文件名），首字符 → 从尾部倒着比 → 整串 → 路径
		const compareCandidates = (x, y) => {
			const r = Core.compareByFirstAndTail(nodes[x].label, nodes[y].label);
			if (r !== 0) return r;
			return Core.compareText(nodes[x].path, nodes[y].path);
		};

		const orbitList = [];
		for (const key of byOrbit.keys()) orbitList.push(key);
		orbitList.sort((a, b) => a - b);

		const plan = [];
		if (orbitList.length >= 2) {
			plan.push({ s: orbitList[0], e: COMET_E_FIRST });
			const lastS = orbitList[orbitList.length - 1];
			if (lastS !== orbitList[0]) plan.push({ s: lastS, e: COMET_E_LAST });
		}

		for (let pi = 0; pi < plan.length; pi++) {
			const { s, e } = plan[pi];
			const bucket = byOrbit.get(s);
			if (!bucket || !bucket.length) continue;

			let pick = bucket[0];
			for (let k = 1; k < bucket.length; k++) {
				if (compareCandidates(bucket[k], pick) < 0) pick = bucket[k];
			}

			const rec = out[pick];
			const cometRho = orbitRho(s + 1);
			let a = cometRho;
			if (pi === 0) {
				// 第 1 轨：抬高长半轴，保证近点不再贴着中心球
				const minPeri = COMET_MIN_PERI_FACTOR * CENTER_RADIUS;
				a = Math.max(cometRho, minPeri / (1 - e));
			}

			rec.comet = true;
			rec.e = e;
			rec.a = a; // 椭圆长半轴（rho 仍是该轨道的规范半径，用于取色与排序）
			rec.cometRate = pi === 0 ? COMET_FIRST_SPEED : 1; // 平均角速度倍率（第 1 轨 +12%）
			rec.omega = COMET_PRECESS; // 椭圆长轴绕焦点缓慢进动
			rec.wobAmp = 0; // 开普勒运动已经足够生动，不再叠摆动

			// 近点方向：取 ν₀ 使启用瞬间半径恰好等于 a（cos ν₀ = −e），位置不跳变
			const nu0 = Math.acos(Core.clamp(-e, -1, 1));
			rec.peri = rec.theta0 - nu0;
			const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2), Math.sqrt(1 + e) * Math.cos(nu0 / 2));
			rec.M0 = E0 - e * Math.sin(E0);
		}

		// --- PDF：最外圈、慢速公转（必须放在所有彗星远点之外） ---
		const pdfs = [];
		for (let i = 0; i < n; i++) {
			if (nodes[i].kind === GraphBuilder.KIND_PDF) pdfs.push(i);
		}
		pdfs.sort((a, b) => Core.compareText(nodes[a].path, nodes[b].path));

		let cometFar = 0;
		for (let i = 0; i < n; i++) {
			const rec = out[i];
			if (!rec.comet) continue;
			const far = rec.a * (1 + rec.e);
			if (far > cometFar) cometFar = far;
		}
		const outer = Math.max(maxRho, cometFar);
		const pdfR = outer + Math.max(PDF_GAP_MIN, outer * PDF_GAP_RATIO);
		// 时间球的三条轨道：①MD 环与 PDF 环之间 ②PDF 星带 ③星带之外
		const hourOrbit = (maxRho + pdfR) / 2;
		const secondOrbit = pdfR + Math.max(55, pdfR * 0.16);
		// 内环椭圆：焦点在中心球，近点固定在原圆周半径，远点最多到 pdfR×0.95
		const ellipses = [];
		for (let o = 1; o <= maxOrbit; o++) {
			const t = maxOrbit > 1 ? (o - 1) / (maxOrbit - 1) : 0;
			const rho0 = orbitRho(o);
			let e = ELLIPSE_MAX_E * t;
			const cap = pdfR * ELLIPSE_AP_CAP;
			let A = rho0 * ((1 + e) / (1 - e));
			if (A > cap) A = cap;
			if (A < rho0) A = rho0;
			e = (A - rho0) / (A + rho0);
			ellipses.push({ e, p: rho0 * (1 + e), w: 0, wSpin: ELLIPSE_PRECESS * o, A, P: rho0 });
		}


		// PDF 分三种角色：前 2 个当彗星；第 3~5 个当时/分/秒针（PDF ≥ 5 才有时钟）
		const ranked = pdfs.slice().sort((a, b) => {
			const ia = Core.lastWordInitial(nodes[a].name || nodes[a].path);
			const ib = Core.lastWordInitial(nodes[b].name || nodes[b].path);
			if (ia !== ib) return ia < ib ? 1 : -1; // 首字母降序
			return Core.compareText(nodes[b].path, nodes[a].path);
		});
		const cometPdfs = ranked.slice(0, Math.min(2, ranked.length));
		const clockPdfs = ranked.length >= 5 ? ranked.slice(2, 5) : [];

		// PDF 文件大小范围：外环球按大小线性给 1.5 倍 → 1 倍（越小越快）
		let sizeMin = Infinity;
		let sizeMax = -Infinity;
		for (let k = 0; k < pdfs.length; k++) {
			const sz = nodes[pdfs[k]].size || 0;
			if (sz < sizeMin) sizeMin = sz;
			if (sz > sizeMax) sizeMax = sz;
		}

		for (let k = 0; k < pdfs.length; k++) {
			const idx = pdfs[k];
			const rec = out[idx];
			rec.rho = pdfR;
			rec.theta0 = 0.35 + (Core.TAU * (k + 0.5)) / pdfs.length;
			const sizeSpan = sizeMax - sizeMin;
			const sizeK = sizeSpan > 0 ? ((nodes[idx].size || 0) - sizeMin) / sizeSpan : 0.5;
			// 文件越大越慢：0.28 × (1.75 − 1.10·sizeK)，小/大约 2.7 倍差距
			rec.spinFactor = PDF_SPIN * (1.75 - 1.1 * sizeK);
			rec.wobAmp = 0;
			rec.wobSpeed = 0;
			rec.wobPhase = 0;
			rec.drift = true;
			rec.driftSeed = Core.unitHash(k * 31 + 7);

			const rank = cometPdfs.indexOf(idx);
			if (rank < 0) {
				// 时/分/秒针：放大到 PDF 的 6 倍，各占一条轨道；不再漂移
				const hand = clockPdfs.indexOf(idx);
				if (hand >= 0) {
					rec.clockHand = CLOCK_HANDS[hand];
					rec.radius = MIN_PDF_RADIUS * 6; // 19.2
					rec.rho = hand === 0 ? hourOrbit : hand === 1 ? pdfR : secondOrbit;
					rec.drift = false; // 指针要准，不能飘
				}
				continue;
			}

			// 第 1 颗：椭圆 e 已下调，近点仍在最外 MD 轨之外
			// 第 2 颗：a = 0.6 × pdfR → 会穿进 MD 轨道区域
			const inner = rank === 1;
			const e = inner ? PDF_COMET_E_INNER : PDF_COMET_E;
			// 第 2 颗取 0.6 × pdfR；若这样仍够不到内环，就压到「近点 = 最外 MD 轨 × 0.85」
			const a = inner
				? Math.min(pdfR * PDF_COMET_INNER_A, (maxRho * PDF_COMET_INNER_REACH) / (1 - e))
				: Math.max(pdfR, (maxRho * PDF_COMET_PERI_MARGIN) / (1 - e));

			rec.comet = true;
			rec.pdfComet = true; // 显式标记：漂移已关闭，不能再靠 drift 区分
			rec.e = e;
			rec.a = a;
			rec.cometRate = PDF_COMET_SPEED; // 比常规彗星快 1.2 倍
			rec.omega = COMET_PRECESS * PDF_COMET_SPEED;
			rec.drift = false; // 椭圆足够干净，不再叠漂移

			const nu0 = Math.acos(Core.clamp(-e, -1, 1));
			rec.peri = rec.theta0 - nu0;
			const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2), Math.sqrt(1 + e) * Math.cos(nu0 / 2));
			rec.M0 = E0 - e * Math.sin(E0);
		}

		// --- 中心笔记：原点、不动 ---
		if (graph.center >= 0 && graph.center < n) {
			const rec = out[graph.center];
			rec.root = true;
			rec.rho = 0;
			rec.spinFactor = 0;
			rec.wobAmp = 0;
			rec.radius = Math.max(CENTER_RADIUS, nodeRadius(nodes[graph.center]) * 1.2);
		}

		let maxR = 0;
		for (let i = 0; i < n; i++) {
			const rec = out[i];
			let reach;
			if (rec.comet) {
				// 彗星要按椭圆远点取景，否则最外那条腿会被裁掉
				reach = rec.a * (1 + rec.e) + rec.radius;
			} else if (rec.drift) {
				reach = rec.rho * (1 + DRIFT_RISE) + rec.radius;
			} else {
				reach = rec.rho + rec.radius;
			}
			if (reach > maxR) maxR = reach;
		}
		if (maxR < 1) maxR = 1;

		return { nodes: out, maxR, maxRho, pdfR, span, ellipses, orbitRho, maxOrbit, capacity: orbitCapacity };
	}

	/**
	 * 单位置计算：view 与离线预览共用，保证「看到的就是插件算的」
	 * @param {object} rec layout 产出的节点记录
	 * @param {{clock:number, base:number, sizeK:number}} s
	 * @param {{rho:number, theta0:number}=} override 缓动中的当前值
	 */
	function pose(rec, s, override) {
		const radius = rec.radius * s.sizeK;
		if (rec.root) {
			return { x: 0, y: 0, ang: 0, rho: 0, radius };
		}

		// --- 时钟球：角度由系统时间决定（12 点朝上、顺时针）---
		if (rec.clockHand) {
			let rho = override && override.rho !== undefined ? override.rho : rec.rho;
			const wall = s.wall || 0;
			const d = new Date(wall);
			let frac;
			if (rec.clockHand === 'h') frac = ((d.getHours() % 12) + d.getMinutes() / 60) / 12;
			else if (rec.clockHand === 'm') frac = (d.getMinutes() + d.getSeconds() / 60) / 60;
			else frac = (d.getSeconds() + d.getMilliseconds() / 1000) / 60;

			// 计时器模式：外部直接给「转了几圈的比例」（0..1）
			if (s.handAngles && s.handAngles[rec.clockHand] !== undefined) frac = s.handAngles[rec.clockHand];

			let ang = -Math.PI / 2 + Core.TAU * frac;

			if (rec.drift) {
				const p = rec.driftSeed * Core.TAU;
				const u = Core.clamp((0.07 * Math.sin(0.13 * s.clock + p) + 0.04 * Math.sin(0.31 * s.clock + p * 1.7)) / 0.11, -1, 1);
				const offset = u >= 0 ? DRIFT_RISE * u : DRIFT_FALL * u;
				rho = rho * (1 + offset);
				ang += DRIFT_ANGLE * Math.sin(0.19 * s.clock + p * 2.3);
			}

			return { x: Math.cos(ang) * rho, y: Math.sin(ang) * rho, ang, rho, radius };
		}

		// --- 彗星：以中心为焦点的椭圆 + 开普勒变速 ---
		if (rec.comet) {
			const e = rec.e;
			const a = rec.a > 0 ? rec.a : rec.rho;
			const rate = rec.cometRate || 1;
			const M = rec.M0 + (rec.dir === -1 ? -1 : 1) * s.base * rate;
			const E = solveKepler(M, e);
			const cosE = Math.cos(E);
			const sinE = Math.sin(E);
			const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
			let r = a * (1 - e * cosE);
			// 长轴缓慢进动：整条椭圆绕着焦点转
			let ang = rec.peri + (rec.omega || 0) * s.clock + nu;

			// PDF 彗星额外保留原来的有界漂移
			if (rec.drift) {
				const t = s.clock;
				const p = rec.driftSeed * Core.TAU;
				const u = Core.clamp((0.07 * Math.sin(0.13 * t + p) + 0.04 * Math.sin(0.31 * t + p * 1.7)) / 0.11, -1, 1);
				const offset = u >= 0 ? DRIFT_RISE * u : DRIFT_FALL * u;
				r = r * (1 + offset);
				ang += DRIFT_ANGLE * Math.sin(0.19 * t + p * 2.3);
			}

			return { x: Math.cos(ang) * r, y: Math.sin(ang) * r, ang, rho: r, radius };
		}

		let rho = override && override.rho !== undefined ? override.rho : rec.rho;
		const theta0 = override && override.theta0 !== undefined ? override.theta0 : rec.theta0;
		let ang =
			theta0 + (rec.dir === -1 ? -1 : 1) * s.base * rec.spinFactor + rec.wobAmp * Math.sin(rec.wobSpeed * s.clock + rec.wobPhase);

		// PDF：缓慢无规则的漂移，严格限制在半径 −11%~+5%、角度 ±7° 内
		if (rec.drift) {
			const t = s.clock;
			const p = rec.driftSeed * Core.TAU;
			const u = Core.clamp((0.07 * Math.sin(0.13 * t + p) + 0.04 * Math.sin(0.31 * t + p * 1.7)) / 0.11, -1, 1);
			const offset = u >= 0 ? DRIFT_RISE * u : DRIFT_FALL * u;
			rho = rho * (1 + offset);
			ang += DRIFT_ANGLE * Math.sin(0.19 * t + p * 2.3);
		}

		// MD 轨道椭圆：中心球在焦点上，半径随角度按 r(θ) = p / (1 + e·cos(θ−ω)) 变化
		if (override && override.ellipse) {
			const el = override.ellipse;
			// 每颗球的离心率抖动 + 椭圆近点方向的缓慢进动（让环边像旋臂一样流动）
			const h = Core.unitHash(rec.seed || 7);
			const eJit = Core.clamp(el.e + ELLIPSE_JITTER * (h - 0.5) * 2, 0, 0.6);
			const wSpin = el.wSpin || 0;
			const wp = s.clock * wSpin;
			const den = 1 + eJit * Math.cos(ang - (el.w || 0) - wp);
			if (den > 1e-3) rho = el.p / den;
		}

		return { x: Math.cos(ang) * rho, y: Math.sin(ang) * rho, ang, rho, radius };
	}

	// ------------------------------------------------------------------------
	// PDF 对相连笔记的「轻微吸引」
	//
	// 不能用力积分：任何持续的径向力都会把节点推出自己的轨道。
	// 所以做成每帧重算、上下限夹死、永不累积的偏置：
	//   半径内缩 ≤ 8%   相位偏移 ≤ 10°   pull ∈ [0,1]
	// ------------------------------------------------------------------------
	function attraction(p) {
		const cx = p.cx || 0;
		const cy = p.cy || 0;
		const rho = p.rho || 0;
		if (rho <= 0.0001) return { rho, ang: p.ang, pull: 0 };

		const x = cx + Math.cos(p.ang) * rho;
		const y = cy + Math.sin(p.ang) * rho;
		const dist = Math.hypot(p.px - x, p.py - y);
		const scale = p.maxR > 1 ? p.maxR : 1;
		const dn = dist / scale;

		const pull = Core.clamp(0.35 / (dn * dn + 0.1), 0, 1);
		if (pull <= 0.0001) return { rho, ang: p.ang, pull: 0 };

		const dir = Math.atan2(p.py - cy, p.px - cx);
		const swing = Core.clamp(Core.angleDelta(p.ang, dir) * 0.3, -MAX_SWING, MAX_SWING);

		return { rho: rho * (1 - MAX_SHRINK * pull), ang: p.ang + swing * pull, pull };
	}

	return {
		build,
		pose,
		attraction,
		nodeRadius,
		orbitCapacity,
		CLOCK_HANDS,
		PARENT_ROOT,
		PDF_SPIN,
		MIN_MD_RADIUS,
		MIN_PDF_RADIUS,
		CENTER_RADIUS,
		MAX_SHRINK,
		MAX_SWING,
	};
})();

// ---- src/plan.js ----
// ============================================================================
// plan.js — 每周计划表（按周一到周日各一个四象限）与 PDCA 复盘的纯逻辑
//
// 数据源是仓库里的笔记：<folder>/<年>/<周>周.md
//   ## 10/19 周一
//     ### 重要 · 紧急 / 不重要 · 紧急 / 重要 · 不紧急 / 不重要 · 不紧急
//   ## 10/20 周二 … ## 10/25 周日
//   ## PDCA 复盘 → ### P 计划（Plan） / D 执行（Do） / C 检查（Check） / A 改进（Act）
//
// 旧格式（只有一份四象限、没有天标题）仍能被 parse 读出（记在周一），
// 需要时用 migrateLegacy() 一次性改写成按天格式。
//
// 这里只做「算周、拼路径、读文本、改单行」这些纯函数，没有任何 DOM / obsidian 依赖。
// ============================================================================
const Plan = (function () {
	const DAY = 86400000;

	const DAYS_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
	const DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const DAYS = DAYS_ZH;

	const EN_QUAD_TITLES = ['Important · Urgent', 'Not important · Urgent', 'Important · Not urgent', 'Not important · Not urgent'];
	const EN_PDCA_TITLES = ['P · Plan', 'D · Do', 'C · Check', 'A · Act'];
	const EN_PDCA_PROMPTS = ['What do I plan this week', 'What did I actually get done', 'Where is the gap and why', 'What will I change next week'];

	/** 当前语言：zh / en（由 Core.setLanguage 决定） */
	function lang() {
		return typeof Core !== 'undefined' && Core.getLanguage && Core.getLanguage() === 'en' ? 'en' : 'zh';
	}

	/** 第 d 天的简称（周一 / Mon），UI 与笔记都用它 */
	function dayName(d) {
		const i = Math.max(0, Math.min(6, Number(d) || 0));
		return lang() === 'en' ? DAYS_EN[i] : DAYS_ZH[i];
	}

	const QUADRANTS = [
		{ key: 'q1', tone: 'urgent', zh: '重要 · 紧急', en: EN_QUAD_TITLES[0], get title() { return lang() === 'en' ? this.en : this.zh; } },
		{ key: 'q2', tone: 'noisy', zh: '不重要 · 紧急', en: EN_QUAD_TITLES[1], get title() { return lang() === 'en' ? this.en : this.zh; } },
		{ key: 'q3', tone: 'calm', zh: '重要 · 不紧急', en: EN_QUAD_TITLES[2], get title() { return lang() === 'en' ? this.en : this.zh; } },
		{ key: 'q4', tone: 'idle', zh: '不重要 · 不紧急', en: EN_QUAD_TITLES[3], get title() { return lang() === 'en' ? this.en : this.zh; } },
	];

	const PDCA = [
		{ key: 'p', zh: 'P 计划（Plan）', en: EN_PDCA_TITLES[0], zhPrompt: '本周打算做什么', enPrompt: EN_PDCA_PROMPTS[0], get title() { return lang() === 'en' ? this.en : this.zh; }, get prompt() { return lang() === 'en' ? this.enPrompt : this.zhPrompt; } },
		{ key: 'd', zh: 'D 执行（Do）', en: EN_PDCA_TITLES[1], zhPrompt: '实际做成了什么', enPrompt: EN_PDCA_PROMPTS[1], get title() { return lang() === 'en' ? this.en : this.zh; }, get prompt() { return lang() === 'en' ? this.enPrompt : this.zhPrompt; } },
		{ key: 'c', zh: 'C 检查（Check）', en: EN_PDCA_TITLES[2], zhPrompt: '差距在哪，为什么', enPrompt: EN_PDCA_PROMPTS[2], get title() { return lang() === 'en' ? this.en : this.zh; }, get prompt() { return lang() === 'en' ? this.enPrompt : this.zhPrompt; } },
		{ key: 'a', zh: 'A 改进（Act）', en: EN_PDCA_TITLES[3], zhPrompt: '下周准备怎么改', enPrompt: EN_PDCA_PROMPTS[3], get title() { return lang() === 'en' ? this.en : this.zh; }, get prompt() { return lang() === 'en' ? this.enPrompt : this.zhPrompt; } },
	];

	const TASK_RE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

	// ------------------------------------------------------------------
	// ISO 周与日期
	// ------------------------------------------------------------------
	/** @returns {{year:number, week:number, monday:Date, sunday:Date}} */
	function isoWeekOf(date) {
		const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
		const day = d.getUTCDay() || 7; // 周一=1 … 周日=7
		d.setUTCDate(d.getUTCDate() + 4 - day);
		const year = d.getUTCFullYear();
		const yearStart = Date.UTC(year, 0, 1);
		const week = Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7);
		const monday = mondayOf(year, week);
		const sunday = new Date(monday.getTime() + 6 * DAY);
		return { year, week, monday, sunday };
	}

	function mondayOf(year, week) {
		const jan4 = new Date(Date.UTC(year, 0, 4)); // 1 月 4 日一定在第 1 周
		const day = jan4.getUTCDay() || 7;
		const week1 = new Date(jan4.getTime() - (day - 1) * DAY);
		return new Date(week1.getTime() + (week - 1) * 7 * DAY);
	}

	function weeksInYear(year) {
		return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
	}

	function shiftWeek(year, week, delta) {
		const monday = mondayOf(year, week);
		return isoWeekOf(new Date(monday.getTime() + delta * 7 * DAY));
	}

	function pad2(n) {
		return String(n).padStart(2, '0');
	}

	/** 第 d 天（0=周一）的日期 */
	function dayDate(year, week, d) {
		return new Date(mondayOf(year, week).getTime() + d * DAY);
	}

	/** 天标题：10/19 周一 */
	function dayLabel(year, week, d) {
		const date = dayDate(year, week, d);
		return date.getUTCMonth() + 1 + '/' + date.getUTCDate() + ' ' + dayName(d);
	}

	/** 今天在周内的序号（周一=0 … 周日=6） */
	function todayIndex(date) {
		const d = date ? new Date(date) : new Date();
		return (d.getDay() + 6) % 7;
	}

	function weekTitle(year, week) {
		const monday = mondayOf(year, week);
		const sunday = new Date(monday.getTime() + 6 * DAY);
		if (lang() === 'en') {
			const md = (x) => x.getUTCMonth() + 1 + '/' + x.getUTCDate();
			return 'Week ' + week + ' · ' + year + ' · ' + md(monday) + ' – ' + md(sunday);
		}
		const md = (x) => x.getUTCMonth() + 1 + '月' + x.getUTCDate() + '日';
		return year + ' 年第 ' + week + ' 周 · ' + md(monday) + ' – ' + md(sunday);
	}

	/** 周标题：中文「2026 年第 44 周」/ 英文「Week 44 · 2026」 */
	function weekShort(year, week) {
		if (lang() === 'en') return 'Week ' + week + ' · ' + year;
		return year + ' 年第 ' + week + ' 周';
	}

	// ------------------------------------------------------------------
	// 路径与骨架
	// ------------------------------------------------------------------
	function planPath(folder, year, week) {
		const root = String(folder || 'orbit-plan').replace(/^\/+|\/+$/g, '');
		return root + '/' + year + '/' + pad2(week) + '周.md';
	}

	function skeleton(year, week) {
		const out = [];
		out.push('# ' + weekShort(year, week));
		out.push('');
		for (let d = 0; d < DAYS.length; d++) {
			out.push('## ' + dayLabel(year, week, d));
			out.push('');
			for (let q = 0; q < QUADRANTS.length; q++) {
				out.push('### ' + QUADRANTS[q].title);
				out.push('');
			}
		}
		out.push('## PDCA 复盘');
		out.push('');
		for (let p = 0; p < PDCA.length; p++) {
			out.push('### ' + PDCA[p].title);
			out.push('');
		}
		return out.join('\n');
	}

	// ------------------------------------------------------------------
	// 标题识别
	// ------------------------------------------------------------------
	function dayIndexOf(heading) {
		const h = String(heading || '');
		for (let i = 0; i < DAYS_ZH.length; i++) {
			if (h.indexOf(DAYS_ZH[i]) >= 0) return i;
		}
		const lower = h.toLowerCase();
		for (let i = 0; i < DAYS_EN.length; i++) {
			const token = DAYS_EN[i].toLowerCase();
			const re = new RegExp('(^|[^a-z])' + token + '([^a-z]|$)');
			if (re.test(lower)) return i;
		}
		return -1;
	}

	function quadrantIndexOf(heading) {
		const raw = String(heading || '');
		const lower = raw.toLowerCase();
		if (/important|urgent/.test(lower)) {
			const negImp = /not\s+important/.test(lower);
			const negUrg = /not\s+urgent/.test(lower);
			const imp = /important/.test(lower) && !negImp;
			const urg = /urgent/.test(lower) && !negUrg;
			if (imp && urg) return 0;
			if (!imp && urg) return 1;
			if (imp && !urg) return 2;
			return 3;
		}
		const hasImp = raw.indexOf('重要') >= 0;
		const hasUrg = raw.indexOf('紧急') >= 0;
		if (!hasImp && !hasUrg) return -1;
		const negImp = raw.indexOf('不重要') >= 0;
		const negUrg = raw.indexOf('不紧急') >= 0;
		const imp = hasImp && !negImp;
		const urg = hasUrg && !negUrg;
		if (imp && urg) return 0;
		if (!imp && urg) return 1;
		if (imp && !urg) return 2;
		return 3;
	}

	function pdcaIndexOf(heading) {
		const h = heading.trim();
		const lower = h.toLowerCase();
		if (/^p\b/.test(lower) || h.indexOf('计划') >= 0 || /plan/.test(lower)) return 0;
		if (/^d\b/.test(lower) || h.indexOf('执行') >= 0 || /^d\b|\bdo\b/.test(lower)) return 1;
		if (/^c\b/.test(lower) || h.indexOf('检查') >= 0 || /check/.test(lower)) return 2;
		if (/^a\b/.test(lower) || h.indexOf('改进') >= 0 || /act/.test(lower)) return 3;
		return -1;
	}

	// ------------------------------------------------------------------
	// 解析
	// ------------------------------------------------------------------
	/**
	 * @returns {{lines:string[], days:Array<{quads:Array<{tasks:Array<{text:string,done:boolean,line:number}>}>}>, pdca:string[], legacy:boolean, anyHeading:boolean}}
	 */
	function parse(text) {
		const lines = String(text == null ? '' : text).split('\n');
		const days = [];
		for (let d = 0; d < DAYS.length; d++) {
			const quads = [];
			for (let q = 0; q < QUADRANTS.length; q++) quads.push({ tasks: [] });
			days.push({ quads });
		}
		const pdcaLines = [[], [], [], []];
		const pdca = ['', '', '', ''];
		let day = -1;
		let quad = -1;
		let inPdca = false;
		let pIdx = -1;
		let anyHeading = false;
		let legacy = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const h2 = /^##\s+(.*)$/.exec(line);
			if (h2) {
				anyHeading = true;
				const heading = h2[1].trim();
				if (heading.indexOf('PDCA') >= 0) {
					inPdca = true;
					day = -1;
					quad = -1;
					pIdx = -1;
					continue;
				}
				inPdca = false;
				const di = dayIndexOf(heading);
				if (di >= 0) {
					day = di;
					quad = -1;
					continue;
				}
				const qi = quadrantIndexOf(heading);
				if (qi >= 0) {
					// 旧格式：整篇只有一份四象限 → 归到周一
					legacy = true;
					day = 0;
					quad = qi;
					continue;
				}
				day = -1;
				quad = -1;
				continue;
			}

			const h3 = /^###\s+(.*)$/.exec(line);
			if (h3) {
				if (inPdca) {
					pIdx = pdcaIndexOf(h3[1]);
				} else if (day >= 0) {
					quad = quadrantIndexOf(h3[1]);
				}
				continue;
			}

			if (inPdca) {
				if (pIdx >= 0) pdcaLines[pIdx].push(line);
				continue;
			}
			if (day >= 0 && quad >= 0) {
				const m = TASK_RE.exec(line);
				if (m) {
					days[day].quads[quad].tasks.push({ text: m[3].trim(), done: m[2].toLowerCase() === 'x', line: i });
				}
			}
		}

		for (let p = 0; p < 4; p++) {
			const arr = pdcaLines[p];
			let start = 0;
			let end = arr.length;
			while (start < end && arr[start].trim() === '') start++;
			while (end > start && arr[end - 1].trim() === '') end--;
			pdca[p] = arr.slice(start, end).join('\n');
		}

		return { lines, days, pdca, legacy, anyHeading };
	}

	// ------------------------------------------------------------------
	// 单行改写（都返回新全文，找不到目标时返回 null）
	// ------------------------------------------------------------------
	function toggleTask(text, line) {
		const lines = String(text).split('\n');
		if (line < 0 || line >= lines.length) return null;
		const m = TASK_RE.exec(lines[line]);
		if (!m) return null;
		const done = m[2].toLowerCase() === 'x';
		lines[line] = m[1] + '- [' + (done ? ' ' : 'x') + '] ' + m[3];
		return lines.join('\n');
	}

	/** 找「第 day 天 · 第 quad 象限」小节的行范围 */
	function quadBounds(lines, day, quad) {
		let dayStart = -1;
		let dayEnd = lines.length;
		let lastDayStart = -1;
		for (let i = 0; i < lines.length; i++) {
			const h2 = /^##\s+(.*)$/.exec(lines[i]);
			if (!h2) continue;
			const heading = h2[1].trim();
			if (lastDayStart >= 0 && dayEnd === lines.length) dayEnd = i;
			if (dayIndexOf(heading) === day) {
				dayStart = i;
				lastDayStart = i;
			}
			if (heading.indexOf('PDCA') >= 0 && lastDayStart >= 0 && dayEnd === lines.length) dayEnd = i;
		}
		if (dayStart < 0) return null;

		let start = -1;
		let end = dayEnd;
		for (let i = dayStart + 1; i < dayEnd; i++) {
			const h3 = /^###\s+(.*)$/.exec(lines[i]);
			if (!h3) continue;
			if (start >= 0) {
				end = i;
				break;
			}
			if (quadrantIndexOf(h3[1]) === quad) start = i;
		}
		return { dayStart, dayEnd, start, end };
	}

	/** 在第 day 天第 quad 象限追加一条任务；小节缺失时补上 */
	function addTask(text, day, quad, taskText) {
		const clean = String(taskText == null ? '' : taskText).replace(/\r?\n/g, ' ').trim();
		if (!clean) return null;
		const d = Math.max(0, Math.min(DAYS.length - 1, Number(day) || 0));
		const q = Math.max(0, Math.min(QUADRANTS.length - 1, Number(quad) || 0));
		const lines = String(text == null ? '' : text).split('\n');
		const taskLine = '- [ ] ' + clean;

		const bounds = quadBounds(lines, d, q);
		if (!bounds) {
			// 没有这一天：先补天标题与象限标题，尽量插在 PDCA 之前
			let insertAt = lines.length;
			for (let i = 0; i < lines.length; i++) {
				if (/^##\s+.*PDCA/.test(lines[i])) {
					insertAt = i;
					break;
				}
			}
			const block = ['## ' + DAYS[d], '', '### ' + QUADRANTS[q].title, taskLine, ''];
			lines.splice(insertAt, 0, ...block);
			return lines.join('\n');
		}

		if (bounds.start < 0) {
			// 有天但没这个象限：插在该天末尾
			const block = ['### ' + QUADRANTS[q].title, taskLine, ''];
			lines.splice(bounds.dayEnd, 0, ...block);
			return lines.join('\n');
		}

		let insertAt = bounds.start + 1;
		for (let i = bounds.start + 1; i < bounds.end; i++) {
			if (TASK_RE.test(lines[i])) insertAt = i + 1;
		}
		lines.splice(insertAt, 0, taskLine);
		return lines.join('\n');
	}

	/** 按任务正文找行号（找不到返回 -1） */
	function findTaskLine(text, taskText) {
		const parsed = parse(text);
		for (let d = 0; d < parsed.days.length; d++) {
			for (let q = 0; q < QUADRANTS.length; q++) {
				for (const t of parsed.days[d].quads[q].tasks) {
					if (t.text === taskText) return t.line;
				}
			}
		}
		return -1;
	}

	/** 改写某条任务的正文字（保留完成状态）；空文本返回 null */
	function setTaskText(text, line, next) {
		const lines = String(text).split('\n');
		if (line < 0 || line >= lines.length) return null;
		const m = TASK_RE.exec(lines[line]);
		if (!m) return null;
		const clean = String(next == null ? '' : next).replace(/\r?\n/g, ' ').trim();
		if (!clean) return null;
		const mark = m[2].toLowerCase() === 'x' ? 'x' : ' ';
		lines[line] = m[1] + '- [' + mark + '] ' + clean;
		return lines.join('\n');
	}

	function removeTask(text, line) {
		const lines = String(text).split('\n');
		if (line < 0 || line >= lines.length) return null;
		if (!TASK_RE.test(lines[line])) return null;
		lines.splice(line, 1);
		return lines.join('\n');
	}

	/** 替换某个 PDCA 小节的正文；小节不存在时在末尾补 */
	function setPdca(text, index, content) {
		const lines = String(text == null ? '' : text).split('\n');
		let inPdca = false;
		let start = -1;
		let end = lines.length;

		for (let i = 0; i < lines.length; i++) {
			const h2 = /^##\s+(.*)$/.exec(lines[i]);
			if (h2) {
				if (inPdca && start >= 0 && end === lines.length) end = i;
				inPdca = h2[1].indexOf('PDCA') >= 0;
				continue;
			}
			const h3 = /^###\s+(.*)$/.exec(lines[i]);
			if (h3 && inPdca) {
				if (start >= 0 && end === lines.length) {
					end = i;
					break;
				}
				if (pdcaIndexOf(h3[1]) === index) start = i;
			}
		}

		const body = String(content == null ? '' : content).split('\n');

		if (start < 0) {
			lines.push('## PDCA 复盘');
			lines.push('');
			lines.push('### ' + PDCA[index].title);
			for (const b of body) lines.push(b);
			return lines.join('\n');
		}

		const head = lines[start];
		const next = lines.slice(end);
		const rebuilt = [head, ''].concat(body, ['']);
		return lines.slice(0, start).concat(rebuilt, next).join('\n');
	}

	// ------------------------------------------------------------------
	// 旧格式迁移
	// ------------------------------------------------------------------
	/** 把"只有一份四象限"的旧笔记改写为按天格式（旧任务归到周一） */
	function migrateLegacy(text, year, week) {
		const parsed = parse(text);
		const src = String(text == null ? '' : text).split('\n');
		let pdcaStart = -1;
		for (let i = 0; i < src.length; i++) {
			if (/^##\s+.*PDCA/.test(src[i])) {
				pdcaStart = i;
				break;
			}
		}
		let title = null;
		for (const line of src) {
			if (/^#\s+/.test(line)) {
				title = line.trim();
				break;
			}
		}
		if (!title) title = '# ' + (year && week ? weekShort(year, week) : '每周计划');

		const out = [title, ''];
		for (let d = 0; d < DAYS.length; d++) {
			out.push('## ' + (year && week ? dayLabel(year, week, d) : DAYS[d]));
			out.push('');
			for (let q = 0; q < QUADRANTS.length; q++) {
				out.push('### ' + QUADRANTS[q].title);
				const tasks = d === 0 ? parsed.days[0].quads[q].tasks : [];
				for (const t of tasks) out.push('- [' + (t.done ? 'x' : ' ') + '] ' + t.text);
				out.push('');
			}
		}
		if (pdcaStart >= 0) {
			out.push(...src.slice(pdcaStart));
		} else {
			out.push('## PDCA 复盘', '');
			for (const p of PDCA) out.push('### ' + p.title, '');
		}
		return out.join('\n');
	}

	// ------------------------------------------------------------------
	// 导入上一周未完成
	// ------------------------------------------------------------------
	/** @returns {Array<{day:number, quad:number, text:string}>} */
	function collectUnfinished(text) {
		const parsed = parse(text);
		const out = [];
		for (let d = 0; d < parsed.days.length; d++) {
			for (let q = 0; q < QUADRANTS.length; q++) {
				for (const t of parsed.days[d].quads[q].tasks) {
					if (!t.done) out.push({ day: d, quad: q, text: t.text });
				}
			}
		}
		return out;
	}

	/**
	 * 把上一周未完成的任务并入本周（按文本去重，保持原星期与原象限）。
	 * @returns {{text:string, added:number}}
	 */
	function mergeUnfinished(currentText, items) {
		let text = String(currentText == null ? '' : currentText);
		if (!text.trim()) text = '';

		const existing = new Set();
		const parsed = parse(text);
		for (let d = 0; d < parsed.days.length; d++) {
			for (let q = 0; q < QUADRANTS.length; q++) {
				for (const t of parsed.days[d].quads[q].tasks) existing.add(t.text);
			}
		}

		let added = 0;
		for (const item of items) {
			if (existing.has(item.text)) continue;
			const next = addTask(text, item.day || 0, item.quad || 0, item.text);
			if (next === null) continue;
			text = next;
			existing.add(item.text);
			added++;
		}
		return { text, added };
	}

	/** 某一天里未完成的任务 */
	function unfinishedOf(text, day) {
		const parsed = parse(text);
		const d = Math.max(0, Math.min(DAYS.length - 1, Number(day) || 0));
		const out = [];
		for (let q = 0; q < QUADRANTS.length; q++) {
			for (const t of parsed.days[d].quads[q].tasks) {
				if (!t.done) out.push({ day: d, quad: q, text: t.text, line: t.line });
			}
		}
		return out;
	}

	/**
	 * 把 fromDay 的未完成任务迁到 toDay：
	 * ① 源任务勾选完成并在名称后加 (未完成)；② 在 toDay 同象限追加一份（已存在同名则跳过）。
	 * @returns {{text:string, items:Array<{text:string, quad:number}>}}
	 */
	function carryOver(text, fromDay, toDay) {
		let src = String(text == null ? '' : text);
		const items = unfinishedOf(src, fromDay);
		if (!items.length) return { text: src, items: [] };

		// 先改源行（从后往前，避免行号漂移）
		const lines = src.split('\n');
		for (let k = items.length - 1; k >= 0; k--) {
			const it = items[k];
			const m = TASK_RE.exec(lines[it.line]);
			if (!m) continue;
			const name = m[3].indexOf('(未完成)') >= 0 ? m[3] : m[3].trimEnd() + '(未完成)';
			lines[it.line] = m[1] + '- [x] ' + name;
		}
		src = lines.join('\n');

		// 再往目标天追加
		const existing = new Set();
		const parsed = parse(src);
		for (let q = 0; q < QUADRANTS.length; q++) {
			for (const t of parsed.days[toDay].quads[q].tasks) existing.add(t.text);
		}
		const moved = [];
		for (const it of items) {
			if (existing.has(it.text)) continue;
			const next = addTask(src, toDay, it.quad, it.text);
			if (!next) continue;
			src = next;
			existing.add(it.text);
			moved.push({ text: it.text, quad: it.quad });
		}
		return { text: src, items: moved };
	}

	/** 往 PDCA 四节追加「未完成任务」记录（每条四行） */
	function appendPdca(text, weekLabel, entries) {
		if (!entries || !entries.length) return text;
		let src = String(text == null ? '' : text);
		const suffix = weekLabel ? '（' + weekLabel + '）' : '';
		for (let k = 0; k < entries.length; k++) {
			const e = entries[k];
			const name = String(e.text || '').trim();
			if (!name) continue;
			const reason = String(e.reason || '').trim() || '未填写';
			const improve = String(e.improve || '').trim() || '未填写';
			src = appendPdcaLine(src, 0, '- ' + name + suffix);
			src = appendPdcaLine(src, 1, '- ' + name + suffix + '未完成');
			src = appendPdcaLine(src, 2, '- ' + name + suffix + '记录未完成原因：' + reason);
			src = appendPdcaLine(src, 3, '- ' + name + suffix + '预计改进方法：' + improve);
		}
		return src;
	}

	/** 在某个 PDCA 小节末尾追加一行（小节缺失时补） */
	function appendPdcaLine(text, index, line) {
		const lines = String(text == null ? '' : text).split('\n');
		let inPdca = false;
		let start = -1;
		let end = -1;
		for (let i = 0; i < lines.length; i++) {
			const h2 = /^##\s+(.*)$/.exec(lines[i]);
			if (h2) {
				if (inPdca && start >= 0) {
					end = i;
					break;
				}
				inPdca = h2[1].indexOf('PDCA') >= 0;
				continue;
			}
			const h3 = /^###\s+(.*)$/.exec(lines[i]);
			if (h3 && inPdca) {
				if (start >= 0) {
					end = i;
					break;
				}
				if (pdcaIndexOf(h3[1]) === index) start = i;
			}
		}
		if (start < 0) {
			// 没有这一节：补在文末
			lines.push('## PDCA 复盘', '', '### ' + PDCA[index].title, line, '');
			return lines.join('\n');
		}
		if (end < 0) end = lines.length;
		let insertAt = end;
		while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--;
		lines.splice(insertAt, 0, line);
		return lines.join('\n');
	}
	/** 汇总一周的完成情况 */
	function totals(parsed) {
		let total = 0;
		let done = 0;
		for (let d = 0; d < parsed.days.length; d++) {
			for (let q = 0; q < QUADRANTS.length; q++) {
				const tasks = parsed.days[d].quads[q].tasks;
				total += tasks.length;
				for (const t of tasks) if (t.done) done++;
			}
		}
		return { total, done };
	}

	return {
		DAYS,
		dayName,
		QUADRANTS,
		PDCA,
		TASK_RE,
		isoWeekOf,
		mondayOf,
		weeksInYear,
		shiftWeek,
		dayDate,
		dayLabel,
		todayIndex,
		weekTitle,
		weekShort,
		planPath,
		skeleton,
		parse,
		dayIndexOf,
		quadrantIndexOf,
		pdcaIndexOf,
		toggleTask,
		findTaskLine,
		setTaskText,
		addTask,
		removeTask,
		setPdca,
		migrateLegacy,
		unfinishedOf,
		carryOver,
		appendPdca,
		collectUnfinished,
		mergeUnfinished,
		totals,
	};
})();

// ---- src/renderer.js ----
// ============================================================================
// renderer.js — Canvas 2D 渲染（单色星图：点 + 弧线尾迹 + 极淡连线）
//
// 全部在「屏幕像素」空间绘制（手动投影），线宽恒定，缩放不糊。
// 背景透明交给 CSS 变量；颜色统一取 canvas 的计算样式 color（跟随主题），
// 只靠透明度区分层次，不再有调色板与文字标签。
// ============================================================================
const Render = (function () {
	const MIN_SCREEN_RADIUS = 2.2; // 球体在屏幕上的最小半径
	const SAT_MIN_SCREEN_RADIUS = 1.5; // 标签卫星的最小屏幕半径（更小，便于体现大小差异）
	const SAT_FADE_FROM = 0.9; // 低于此缩放：卫星完全不可见
	const SAT_FADE_TO = 1.3; // 高于此缩放：卫星完全可见
	const TRAIL_SPAN = 0.75; // 轨迹最长弧度（再乘设置里的「轨迹长度」）
	// canvas 的 ctx.font 不认 CSS 变量，必须给具体字体族（中文楷体、西文 Times New Roman）
	const CLOCK_FONT = '"Times New Roman", "KaiTi", "STKaiti", "楷体", serif';
	class Renderer {
		constructor(canvas) {
			this.canvas = canvas;
			this.ctx = canvas.getContext('2d');
			this.dpr = 0;
			this.w = 0;
			this.h = 0;
			this.fg = null;
		}

		resize() {
			const rect = this.canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const w = Math.max(1, Math.round(rect.width));
			const h = Math.max(1, Math.round(rect.height));
			if (w === this.w && h === this.h && dpr === this.dpr) return;
			this.dpr = dpr;
			this.w = w;
			this.h = h;
			this.canvas.width = Math.round(w * dpr);
			this.canvas.height = Math.round(h * dpr);
			this.fg = null;
		}

		foreground() {
			if (this.fg) return this.fg;
			let color = 'rgb(140,140,140)';
			try {
				color = window.getComputedStyle(this.canvas).color || color;
			} catch (e) {
				/* 取不到就用默认灰 */
			}
			this.fg = Core.parseCssColor(color);
			return this.fg;
		}

		projectX(x, model) {
			return (x - model.ox) * model.scale + this.w / 2;
		}

		projectY(y, model) {
			return (y - model.oy) * model.scale + this.h / 2;
		}

		screenToWorld(sx, sy, model) {
			return {
				x: (sx - this.w / 2) / model.scale + model.ox,
				y: (sy - this.h / 2) / model.scale + model.oy,
			};
		}

		begin() {
			const ctx = this.ctx;
			ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			ctx.clearRect(0, 0, this.w, this.h);
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			return ctx;
		}

		drawMessage(title, sub) {
			const ctx = this.begin();
			const fg = this.foreground();
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.font = '600 16px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.fillStyle = Core.rgba(fg, 0.78);
			ctx.fillText(title, this.w / 2, this.h / 2 - 12);
			if (sub) {
				ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
				ctx.fillStyle = Core.rgba(fg, 0.5);
				ctx.fillText(sub, this.w / 2, this.h / 2 + 16);
			}
		}

		draw(model) {
			const ctx = this.begin();
			const n = model.n;
			if (!n) return;

			const fg = this.foreground();
			const s = model.scale;
			const ox = this.oxScreen(model);
			const oy = this.oyScreen(model);

			const margin = 80 / s;
			const halfW = this.w / 2 / s;
			const halfH = this.h / 2 / s;
			const left = model.ox - halfW - margin;
			const right = model.ox + halfW + margin;
			const top = model.oy - halfH - margin;
			const bottom = model.oy + halfH + margin;
			const inside = (x, y) => x >= left && x <= right && y >= top && y <= bottom;

			const xs = model.xs;
			const ys = model.ys;
			const rads = model.rads;
			const kinds = model.kinds;

			// ---------- 连线：默认不画，只在悬停时画该球的关联连线（每对一根） ----------
			const hoverIdx = model.hover;
			const hoverLinks = model.hoverLinks;
			if (hoverIdx !== undefined && hoverIdx >= 0 && hoverLinks && hoverLinks.length) {
				const warm = model.linkWarm ? Core.hexToRgb(model.linkWarm) : fg;
				const cool = model.linkCool ? Core.hexToRgb(model.linkCool) : fg;
				const outFlags = model.linkOut;
				const t = model.clock || 0;
				const hx0 = this.projectX(xs[hoverIdx], model);
				const hy0 = this.projectY(ys[hoverIdx], model);

				for (let k = 0; k < hoverLinks.length; k++) {
					const j = hoverLinks[k];
					const isOut = !outFlags || outFlags[j] === 1;
					const x1 = this.projectX(xs[j], model);
					const y1 = this.projectY(ys[j], model);

					// 单线 + 双色渐变：靠悬停球一侧暖（出链）/冷（入链）
					const grad = ctx.createLinearGradient(hx0, hy0, x1, y1);
					if (isOut) {
						grad.addColorStop(0, Core.rgba(warm, 0.55));
						grad.addColorStop(1, Core.rgba(cool, 0.3));
					} else {
						grad.addColorStop(0, Core.rgba(cool, 0.55));
						grad.addColorStop(1, Core.rgba(warm, 0.3));
					}
					ctx.strokeStyle = grad;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(hx0, hy0);
					ctx.lineTo(x1, y1);
					ctx.stroke();

					// 流光：出链从悬停球向外、入链向内
					for (let d = 0; d < 2; d++) {
						let f = (t * 0.35 + d * 0.5 + k * 0.17) % 1;
						if (f < 0) f += 1;
						const frac = isOut ? f : 1 - f;
						const px = hx0 + (x1 - hx0) * frac;
						const py = hy0 + (y1 - hy0) * frac;
						const col = isOut ? warm : cool;
						ctx.fillStyle = Core.rgba(col, 0.85);
						ctx.beginPath();
						ctx.arc(px, py, 1.7, 0, Core.TAU);
						ctx.fill();
					}
				}
			}

			// ---------- 彗星尾迹：沿椭圆采样的渐隐折线 ----------
			const cometMask = model.cometMask;
			const cometTrails = model.cometTrails;
			if (cometTrails && cometTrails.length) {
				ctx.lineWidth = 1.2;
				for (let c = 0; c < cometTrails.length; c++) {
					const pts = cometTrails[c].pts;
					for (let k = pts.length - 1; k > 0; k--) {
						const alpha = 0.26 * (1 - (k - 1) / pts.length);
						ctx.strokeStyle = Core.rgba(fg, alpha);
						ctx.beginPath();
						ctx.moveTo(this.projectX(pts[k][0], model), this.projectY(pts[k][1], model));
						ctx.lineTo(this.projectX(pts[k - 1][0], model), this.projectY(pts[k - 1][1], model));
						ctx.stroke();
					}
				}
			}

			// ---------- 尾迹：沿各自圆轨道的一段淡弧（方向跟随该球的转动方向）----------
			const trail = Core.clamp(model.trail || 0, 0, 1);
			if (trail > 0.01) {
				const dirs = model.dirs;
				ctx.lineWidth = 1;
				const span = TRAIL_SPAN * trail;
				for (let i = 0; i < n; i++) {
					if (cometMask && cometMask[i]) continue; // 彗星用上面的折线
					const x = xs[i];
					const y = ys[i];
					if (!inside(x, y)) continue;
					const r = Math.hypot(x, y);
					if (r * s < 6) continue; // 太靠近中心就不画，避免糊成一团
					const headAng = Math.atan2(y, x);
					// 倒计时期间时间球在逆时针扫动 → 尾巴要画在反侧
					const isClockDown = model.clockDown && model.clockHands && model.clockHands[i];
					const dir = isClockDown ? -1 : dirs && dirs[i] < 0 ? -1 : 1;
					const tailAng = headAng - span * dir; // dir=−1 时尾迹在另一侧
					const a0 = Math.min(tailAng, headAng);
					const a1 = Math.max(tailAng, headAng);

					const hx = this.projectX(x, model);
					const hy = this.projectY(y, model);
					const tx = this.projectX(Math.cos(tailAng) * r, model);
					const ty = this.projectY(Math.sin(tailAng) * r, model);

					const grad = ctx.createLinearGradient(tx, ty, hx, hy);
					grad.addColorStop(0, Core.rgba(fg, 0));
					grad.addColorStop(1, Core.rgba(fg, 0.18));
					ctx.strokeStyle = grad;
					ctx.beginPath();
					ctx.arc(ox, oy, r * s, a0, a1);
					ctx.stroke();
				}
			}

			// ---------- 球体：全部圆形，颜色来自色系或单节点自定义 ----------
			const colors = model.colors;
			for (let i = 0; i < n; i++) {
				const x = xs[i];
				const y = ys[i];
				if (!inside(x, y)) continue;
				const sx = this.projectX(x, model);
				const sy = this.projectY(y, model);
				const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);

				const base = colors && colors[i] ? Core.hexToRgb(colors[i]) : fg;
				const isCenter = kinds[i] === 2;
				let alpha = isCenter ? 0.95 : kinds[i] === 1 ? 0.72 : 0.86;
				const hits = model.searchHits;
				if (hits) alpha = hits[i] ? Math.min(1, alpha + 0.1) : alpha * 0.35;
				ctx.fillStyle = Core.rgba(base, alpha);
				ctx.beginPath();
				ctx.arc(sx, sy, rr, 0, Core.TAU);
				ctx.fill();

				if (kinds[i] === 1) {
					// PDF：加一道很细的描边作为识别，形状仍是圆
					ctx.strokeStyle = Core.rgba(base, 0.6);
					ctx.lineWidth = 1.2;
					ctx.beginPath();
					ctx.arc(sx, sy, rr + 2.2, 0, Core.TAU);
					ctx.stroke();
				}
			}

			// ---------- 搜索命中：显示名称 + 细环 ----------
			const searchHits = model.searchHits;
			if (searchHits) {
				for (let i = 0; i < n; i++) {
					if (!searchHits[i]) continue;
					if (!inside(xs[i], ys[i])) continue;
					const sx = this.projectX(xs[i], model);
					const sy = this.projectY(ys[i], model);
					const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);
					const base = colors && colors[i] ? Core.hexToRgb(colors[i]) : fg;
					ctx.save();
					ctx.strokeStyle = Core.rgba(base, 0.9);
					ctx.lineWidth = 1.4;
					ctx.beginPath();
					ctx.arc(sx, sy, rr + 3.5, 0, Core.TAU);
					ctx.stroke();
					ctx.restore();
					this.drawNodeLabel(model, i, fg, 0.95);
				}
			}

			// ---------- M1：悬停球的轨道轮廓 ----------
			const outline = model.hoverOrbit;
			if (outline) {
				ctx.save();
				ctx.strokeStyle = Core.rgba(fg, 0.18);
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);
				const cx0 = this.projectX(0, model);
				const cy0 = this.projectY(0, model);
				ctx.beginPath();
				if (outline.circle) {
					ctx.arc(cx0, cy0, Math.max(1, outline.r * s), 0, Core.TAU);
				} else {
					const a = outline.a * s;
					const b = outline.b * s;
					const focusOffset = outline.a * outline.e * s;
					if (a > 0.5 && b > 0.5) ctx.ellipse(cx0 + focusOffset, cy0, a, b, 0, 0, Core.TAU);
				}
				ctx.stroke();
				ctx.restore();
			}
			// ---------- 标签卫星：绕宿主的小圆点，悬停宿主时显示标签名 ----------
			const satellites = model.satellites;
			const satAlpha = Core.clamp((s - SAT_FADE_FROM) / (SAT_FADE_TO - SAT_FADE_FROM), 0, 1);
			model.satAlpha = satAlpha;
			if (satellites && satellites.length && satAlpha > 0.01) {
				for (let k = 0; k < satellites.length; k++) {
					const sat = satellites[k];
					if (!inside(sat.x, sat.y)) continue;
					const sx = this.projectX(sat.x, model);
					const sy = this.projectY(sat.y, model);
					const rr = sat.r * s;
					if (rr < 0.35) continue;
					const col = sat.color ? Core.hexToRgb(sat.color) : fg;
					ctx.fillStyle = Core.rgba(col, 0.8 * satAlpha);
					ctx.beginPath();
					ctx.arc(sx, sy, rr, 0, Core.TAU);
					ctx.fill();
				}

				// 悬停宿主 → 把它的标签名画在卫星旁
				const hv = model.hover;
				if (hv !== undefined && hv >= 0 && satAlpha > 0.99) {
					ctx.font = '10px var(--font-interface, sans-serif)';
					ctx.fillStyle = Core.rgba(fg, 0.75 * satAlpha);
					for (let k = 0; k < satellites.length; k++) {
						const sat = satellites[k];
						if (sat.host !== hv) continue;
						if (!inside(sat.x, sat.y)) continue;
						const sx = this.projectX(sat.x, model);
						const sy = this.projectY(sat.y, model);
						ctx.fillText(sat.tag, sx + sat.r * s + 3, sy + 3);
					}
				}
			}

			// ---------- M8：键盘焦点环 / M4：命中标签的提示字 ----------
			const focusIdx = model.focus;
			if (focusIdx !== undefined && focusIdx >= 0 && focusIdx < n) {
				const fx = this.projectX(xs[focusIdx], model);
				const fy = this.projectY(ys[focusIdx], model);
				ctx.save();
				ctx.strokeStyle = Core.rgba(fg, 0.75);
				ctx.lineWidth = 1.6;
				ctx.setLineDash([3, 3]);
				ctx.beginPath();
				ctx.arc(fx, fy, Math.max(rads[focusIdx] * s, MIN_SCREEN_RADIUS) + 5, 0, Core.TAU);
				ctx.stroke();
				ctx.restore();
				// 键盘焦点也显示名称（与悬停是同一颗时只画一次）
				if (focusIdx !== model.hover) this.drawNodeLabel(model, focusIdx, fg, 0.85);
			}
			const clockText = model.clockText;
			if (clockText) {
				const centerIdx = model.center;
				const centerColor = colors && centerIdx >= 0 && colors[centerIdx] ? colors[centerIdx] : null;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				for (let i = 0; i < n; i++) {
					const text = clockText[i];
					if (!text) continue;
					if (!inside(xs[i], ys[i])) continue;
					const sx = this.projectX(xs[i], model);
					const sy = this.projectY(ys[i], model);
					const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);
					// 字号跟着球的屏幕尺寸走（canvas 不认 CSS 变量，必须给具体字体族）
					const px = Math.min(rr * 1.15, Math.max(7, rr * 1.05));
					ctx.font = '600 ' + px.toFixed(1) + 'px ' + CLOCK_FONT;
					ctx.fillStyle = centerColor || Core.rgba(fg, 0.95);
					ctx.fillText(text, sx, sy + 0.5);
				}
				ctx.textAlign = 'start';
				ctx.textBaseline = 'alphabetic';
			}

			// ---------- 悬停：细高亮环 + 只给这一个节点显示名称 ----------
			const hover = model.hover;
			if (hover !== undefined && hover >= 0 && hover < n) {
				const sx = this.projectX(xs[hover], model);
				const sy = this.projectY(ys[hover], model);
				const rr = Math.max(rads[hover] * s, MIN_SCREEN_RADIUS);
				const base = colors && colors[hover] ? Core.hexToRgb(colors[hover]) : fg;

				ctx.strokeStyle = Core.rgba(base, 0.8);
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.arc(sx, sy, rr + 3.5, 0, Core.TAU);
				ctx.stroke();

				this.drawNodeLabel(model, hover, fg, 0.92);
			}

			// 倒计时到点：整幅画布叠一层 accent 色呼吸
			if (model.breathing) {
				const col = model.accentColor ? Core.hexToRgb(model.accentColor) : fg;
				const phase = 0.5 + 0.5 * Math.sin((model.breathT || 0) * Math.PI);
				ctx.fillStyle = Core.rgba(col, 0.05 + 0.1 * phase);
				ctx.fillRect(0, 0, this.w, this.h);
			}
			this.drawPausedHint(model, fg);
		}

		/** 在球上方（或下方）画名称，含画布边缘避让 */
		drawNodeLabel(model, i, fg, alpha) {
			if (i === undefined || i < 0) return;
			const text = model.labels && model.labels[i];
			if (!text) return;
			const ctx = this.ctx;
			const s = model.scale;
			const rr = Math.max((model.rads[i] || 0) * s, MIN_SCREEN_RADIUS);
			const sx = this.projectX(model.xs[i], model);
			const sy = this.projectY(model.ys[i], model);

			ctx.font = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			const half = Math.min(ctx.measureText(String(text)).width / 2 + 6, this.w / 2 - 4);
			const tx = Core.clamp(sx, half, this.w - half);
			let ty = sy - rr - 8;
			if (ty < 16) {
				ty = sy + rr + 22;
				ctx.textBaseline = 'top';
			}
			ctx.fillStyle = Core.rgba(fg, alpha);
			ctx.fillText(String(text), tx, ty);
		}
		oxScreen(model) {
			return this.projectX(0, model);
		}

		oyScreen(model) {
			return this.projectY(0, model);
		}

		drawPausedHint(model, fg) {
			if (!model.paused) return;
			const ctx = this.ctx;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'bottom';
			ctx.font = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.fillStyle = Core.rgba(fg, 0.55);
			ctx.fillText(Core.STR.pausedHint, 14, this.h - 12);
		}
	}

	return { Renderer };
})();

// ---- src/view-consts.js ----
// ============================================================================
// view-consts.js — 视图层的模块级常量（split 出来的 mixin 与 view.js 共用）
// ============================================================================
const ViewConsts = (function () {
	const BASE_SPIN = 0.34; // rad/s，spin=1 时约 19°/秒
	const LAG_TAU = 0.16; // 解冻后「追上」的时间常数，约 0.5 秒归位
	const HIT_COOLDOWN = 3; // PDF 彗星撞击同一颗球的冷却（秒）
	const FILL_COOLDOWN = 2; // 空轨补位后该球的冷却（秒），避免来回拉锯
	const PROMOTE_THROTTLE = 0.2; // 贴近升轨的最小间隔（秒）
	const SAT_SIZE_RATIO = 0.15; // 卫星半径 = 宿主半径 × 0.15
	const SAT_TURNS = 10; // 宿主转 1 圈，卫星转 10 圈
	const AVOID_ANGLE = 0.35; // 星带避让：与分针球角度差小于 20° 就让位
	const AVOID_SHIFT = 0.12; // 星带避让：最多沿径向让开 12%
	const COMET_TRAIL_SEC = 1.8; // 彗星拖尾的时间窗口（秒，再乘「轨迹长度」）
	const PROMOTE_FACTOR = 2; // 「过近」的判定：(r₁+r₂) × 2（斥力分离阈值为 1.7 倍）
	return { BASE_SPIN, LAG_TAU, HIT_COOLDOWN, FILL_COOLDOWN, PROMOTE_THROTTLE, SAT_SIZE_RATIO, SAT_TURNS, AVOID_ANGLE, AVOID_SHIFT, COMET_TRAIL_SEC, PROMOTE_FACTOR };
})();
const { BASE_SPIN, LAG_TAU, HIT_COOLDOWN, FILL_COOLDOWN, PROMOTE_THROTTLE, SAT_SIZE_RATIO, SAT_TURNS, AVOID_ANGLE, AVOID_SHIFT, COMET_TRAIL_SEC, PROMOTE_FACTOR } = ViewConsts;

// ---- src/view-graph.js ----
class ColorModal extends Modal {
	constructor(app, current, onApply) {
		super(app);
		this.current = current || '#F7B267';
		this.onApply = onApply;
		this.picked = this.current;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.classList.add('graph-orbit-modal');

		contentEl.createEl('h3', { text: Core.STR.colorTitle });
		contentEl.createEl('p', { text: Core.STR.colorDesc, cls: 'graph-orbit-modal-desc' });

		const row = contentEl.createDiv({ cls: 'graph-orbit-color-row' });
		const input = row.createEl('input', { cls: 'graph-orbit-color-input' });
		input.setAttribute('type', 'color');
		input.value = this.current;
		const hexLabel = row.createSpan({ text: this.current.toUpperCase(), cls: 'graph-orbit-color-hex' });

		input.addEventListener('input', () => {
			this.picked = input.value;
			hexLabel.setText(String(input.value).toUpperCase());
		});

		const actions = contentEl.createDiv({ cls: 'graph-orbit-color-actions' });

		const applyBtn = actions.createEl('button', { text: Core.STR.colorApply, cls: 'mod-cta' });
		applyBtn.addEventListener('click', () => {
			this.onApply(this.picked);
			this.close();
		});

		const clearBtn = actions.createEl('button', { text: Core.STR.colorClear });
		clearBtn.addEventListener('click', () => {
			this.onApply(null);
			this.close();
		});

		const cancelBtn = actions.createEl('button', { text: Core.STR.colorCancel });
		cancelBtn.addEventListener('click', () => this.close());
	}

	/** 顺序：任务1原因 → 任务1改进 → 任务2原因 → … 末尾时若有空项先补空项，全填则保存 */
	stepNext(fromInput) {
		const seq = [];
		for (const row of this.rows) {
			seq.push({ input: row.reason, row }, { input: row.improve, row });
		}
		const at = (i) => seq[i];
		const cur = seq.findIndex((e) => e.input === fromInput);
		const focusItem = (item) => {
			if (!item) return;
			// 先展开卡片再聚焦（隐藏元素无法获得焦点）
			if (item.row && item.row.body) {
				item.row.body.style.display = '';
				if (item.row.chev) item.row.chev.setText('▾');
			}
			if (item.input.focus) item.input.focus();
		};

		const next = cur >= 0 ? at(cur + 1) : at(0);
		if (next) {
			focusItem(next);
			return;
		}
		// 已到末尾：还有空项就先跳过去（同样先展开）
		for (const item of seq) {
			if (!String(item.input.value || '').trim()) {
				focusItem(item);
				return;
			}
		}
		if (this.contentEl && this.contentEl.__submit) this.contentEl.__submit();
	}
	onClose() {
		this.contentEl.empty();
	}
}

// ============================================================================
// ViewGraph — OrbitView 的一部分（通过 Object.assign 混入，方法内 this 指向视图）
// ============================================================================
const ViewGraph = {
	allocate(n) {
		this.rho = new Float64Array(n);
		this.rhoTarget = new Float64Array(n);
		this.theta0 = new Float64Array(n);
		this.theta0Target = new Float64Array(n);
		this.xs = new Float64Array(n);
		this.ys = new Float64Array(n);
		this.rads = new Float64Array(n);
		this.kinds = new Int8Array(n);
		this.pdfLink = new Int32Array(n);
		this.pdfXs = new Float64Array(n);
		this.pdfYs = new Float64Array(n);
		this.labels = new Array(n);
		this.colors = new Array(n);
		this.cometMask = new Int8Array(n);
		this.holdClock = new Float64Array(n);
		this.lag = new Float64Array(n);
		this.hitAt = new Float64Array(n);
	},

	rebuild() {
		if (!this.renderer) return;
		const g = GraphBuilder.buildGraph(this.app);
		this.graph = g;
		// 清理指向已删除/改名笔记的拖拽记忆
		const pins = this.plugin.settings.pins;
		if (pins && typeof pins === 'object') {
			let changed = false;
			for (const p of Object.keys(pins)) {
				if (!g.index || !g.index.has(p)) {
					delete pins[p];
					changed = true;
				}
			}
			if (changed) this.plugin.scheduleSave();
		}
		this.bump = {}; // 数据变化后按抖动规则重新定轨，撞下来的临时降轨清空
		const n = g.nodes.length;

		if (n !== this.n) {
			this.allocate(n);
			this.n = n;
		}
		if (this.hovered >= this.n) this.hovered = -1;
		if (!n) return;

		for (let i = 0; i < n; i++) {
			const node = g.nodes[i];
			this.kinds[i] = node.kind === GraphBuilder.KIND_PDF ? 1 : 0;
			this.labels[i] = node.label;
			this.pdfLink[i] = -1;
		}

		this.applyLayout(!this.hasFit); // 首次吸附，之后平滑过渡，不瞬移
		if (g.center >= 0) this.kinds[g.center] = 2;
		this.buildAdjacency();
	},

	/** 无向邻接：悬停时画出这个球的所有邻居连线（每对一根） */
	buildAdjacency() {
		const adj = new Array(this.n);
		for (let i = 0; i < this.n; i++) adj[i] = [];
		if (this.graph) {
			const edges = this.graph.edges;
			for (let e = 0; e < edges.length; e++) {
				adj[edges[e][0]].push(edges[e][1]);
				adj[edges[e][1]].push(edges[e][0]);
			}
		}
		this.adj = adj;
	},

	applyLayout(snap) {
		if (!this.graph) return;
		const res = Layout.build(this.graph, this.plugin.settings);
		this.recs = res.nodes;
		this.layoutMaxR = res.maxR;
		this.ellipseByOrbit = res.ellipses || null;

		for (let i = 0; i < this.n; i++) {
			const rec = res.nodes[i];
			this.rhoTarget[i] = rec.rho;
			this.theta0Target[i] = rec.theta0;
			this.cometMask[i] = rec.comet ? 1 : 0;
			if (snap || this.rho[i] === 0) {
				this.rho[i] = rec.rho;
				this.theta0[i] = rec.theta0;
			}
		}

		// 轨道半径索引（s → rho）；彗星也占一条轨道，所以只跳过中心球
		const rhoByOrbit = new Map();
		for (let i = 0; i < this.n; i++) {
			const rec = res.nodes[i];
			if (rec.root || rec.orbit < 0) continue;
			if (!rhoByOrbit.has(rec.orbit)) rhoByOrbit.set(rec.orbit, rec.rho);
		}

		const pins = this.plugin.settings.pins || {};
		const bump = this.bump || {};
		this.rhoByOrbit = rhoByOrbit;
		if (!this.orbitNow || this.orbitNow.length !== this.n) this.orbitNow = new Int32Array(this.n);
		for (let i = 0; i < this.n; i++) {
			const rec = res.nodes[i];
			const path = this.graph.nodes[i].path;
			let target = null;
			if (pins[path] !== undefined) target = pins[path];
			else if (bump[path]) target = Math.max(0, rec.orbit + bump[path]);
			if (target === null) {
				this.orbitNow[i] = rec.orbit;
				continue;
			}
			const rho = rhoByOrbit.get(target);
			if (rho == null) {
				this.orbitNow[i] = rec.orbit;
				continue;
			}
			this.orbitNow[i] = target;
			this.rhoTarget[i] = rho;
			// 归一化：把临时偏移重新基准到「布局轨道 → 当前轨道」，避免长期累计漂移
			if (bump[path] !== undefined) this.bump[path] = target - rec.orbit;
			rec.dir = target + 1 >= 3 ? -1 : 1; // 方向跟随所在轨道
		}

		this.cometPdfs = [];
		this.cometMds = [];
		this.clockMinuteIdx = -1;
		this.dirs = new Float64Array(this.n);
		for (let i = 0; i < this.n; i++) {
			const rec = res.nodes[i];
			this.dirs[i] = rec.dir === -1 ? -1 : 1;
			if (rec.clockHand === 'm') this.clockMinuteIdx = i;
			if (!rec.comet) continue;
			if (rec.pdfComet) this.cometPdfs.push(i);
			else this.cometMds.push(i);
		}

		this.linkPdfs();
		this.needRecolor = true;
	},

	/** 给每个与 PDF 相连的笔记挑一个最近的 PDF（用于有界吸引） */
	linkPdfs() {
		if (!this.graph || !this.recs) return;
		for (let i = 0; i < this.n; i++) this.pdfLink[i] = -1;

		const pdfs = [];
		for (let i = 0; i < this.n; i++) {
			if (this.kinds[i] === 1) pdfs.push(i);
		}
		if (!pdfs.length) return;

		const px = new Float64Array(this.n);
		const py = new Float64Array(this.n);
		for (let k = 0; k < pdfs.length; k++) {
			const idx = pdfs[k];
			const rec = this.recs[idx];
			px[idx] = Math.cos(rec.theta0) * rec.rho;
			py[idx] = Math.sin(rec.theta0) * rec.rho;
		}

		for (let e = 0; e < this.graph.edges.length; e++) {
			const a = this.graph.edges[e][0];
			const b = this.graph.edges[e][1];
			const aPdf = this.kinds[a] === 1;
			const bPdf = this.kinds[b] === 1;
			if (aPdf === bPdf) continue;
			const md = aPdf ? b : a;
			const pdf = aPdf ? a : b;

			const mx = Math.cos(this.theta0Target[md]) * this.rhoTarget[md];
			const my = Math.sin(this.theta0Target[md]) * this.rhoTarget[md];
			const d = Math.hypot(px[pdf] - mx, py[pdf] - my);

			const cur = this.pdfLink[md];
			if (cur < 0) {
				this.pdfLink[md] = pdf;
				continue;
			}
			const cd = Math.hypot(px[cur] - mx, py[cur] - my);
			if (d < cd) this.pdfLink[md] = pdf;
		}
	},

	fit() {
		if (!this.renderer) return;
		const maxR = Math.max(this.layoutMaxR, 1);
		const usableW = Math.max(120, this.renderer.w - 120);
		const usableH = Math.max(120, this.renderer.h - 100);
		const s = Math.min(usableW / (2 * maxR), usableH / (2 * maxR));
		this.scale = Core.clamp(s, 0.02, 2.2);
		this.ox = 0;
		this.oy = 0;
	},

	isOnScreen() {
		const el = this.canvasEl;
		return !!el && el.isConnected && el.offsetWidth > 1 && el.offsetHeight > 1;
	},

	tick(now) {
		const dt = Core.clamp((now - this.lastTs) / 1000, 0, 0.1);
		this.lastTs = now;

		if (this.isOnScreen()) {
			if (!this.hasFit && this.n > 0) {
				if (this.renderer.w > 120 && this.renderer.h > 120) {
					this.fit();
					this.hasFit = true;
				} else if (++this.fitWait > 120) {
					this.fit();
					this.hasFit = true;
				}
			}
			const s = this.plugin.settings;
			if (!this.paused && s.spin > 0) this.clock += dt * s.spin;
			this.wall = this.now(); // 时钟针按系统时间定位，一帧内只取一次
		if (this.timerActive) this.renderTimer();
			this.updateFrame(dt);
			this.fillEmptyOrbits();
			this.paint();
		}

		this.frameId = window.requestAnimationFrame(this.tick);
	},

	/** 悬停切换：进入时记下该节点的时钟，离开时把时间差记成 lag，之后平滑追上 */
	setHovered(i) {
		const next = i >= 0 && i < this.n ? i : -1;
		if (next === this.hovered) return;
		const prev = this.hovered;
		if (prev >= 0 && prev < this.n) {
			const lag = this.clock - this.holdClock[prev];
			if (lag > 0) this.lag[prev] = lag;
		}
		this.hovered = next;
		if (this.hovered >= 0) this.holdClock[this.hovered] = this.clock;
	},

	updateFrame(dt) {
		if (!this.graph || !this.recs) return;
		const s = this.plugin.settings;
		const ease = 1 - Math.exp(-dt * 7);
		const sizeK = s.nodeScale;

		const clockOf = (i) => {
			if (i === this.hovered) return this.holdClock[i];
			if (this.lag[i] > 0.0005) {
				this.lag[i] *= Math.exp(-dt / LAG_TAU);
				if (this.lag[i] < 0.0005) this.lag[i] = 0;
			}
			return this.clock - this.lag[i];
		};

		for (let i = 0; i < this.n; i++) {
			this.rho[i] += (this.rhoTarget[i] - this.rho[i]) * ease;
			this.theta0[i] += Core.angleDelta(this.theta0[i], this.theta0Target[i]) * ease;
		}

		for (let i = 0; i < this.n; i++) {
			if (this.kinds[i] !== 1) continue;
			const rec = this.recs[i];
			const t = clockOf(i);
			const p = Layout.pose(
				rec,
				{ clock: t, base: t * BASE_SPIN, sizeK, wall: this.wall, handAngles: this.handAngles },
				{ rho: this.rho[i], theta0: this.theta0[i] }
			);
			this.xs[i] = p.x;
			this.ys[i] = p.y;
			this.rads[i] = p.radius;
			this.pdfXs[i] = p.x;
			this.pdfYs[i] = p.y;
		}

		const dragIdx = this.nodeDrag ? this.nodeDrag.i : -1;
		for (let i = 0; i < this.n; i++) {
			if (this.kinds[i] === 1) continue;
			if (i === dragIdx) continue; // 拖动中的球由 handleMove 直接写坐标
			const rec = this.recs[i];
			const t = clockOf(i);
			let p = Layout.pose(rec, { clock: t, base: t * BASE_SPIN, sizeK, wall: this.wall, handAngles: this.handAngles }, { rho: this.rho[i], theta0: this.theta0[i], ellipse: this.ellipseByOrbit ? this.ellipseByOrbit[this.orbitNow[i]] : null });

			const pj = this.pdfLink[i];
			if (pj >= 0 && !rec.root && !rec.comet) {
				const biased = Layout.attraction({
					rho: p.rho,
					ang: p.ang,
					cx: 0,
					cy: 0,
					px: this.pdfXs[pj],
					py: this.pdfYs[pj],
					maxR: this.layoutMaxR,
				});
				p = {
					x: Math.cos(biased.ang) * biased.rho,
					y: Math.sin(biased.ang) * biased.rho,
					ang: biased.ang,
					rho: biased.rho,
					radius: p.radius,
				};
			}

			this.xs[i] = p.x;
			this.ys[i] = p.y;
			this.rads[i] = p.radius;
		}

		this.avoidMinuteHand();
		this.updateSatellites();
		const grid = this.spatialGrid();
		this.checkCrowding(grid); // 实时：与斥力开关无关
		this.applyRepulsion(grid);
		this.checkCometHits();
	},

	/**
	 * PDF 彗星撞击：命中的笔记球在内存里降一个轨道（不写 pins，重建时按抖动重新定轨）。
	 * 同一颗球 3 秒内不重复触发；中心球与 MD 彗星免疫。
	 */
	checkCometHits() {
		let hits = 0;

		// ① PDF 彗星：命中降一轨（目标满则不降、不耗冷却）
		const pdfs = this.cometPdfs || [];
		for (let c = 0; c < pdfs.length; c++) {
			const ci = pdfs[c];
			const reach = this.rads[ci];
			for (let i = 0; i < this.n; i++) {
				if (i === ci || this.kinds[i] !== 0 || this.cometMask[i]) continue;
				const d = Math.hypot(this.xs[i] - this.xs[ci], this.ys[i] - this.ys[ci]);
				if (d > (reach + this.rads[i]) * 1.15) continue;
				if (this.hitAt[i] > 0 && this.clock - this.hitAt[i] < HIT_COOLDOWN) continue;

				const target = this.orbitNow[i] - 1;
				if (target < 0) continue;
				if (!this.orbitHasRoom(target, i)) continue;

				this.hitAt[i] = this.clock;
				const path = this.graph.nodes[i].path;
				this.bump[path] = (this.bump[path] || 0) - 1;
				this.orbitNow[i] = target;
				hits++;
			}
		}

		// ② 内环 MD 彗星：命中升到「上方第一个有空位的轨道」（上方全满则不升）
		const mds = this.cometMds || [];
		for (let c = 0; c < mds.length; c++) {
			const ci = mds[c];
			const reach = this.rads[ci];
			for (let i = 0; i < this.n; i++) {
				if (i === ci || this.kinds[i] !== 0 || this.cometMask[i]) continue;
				const d = Math.hypot(this.xs[i] - this.xs[ci], this.ys[i] - this.ys[ci]);
				if (d > (reach + this.rads[i]) * 1.15) continue;
				if (this.hitAt[i] > 0 && this.clock - this.hitAt[i] < HIT_COOLDOWN) continue;

				const from = this.orbitNow[i];
				let target = -1;
				for (let o = from + 1; this.orbitExists(o); o++) {
					if (this.orbitHasRoom(o, i)) {
						target = o;
						break;
					}
				}
				if (target < 0) continue; // 上方全满

				this.hitAt[i] = this.clock;
				const path = this.graph.nodes[i].path;
				this.bump[path] = (this.bump[path] || 0) + (target - from);
				this.orbitNow[i] = target;
				hits++;
			}
		}

		if (hits > 0) this.applyLayout(false);
	},

	/** 星带避让：PDF 球与分针球角度太近时，沿径向让开（偶索引向外、奇索引向内） */
	avoidMinuteHand() {
		const m = this.clockMinuteIdx;
		if (m === undefined || m < 0 || !this.recs) return;
		const mAng = Math.atan2(this.ys[m], this.xs[m]);

		for (let i = 0; i < this.n; i++) {
			if (i === m) continue;
			const rec = this.recs[i];
			if (rec.clockHand || rec.comet) continue;
			if (this.kinds[i] !== 1) continue; // 只看 PDF 球
			const ang = Math.atan2(this.ys[i], this.xs[i]);
			const d = Math.abs(Core.angleDelta(mAng, ang));
			if (d >= AVOID_ANGLE) continue;
			const k = 1 - d / AVOID_ANGLE;
			const scale = 1 + (i % 2 === 0 ? 1 : -1) * k * AVOID_SHIFT;
			this.xs[i] *= scale;
			this.ys[i] *= scale;
		}
	},

	updateSatellites() {
	const list = this.graph && this.graph.satellites;
	if (!list || !list.length) {
	this.satModel = null;
	return;
	}
	const out = [];
	for (let k = 0; k < list.length; k++) {
	const sat = list[k];
	const h = sat.host;
	if (h < 0 || h >= this.n) continue;
	if (this.cometMask[h]) continue; // 彗星不生成
	if (this.rads[h] <= 0) continue;
	const hostR = this.rads[h];
	const satR = hostR * SAT_SIZE_RATIO;
	const gap = hostR + 3 + Math.max(2.2, satR * 1.8);
	const spin = (this.recs[h] && this.recs[h].spinFactor) || 1;
	const dir = this.dirs && this.dirs[h] < 0 ? -1 : 1;
	// 同一宿主的卫星等角分布在一圈上，整圈刚体旋转
	const n = Math.max(1, sat.count || 1);
	const ang = (sat.phase0 || 0) + (Core.TAU * sat.index) / n + dir * spin * SAT_TURNS * BASE_SPIN * this.clock;
	out.push({
		host: h,
		tag: sat.tag,
		r: satR,
		x: this.xs[h] + Math.cos(ang) * gap,
		y: this.ys[h] + Math.sin(ang) * gap,
		color: this.colors && this.colors[h] ? this.colors[h] : null,
	});
	}
	this.satModel = out;
},

	primeGrowth() {
	if (!this.recs) return;
	const now = this.now();
	const weekAgo = now - 7 * 86400000;
	for (let i = 0; i < this.n; i++) {
	if (this.kinds[i] !== 0 || this.recs[i].root) continue;
	const t = this.graph.nodes[i].ctime || 0;
	if (t > weekAgo) this.rho[i] = 0;
	}
},

	handleKeydown(e) {
	if (e.key === 'Tab') {
	e.preventDefault();
	this.cycleFocus(e.shiftKey ? -1 : 1);
	return;
	}
	if (e.key === 'Escape') {
	this.focusIdx = -1;
	return;
	}
	if (e.key === 'Enter' && this.focusIdx >= 0) {
	e.preventDefault();
	const node = this.graph.nodes[this.focusIdx];
	if (node && this.app.workspace && this.app.workspace.openLinkText) {
		this.app.workspace.openLinkText(node.path, '', false);
	}
	}
},

	hoverOrbitOutline() {
	const hv = this.hovered;
	if (hv === undefined || hv < 0 || !this.recs) return null;
	const rec = this.recs[hv];
	if (rec.comet) return null;
	if (rec.clockHand) return { circle: true, r: rec.rho || 0 };
	if (this.kinds[hv] === 1) return { circle: true, r: rec.rho || 0 };
	const el = this.ellipseByOrbit ? this.ellipseByOrbit[this.orbitNow[hv]] : null;
	if (!el) return null;
	const a = el.a || (el.A + el.P) / 2;
	const b = a * Math.sqrt(Math.max(0, 1 - el.e * el.e));
	return { circle: false, a, b, e: el.e, w: el.w || 0 };
},

	cycleFocus(dir) {
	const order = [];
	for (let i = 0; i < this.n; i++) {
	if (this.kinds[i] === 2 || this.cometMask[i]) continue;
	order.push(i);
	}
	if (!order.length) return;
	order.sort((x, y) => this.orbitNow[x] - this.orbitNow[y] || Math.atan2(this.ys[x], this.xs[x]) - Math.atan2(this.ys[y], this.xs[y]));
	let pos = order.indexOf(this.focusIdx);
	pos = pos < 0 ? (dir > 0 ? 0 : order.length - 1) : (pos + dir + order.length) % order.length;
	this.focusIdx = order[pos];
},

	/** 恢复上次的画幅（缩放/平移）：画布尺寸变化过大或数值非法时放弃 */
	restoreView() {
		const saved = this.plugin.settings && this.plugin.settings.orbitView;
		if (!saved) return;
		const scale = Number(saved.scale);
		const ox = Number(saved.ox);
		const oy = Number(saved.oy);
		if (!isFinite(scale) || scale < 0.02 || scale > 10 || !isFinite(ox) || !isFinite(oy)) return;
		const w = this.renderer ? this.renderer.w : 0;
		const h = this.renderer ? this.renderer.h : 0;
		if (saved.w > 0 && w > 0) {
			const dw = Math.abs(w - saved.w) / saved.w;
			const dh = Math.abs(h - saved.h) / (saved.h || saved.w);
			if (dw > 0.4 || dh > 0.4) return; // 窗口变化太大 → 重新取景
		}
		this.scale = scale;
		this.ox = ox;
		this.oy = oy;
		this.hasFit = true;
	},

	/** 记住当前画幅（防抖写入 settings） */
	saveView() {
		if (!this.renderer) return;
		const s = this.plugin.settings;
		s.orbitView = {
			scale: this.scale,
			ox: this.ox,
			oy: this.oy,
			w: this.renderer.w,
			h: this.renderer.h,
		};
		if (!this.saveViewTimer) {
			this.saveViewTimer = setTimeout(() => {
				this.saveViewTimer = null;
				this.plugin.scheduleSave();
			}, 400);
		}
	},

	/** 再次点击激活键：软重载（重建图、重新取景、清掉筛选与焦点） */
	reactivate() {
		this.bump = {};
		this.fillAt = {};
		this.hitAt = {};
		this.lastPromoteAt = 0;
		this.focusIdx = -1;
		this.hovered = -1;
		this.pinsArmed = false;
		this.hasFit = false;
		this.fitWait = 0;
		this.editingLine = -1;
		this.pendingAdd = null;
		this.dayOpen = null;
		this.restoreView();
		this.plugin.settings.orbitView = null;
		this.plugin.scheduleSave();
		this.rebuild();
		this.fit();
		this.hasFit = true;
		new Notice(Core.STR.reactivated);
	},

	/** 呼吸颜色：当前色系的中间色标 */
	breathColor() {
		const scheme = Palette.byId(this.plugin.settings.scheme);
		const stops = (scheme && scheme.stops) || [];
		if (!stops.length) return this.accent || '#888888';
		return stops[Math.floor((stops.length - 1) / 2)];
	},

	/** 悬停球的每条连线：1 = 出链（我 → 对方），0 = 入链 */
	linkOutMask(i) {
		const out = new Uint8Array(this.n);
		const resolved = (this.app.metadataCache && this.app.metadataCache.resolvedLinks) || {};
		const mine = resolved[this.graph.nodes[i].path] || null;
		const adj = this.adj[i] || [];
		for (let k = 0; k < adj.length; k++) {
			const j = adj[k];
			const target = this.graph.nodes[j].path;
			out[j] = mine && mine[target] ? 1 : 0;
		}
		return out;
	},
	/** 每颗球的标签集合（来自 graph.satellites），搜索用 */
	buildTagsByNode() {
		const list = (this.graph && this.graph.satellites) || [];
		const sets = new Array(this.n);
		for (let k = 0; k < list.length; k++) {
			const s = list[k];
			if (s.host < 0 || s.host >= this.n) continue;
			if (!sets[s.host]) sets[s.host] = new Set();
			sets[s.host].add(String(s.tag).toLowerCase());
		}
		return sets;
	},

	/** 打开/关闭搜索框 */
	toggleSearch() {
		if (this.searchActive) {
			this.exitSearch();
			return;
		}
		this.searchActive = true;
		this.searchQuery = '';
		if (!this.searchInputEl) {
			const input = this.graphEl.createEl('input', { cls: 'orbit-plan-search-input' });
			input.setAttribute('type', 'text');
			input.setAttribute('placeholder', Core.STR.searchHint);
			input.addEventListener('input', () => {
				this.searchQuery = String(input.value || '').trim();
				this.refreshSearchHint();
			});
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === 'Escape') {
					e.preventDefault();
					this.exitSearch();
				}
			});
			this.searchInputEl = input;
		}
		this.searchInputEl.addClass('is-open');
		this.refreshSearchHint();
		if (this.searchInputEl.focus) this.searchInputEl.focus();
	},

	exitSearch() {
		this.searchActive = false;
		this.searchQuery = '';
		if (this.searchInputEl) {
			this.searchInputEl.value = '';
			this.searchInputEl.removeClass('is-open');
		}
		if (this.searchHintEl) this.searchHintEl.removeClass('is-open');
	},

	/** 无命中时在输入框下方给提示 */
	refreshSearchHint() {
		if (!this.searchActive) return;
		if (!this.searchHintEl) {
			this.searchHintEl = this.graphEl.createDiv({ cls: 'orbit-plan-search-hint' });
			this.searchHintEl.setText(Core.STR.searchEmpty);
		}
		const q = String(this.searchQuery || '').trim();
		if (!q) {
			this.searchHintEl.removeClass('is-open');
			return;
		}
		const hits = this.searchHits();
		let count = 0;
		for (let i = 0; i < hits.length; i++) count += hits[i];
		if (count === 0) this.searchHintEl.addClass('is-open');
		else this.searchHintEl.removeClass('is-open');
	},
	/** 搜索命中集合：文件名 / 标题 / 标签 包含关键字 */
	searchHits() {
		const q = String(this.searchQuery || '').trim().toLowerCase();
		const out = new Uint8Array(this.n);
		if (!q || !this.graph) return out;
		const tags = this.tagsByNode || this.buildTagsByNode();
		for (let i = 0; i < this.n; i++) {
			const node = this.graph.nodes[i];
			if (!node) continue;
			const name = String(node.name || '').toLowerCase();
			const label = String(node.label || '').toLowerCase();
			let hit = name.indexOf(q) >= 0 || label.indexOf(q) >= 0;
			if (!hit && tags[i]) {
				for (const tag of tags[i]) {
					if (tag.indexOf(q) >= 0) {
						hit = true;
						break;
					}
				}
			}
			out[i] = hit ? 1 : 0;
		}
		return out;
	},
	/** 统一时间源：测试可替换 nowFn 以获得确定性 */
	now() {
		return (this.nowFn || Date.now)();
	},

	/** 今天在周内的序号（周一=0）；测试可替换 todayIndexFn */
	todayIndex() {
		return (this.todayIndexFn || Plan.todayIndex)();
	},

	/** 空间网格（48 单位一格），斥力与贴近升轨共用 */
	spatialGrid() {
		const cell = 48;
		const buckets = new Map();
		for (let i = 0; i < this.n; i++) {
			const key = Math.floor(this.xs[i] / cell) + ',' + Math.floor(this.ys[i] / cell);
			let arr = buckets.get(key);
			if (!arr) buckets.set(key, (arr = []));
			arr.push(i);
		}
		buckets.cell = cell;
		return buckets;
	},

	/** 遍历网格里的近邻对，回调 (i, j, d, minD) */
	eachNeighborPair(buckets, fn) {
		const cell = buckets.cell || 48;
		for (let i = 0; i < this.n; i++) {
			const gx = Math.floor(this.xs[i] / cell);
			const gy = Math.floor(this.ys[i] / cell);
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const arr = buckets.get(gx + dx + ',' + (gy + dy));
					if (!arr) continue;
					for (let k = 0; k < arr.length; k++) {
						const j = arr[k];
						if (j <= i) continue;
						const ddx = this.xs[j] - this.xs[i];
						const ddy = this.ys[j] - this.ys[i];
						const d = Math.hypot(ddx, ddy);
						const minD = (this.rads[i] + this.rads[j]) * 1.7;
						if (fn(i, j, d, minD, ddx, ddy) === false) return;
					}
				}
			}
		}
	},

	/** 实时判定：同一条（实际）轨道上贴近到 2R 以内 → 抬前方那颗 */
	checkCrowding(buckets) {
		if (!buckets || this.n < 2 || !this.orbitNow) return;
		const crowded = [];
		this.eachNeighborPair(buckets, (i, j, d) => {
			if (this.kinds[i] !== 0 || this.kinds[j] !== 0) return;
			if (this.cometMask[i] || this.cometMask[j]) return;
			if (this.orbitNow[i] !== this.orbitNow[j]) return;
			if (d > (this.rads[i] + this.rads[j]) * PROMOTE_FACTOR) return;
			crowded.push([i, j]);
		});
		this.promoteCrowded(crowded);
	},

	/**
	 * 节点间斥力：空间网格找邻近的一对，沿连线方向各推一半。
	 * 单帧位移封顶，避免整体炸开；中心球是锚点，只被推别人、自己不动。
	 */
	applyRepulsion(buckets) {
		const strength = Core.clamp(Number(this.plugin.settings.repel) || 0, 0, 1);
		if (strength <= 0.001 || this.n < 2) return;
		if (!buckets) buckets = this.spatialGrid();

		const maxPush = Math.max(0.5, this.layoutMaxR * 0.015);
		this.eachNeighborPair(buckets, (i, j, d, minD, ddx, ddy) => {
			if (d >= minD) return;

			let ux;
			let uy;
			if (d < 1e-6) {
				const a = Core.unitHash(i * 71 + j * 13) * Core.TAU;
				ux = Math.cos(a);
				uy = Math.sin(a);
			} else {
				ux = ddx / d;
				uy = ddy / d;
			}

			const push = Math.min(maxPush, (minD - (d < 1e-6 ? 0 : d)) / 2 * strength * 0.6);

			const iRoot = this.kinds[i] === 2;
			const jRoot = this.kinds[j] === 2;
			// 中心球、悬停冻结的球、正在被拖的球都不被推走
			const iHold = iRoot || i === this.hovered || (this.nodeDrag && this.nodeDrag.i === i);
			const jHold = jRoot || j === this.hovered || (this.nodeDrag && this.nodeDrag.i === j);
			if (!iHold) {
				this.xs[i] -= ux;
				this.ys[i] -= uy;
			}
			if (!jHold) {
				this.xs[j] += ux;
				this.ys[j] += uy;
			}
		});
	},

	/**
	 * 空轨补位：某条轨道上一颗球都没有时，从外侧最近的非空轨道搬一颗进来。
	 * 保护：最外轨不抽球、不搬彗星、donor 至少留 1 颗、每球 2 秒冷却、每帧最多补 1 次。
	 */
	fillEmptyOrbits() {
		if (!this.recs || !this.orbitNow || this.n < 2 || !this.rhoByOrbit) return;
		if (!this.fillAt) this.fillAt = {};

		let maxO = -1;
		for (const o of this.rhoByOrbit.keys()) if (o > maxO) maxO = o;
		if (maxO < 1) return;

		const counts = new Map();
		for (let i = 0; i < this.n; i++) {
			if (this.recs[i].root) continue;
			const o = this.orbitNow[i];
			counts.set(o, (counts.get(o) || 0) + 1);
		}

		for (let o = 0; o < maxO; o++) {
			if ((counts.get(o) || 0) > 0) continue;

			let donor = -1;
			for (let k = o + 1; k <= maxO; k++) {
				if ((counts.get(k) || 0) >= 2) {
					donor = k;
					break;
				}
			}
			if (donor < 0) return;

			// 挑 donor 里最早创建、非彗星、冷却已过的一颗
			let pick = -1;
			for (let i = 0; i < this.n; i++) {
				const rec = this.recs[i];
				if (rec.root || rec.comet) continue;
				if (this.orbitNow[i] !== donor) continue;
				const path = this.graph.nodes[i].path;
				if (this.fillAt[path] > 0 && this.clock - this.fillAt[path] < FILL_COOLDOWN) continue;
				if (pick < 0 || this.graph.nodes[i].ctime < this.graph.nodes[pick].ctime) pick = i;
			}
			if (pick < 0) return;

			const path = this.graph.nodes[pick].path;
			this.fillAt[path] = this.clock;
			this.bump[path] = (this.bump[path] || 0) + (o - donor);
			this.orbitNow[pick] = o;
			this.applyLayout(false);
			return; // 每帧最多补一次
		}
	},

	/**
	 * 同轨太挤：把「前方」那颗抬到外一圈（瞬时偏移，无冷却）。
	 * 目标轨满就继续往外找（上上轨道），全都满则不升。
	 */
	promoteCrowded(pairs) {
		if (!pairs || !pairs.length) return;
		// 0.2 秒节流：避免每帧连续抬升导致快速外扩
		if (this.lastPromoteAt > 0 && this.clock - this.lastPromoteAt < PROMOTE_THROTTLE) return;
		this.lastPromoteAt = this.clock;
		const done = new Set();
		let changed = false;
		for (let k = 0; k < pairs.length; k++) {
			const a = pairs[k][0];
			const b = pairs[k][1];
			const victim = this.leaderOf(a, b);
			if (done.has(victim)) continue; // 同一帧只抬一轨，避免瞬间飞出好几圈
			done.add(victim);

			const from = this.orbitNow[victim];
			let target = -1;
			for (let o = from + 1; o < from + 64; o++) {
				if (!this.orbitExists(o)) break;
				if (this.orbitHasRoom(o, victim)) {
					target = o;
					break;
				}
			}
			if (target < 0) continue; // 上方全满，不升

			const path = this.graph.nodes[victim].path;
			this.bump[path] = (this.bump[path] || 0) + (target - from);
			this.orbitNow[victim] = target;
			changed = true;
		}
		if (changed) this.applyLayout(false);
	},

	/** 同轨两颗里谁在「前方」：按旋转方向（dir）判断，完全重合时退回半径大者 */
	leaderOf(a, b) {
		const angA = Math.atan2(this.ys[a], this.xs[a]);
		const angB = Math.atan2(this.ys[b], this.xs[b]);
		const dir = this.dirs && this.dirs[a] < 0 ? -1 : 1;
		const ahead = Core.angleDelta(angB, angA); // A 相对 B 的角度差
		if (Math.abs(ahead) > 1e-4) {
			// dir=+1：角度更大者在前；dir=−1：角度更小者在前
			const aAhead = dir > 0 ? ahead > 0 : ahead < 0;
			return aAhead ? a : b;
		}
		return this.rads[a] >= this.rads[b] ? a : b;
	},

	/** 该轨道是否可用（有半径，即布局里真实存在的那几条） */
	orbitExists(o) {
		return !!(this.rhoByOrbit && this.rhoByOrbit.has(o));
	},

	/** 目标轨道还有空位吗（不计自己） */
	orbitHasRoom(o, selfIdx) {
		let used = 0;
		for (let i = 0; i < this.n; i++) {
			if (i === selfIdx) continue;
			const rec = this.recs[i];
			if (rec.root || rec.comet) continue;
			if (this.orbitNow[i] === o) used++;
		}
		return used < Layout.orbitCapacity(o + 1);
	},

	/** 从 from 开始找最近的有空位轨道（先向外、再向内） */
	nearestFreeOrbit(from, selfIdx) {
		for (let d = 0; d < 64; d++) {
			if (d === 0) {
				if (this.orbitHasRoom(from, selfIdx)) return from;
				continue;
			}
			const out = from + d;
			if (this.orbitExists(out) && this.orbitHasRoom(out, selfIdx)) return out;
			const inn = from - d;
			if (inn >= 0 && this.orbitExists(inn) && this.orbitHasRoom(inn, selfIdx)) return inn;
		}
		return -1;
	},

	recolor() {
		if (!this.graph) return;
		this.colors = Palette.resolve(this.graph.nodes, this.rhoTarget, this.plugin.settings);
		this.centerColor = this.graph.center >= 0 ? this.colors[this.graph.center] : null;
		this.needRecolor = false;
		this.applyAccent();
	},

	/** 把色系映射成一组 CSS 变量（c1 最浅 … c4 最深），供图标/象限/进度条等使用 */
	applyTheme() {
		if (!this.contentEl) return;
		const scheme = Palette.byId(this.plugin.settings.scheme);
		const stops = (scheme.stops || ['#888888']).slice();
		const lum = (hex) => {
			const c = Core.hexToRgb(hex);
			return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
		};
		const sorted = stops.slice().sort((a, b) => lum(b) - lum(a)); // 浅 → 深
		const pick = (i) => sorted[Math.min(i, sorted.length - 1)];
		const c1 = pick(0);
		const c2 = sorted.length > 1 ? pick(1) : Core.mixHex(c1, '#000000', 0.15);
		const c3 = sorted.length > 2 ? pick(2) : Core.mixHex(c2, '#000000', 0.2);
		const c4 = sorted.length > 3 ? pick(3) : Core.mixHex(c3, '#000000', 0.22);

		const el = this.contentEl;
		el.style.setProperty('--orbit-c1', c1);
		el.style.setProperty('--orbit-c2', c2);
		el.style.setProperty('--orbit-c3', c3);
		el.style.setProperty('--orbit-c4', c4);
		el.style.setProperty('--orbit-accent', c1);
		el.style.setProperty('--orbit-ink', c4);
		// 四象限：重要·紧急 c2 / 不重要·紧急 c3 / 重要·不紧急 c4 / 不重要·不紧急 c1（最浅）
		el.style.setProperty('--orbit-q1', c2);
		el.style.setProperty('--orbit-q2', c3);
		el.style.setProperty('--orbit-q3', c4);
		el.style.setProperty('--orbit-q4', c1);

		this.themeColors = { c1, c2, c3, c4 };
		this.accent = c1;
	},

	/** 旧名保留：现在等同于 applyTheme */
	applyAccent() {
		this.applyTheme();
	},

	paint() {
		if (!this.renderer) return;
		if (!this.graph || !this.n) {
			this.renderer.drawMessage(Core.STR.emptyTitle, Core.STR.noLinkHint);
			return;
		}
		if (this.needRecolor) this.recolor();

		const mo = this.model;
		mo.n = this.n;
		mo.xs = this.xs;
		mo.ys = this.ys;
		mo.rads = this.rads;
		mo.kinds = this.kinds;
		mo.colors = this.colors;
		mo.labels = this.labels;
		mo.scale = this.scale;
		mo.ox = this.ox;
		mo.oy = this.oy;
		mo.paused = this.paused;
		mo.trail = this.plugin.settings.trail;
		mo.hover = this.hovered;
		mo.hoverLinks = this.hovered >= 0 && this.adj ? this.adj[this.hovered] : null;
		mo.cometMask = this.cometMask;
		mo.dirs = this.dirs;
		mo.wall = this.wall;
		mo.center = this.graph.center;
		const clockText = new Array(this.n);
		const timerOn = this.timerActive === true;
		const elapsed = this.timerElapsed || 0;
		const pad2 = (v) => (v < 10 ? '0' : '') + v;
		for (let i = 0; i < this.n; i++) {
			const hand = this.recs[i].clockHand;
			if (!hand) {
				clockText[i] = null;
				continue;
			}
			if (timerOn) {
				// 计时模式：球内数字 = 已用时间；倒计时 = 剩余时间
				const sec = this.timerMode === 'down' ? this.timerRemain || 0 : elapsed / 1000;
				if (hand === 'h') clockText[i] = pad2(Math.floor(sec / 3600));
				else if (hand === 'm') clockText[i] = pad2(Math.floor(sec / 60) % 60);
				else clockText[i] = pad2(Math.floor(sec) % 60);
				continue;
			}
			const d = new Date(mo.wall);
			if (hand === 'h') clockText[i] = pad2(d.getHours());
			else if (hand === 'm') clockText[i] = pad2(d.getMinutes());
			else clockText[i] = pad2(d.getSeconds());
		}
		mo.clockText = clockText;
		mo.satellites = this.satModel;
		mo.satAlpha = this.satAlpha;
		mo.breathing = this.breathing === true;
		// 搜索：命中球显示名称并保持亮度，其余变暗
		// F2：连线的暖/冷色与"是不是出链"
		if (this.themeColors) {
			mo.linkWarm = this.themeColors.c3;
			mo.linkCool = this.themeColors.c1;
		}
		if (this.hovered >= 0) mo.linkOut = this.linkOutMask(this.hovered);
		mo.searchActive = this.searchActive === true && String(this.searchQuery || '').length > 0;
		mo.searchHits = mo.searchActive ? this.searchHits() : null;
		mo.clockDown = this.timerActive === true && this.timerMode === 'down';
		if (!this.clockHandMask) {
			this.clockHandMask = new Uint8Array(this.n);
			for (let i = 0; i < this.n; i++) this.clockHandMask[i] = this.recs && this.recs[i] && this.recs[i].clockHand ? 1 : 0;
		}
		mo.clockHands = this.clockHandMask;
		mo.breathT = this.clock;
		mo.accentColor = this.breathing ? this.breathColor() : this.accent || null;

		// M1：悬停球的轨道轮廓
		mo.hoverOrbit = this.hoverOrbitOutline();

		// M4：标签筛选 → 每颗球是否变暗

		// M8：键盘焦点
		mo.focus = this.focusIdx;
		mo.clock = this.clock;
		mo.centerColor = this.centerColor || null;
		mo.cometTrails = this.buildCometTrails();
		this.renderer.draw(mo);
	},

	/** 彗星尾迹：按「轨迹长度」的时间窗口往回采样 */
	buildCometTrails() {
		const out = [];
		const trail = Core.clamp(this.plugin.settings.trail || 0, 0, 1);
		if (trail <= 0.01) return out;

		const sizeK = this.plugin.settings.nodeScale;
		const samples = 10;
		const windowSec = COMET_TRAIL_SEC * trail;
		for (let i = 0; i < this.n; i++) {
			if (!this.cometMask[i]) continue;
			const rec = this.recs[i];
			if (!rec) continue;
			const now = i === this.hovered ? this.holdClock[i] : this.clock;
			const pts = [];
			for (let k = 0; k < samples; k++) {
				const t = now - (k / (samples - 1)) * windowSec;
				const p = Layout.pose(rec, { clock: t, base: t * BASE_SPIN, sizeK, wall: this.wall, handAngles: this.handAngles });
				pts.push([p.x, p.y]);
			}
			out.push({ i, pts });
		}
		return out;
	},

	handleWheel(e) {
		e.preventDefault();
		if (!this.renderer || !this.canvasEl) return;
		const rect = this.canvasEl.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;

		const oldScale = this.scale;
		const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
		const newScale = Core.clamp(oldScale * factor, 0.02, 10);
		if (newScale === oldScale) return;

		const anchor = this.renderer.screenToWorld(cx, cy, { scale: oldScale, ox: this.ox, oy: this.oy });
		this.scale = newScale;
		this.ox = anchor.x - (cx - this.renderer.w / 2) / newScale;
		this.oy = anchor.y - (cy - this.renderer.h / 2) / newScale;
		this.saveView();
	},

	handleDown(e) {
		if (e.button !== 0) return;

		// 搜索态下点画布空白 → 退出搜索
		if (this.searchActive) {
			const satHit = null;
			const hitTarget = this.hitTest(e.clientX, e.clientY);
			if (hitTarget < 0) {
				this.exitSearch();
				return;
			}
		}

		// 命中普通球 → 拖动这个球；否则平移画布（卫星不可交互）
		const hit = this.hitTest(e.clientX, e.clientY);
		if (hit >= 0 && this.kinds[hit] !== 2 && !this.cometMask[hit]) {
			const rect = this.canvasEl.getBoundingClientRect();
			this.nodeDrag = { i: hit, x: e.clientX, y: e.clientY };
			this.dragWorld = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, {
				scale: this.scale,
				ox: this.ox,
				oy: this.oy,
			});
			this.moved = false;
			return;
		}

		this.dragging = true;
		this.moved = false;
		this.dragX = e.clientX;
		this.dragY = e.clientY;
		this.dragOx = this.ox;
		this.dragOy = this.oy;
	},

	handleMove(e) {
		if (this.nodeDrag && this.renderer) {
			const rect = this.canvasEl.getBoundingClientRect();
			const w = this.renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, {
				scale: this.scale,
				ox: this.ox,
				oy: this.oy,
			});
			this.dragWorld = w;
			this.xs[this.nodeDrag.i] = w.x;
			this.ys[this.nodeDrag.i] = w.y;
			this.moved = true;
			return;
		}
		if (!this.dragging) return;
		const dx = e.clientX - this.dragX;
		const dy = e.clientY - this.dragY;
		if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
		if (!this.moved) return;
		this.ox = this.dragOx - dx / this.scale;
		this.oy = this.dragOy - dy / this.scale;
	},

	handleUp() {
		if (this.dragging) this.saveView();
		this.dragging = false;
		if (this.nodeDrag) this.finishNodeDrag();
	},

	/** 松手：吸附到最近的轨道，并把该轨道序号记进 pins */
	finishNodeDrag() {
		const drag = this.nodeDrag;
		const world = this.dragWorld;
		this.nodeDrag = null;
		this.dragWorld = null;
		if (!drag || !world || !this.moved) return;
		const want = this.nearestOrbitAt(world.x, world.y);
		if (want === null) return;
		// 目标轨满员时自动跳到最近的有空位轨道（先向外、再向内）
		const s = this.nearestFreeOrbit(want, drag.i);
		if (s < 0) return;

		if (!this.plugin.settings.pins) this.plugin.settings.pins = {};
		this.plugin.settings.pins[this.graph.nodes[drag.i].path] = s;
		this.plugin.scheduleSave();
		this.applyLayout(false);
	},

	/**
	 * 按落点坐标找最近的轨道：用该角度上轨道的**椭圆半径**比较，
	 * 这样"拖到哪条圈上就吸到哪条"，不受近点/远点跨度影响。
	 */
	nearestOrbitAt(x, y) {
		if (!this.recs) return null;
		const theta = Math.atan2(y, x);
		const rho = Math.hypot(x, y);
		let best = null;
		let bestD = Infinity;
		const seen = new Set();
		for (let i = 0; i < this.n; i++) {
			const rec = this.recs[i];
			if (rec.comet || rec.root || rec.orbit < 0) continue;
			if (seen.has(rec.orbit)) continue;
			seen.add(rec.orbit);
			const el = this.ellipseByOrbit ? this.ellipseByOrbit[rec.orbit] : null;
			let rOrbit = rec.rho;
			if (el) {
				const den = 1 + el.e * Math.cos(theta - (el.w || 0));
				if (den > 1e-3) rOrbit = (el.P * (1 + el.e)) / den;
			}
			const d = Math.abs(rOrbit - rho);
			if (d < bestD) {
				bestD = d;
				best = rec.orbit;
			}
		}
		return best;
	},

	/** 找与目标半径最接近的轨道序号（跳过彗星与中心） */
	nearestOrbit(rho) {
		if (!this.recs) return null;
		let best = null;
		let bestD = Infinity;
		const seen = new Set();
		for (let i = 0; i < this.n; i++) {
			const rec = this.recs[i];
			if (rec.comet || rec.root || rec.orbit < 0 || seen.has(rec.orbit)) continue;
			seen.add(rec.orbit);
			const d = Math.abs(rec.rho - rho);
			if (d < bestD) {
				bestD = d;
				best = rec.orbit;
			}
		}
		return best;
	},

	handleClick(e) {
		if (this.moved) {
			this.moved = false;
			return;
		}
		const hit = this.hitTest(e.clientX, e.clientY);
		if (hit >= 0) this.openFile(hit);
	},

	handleContext(e) {
		e.preventDefault();
		const hit = this.hitTest(e.clientX, e.clientY);
		if (hit < 0) return;

		const key = this.graph.nodes[hit].path;
		const custom = this.plugin.settings.colors[key];
		const current = custom || (this.colors && this.colors[hit]) || '#F7B267';

		new ColorModal(this.app, current, (picked) => {
			const colors = this.plugin.settings.colors;
			if (picked) {
				colors[key] = picked;
				new Notice(Core.STR.noticeColorSet);
			} else {
				delete colors[key];
				new Notice(Core.STR.noticeColorCleared);
			}
			this.needRecolor = true;
			void this.plugin.saveSettings();
		}).open();
	},

	handleHover(e) {
		if (this.dragging) return;
		this.setHovered(this.hitTest(e.clientX, e.clientY));
	},

	handleKey(e) {
		if (e.code !== 'Space' && e.key !== ' ') return;
		// 只有该视图是当前激活视图时才接管空格
		const active = this.app.workspace.getActiveViewOfType(Views.OrbitView);
		if (active !== this) return;
		const t = e.target;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		e.preventDefault();
		this.paused = !this.paused;
	},

	hitTest(clientX, clientY) {
		if (!this.renderer || !this.canvasEl || !this.n) return -1;

		const rect = this.canvasEl.getBoundingClientRect();
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		const s = this.scale;
		const cx = this.renderer.w / 2;
		const cy = this.renderer.h / 2;

		let best = -1;
		let bestD = Infinity;
		for (let i = 0; i < this.n; i++) {
			const px = (this.xs[i] - this.ox) * s + cx;
			const py = (this.ys[i] - this.oy) * s + cy;
			const hitR = Math.max(this.rads[i] * s, 10);
			const d = Math.hypot(sx - px, sy - py);
			if (d <= hitR && d < bestD) {
				best = i;
				bestD = d;
			}
		}
		return best;
	},

	async openFile(i) {
		const node = this.graph.nodes[i];
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!file) return;

		// 按目标类型复用同类叶子：打开 PDF 时不要顶掉正在看的笔记
		const wantedType = node.kind === GraphBuilder.KIND_PDF ? 'pdf' : 'markdown';
		const sameType = this.app.workspace.getLeavesOfType(wantedType);
		const leaf = sameType.length > 0 ? sameType[0] : this.app.workspace.getLeaf('tab');
		if (!leaf) return;
		await leaf.openFile(file);
		this.app.workspace.revealLeaf(leaf);
	},

	onSettingsChanged(kind) {
		if (kind === 'solve') this.applyLayout(false);
		if (kind === 'solve' || kind === 'color') this.needRecolor = true;
		if (kind === 'split') this.applySplit(this.plugin.settings.splitRatio);
		if (kind === 'plan') {
			this.applySplit(this.plugin.settings.splitRatio);
			void this.loadWeek();
		}
	},

	handleRename(file, oldPath) {
		const colors = this.plugin.settings.colors;
		if (oldPath && colors && Object.prototype.hasOwnProperty.call(colors, oldPath)) {
			colors[file.path] = colors[oldPath];
			delete colors[oldPath];
			void this.plugin.saveSettings();
			this.needRecolor = true;
		}
		this.scheduleRebuild();
	}
};

// ---- src/view-plan.js ----
class WeekJumpModal extends Modal {
	constructor(app, year, week, onPick) {
		super(app);
		this.year = year;
		this.week = week;
		this.onPick = onPick;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.classList.add('graph-orbit-modal');

		contentEl.createEl('h3', { text: Core.STR.planJumpTitle });

		const row = contentEl.createDiv({ cls: 'orbit-plan-jump-row' });
		row.createSpan({ cls: 'orbit-plan-jump-label', text: Core.STR.planYear });
		const yearInput = row.createEl('input', { cls: 'orbit-plan-jump-input' });
		yearInput.setAttribute('type', 'number');
		yearInput.value = String(this.year);

		row.createSpan({ cls: 'orbit-plan-jump-label', text: Core.STR.planWeek });
		const weekInput = row.createEl('input', { cls: 'orbit-plan-jump-input' });
		weekInput.setAttribute('type', 'number');
		weekInput.value = String(this.week);

		const actions = contentEl.createDiv({ cls: 'graph-orbit-color-actions' });
		const ok = actions.createEl('button', { text: Core.STR.planOk, cls: 'mod-cta' });
		ok.addEventListener('click', () => {
			const y = parseInt(yearInput.value, 10);
			let w = parseInt(weekInput.value, 10);
			if (!isFinite(y) || !isFinite(w)) {
				this.close();
				return;
			}
			w = Math.max(1, Math.min(w, Plan.weeksInYear(y)));
			this.onPick(y, w);
			this.close();
		});
		const cancel = actions.createEl('button', { text: Core.STR.planCancel });
		cancel.addEventListener('click', () => this.close());
	}

	/** 顺序：任务1原因 → 任务1改进 → 任务2原因 → … 末尾时若有空项先补空项，全填则保存 */
	stepNext(fromInput) {
		const seq = [];
		for (const row of this.rows) {
			seq.push({ input: row.reason, row }, { input: row.improve, row });
		}
		const at = (i) => seq[i];
		const cur = seq.findIndex((e) => e.input === fromInput);
		const focusItem = (item) => {
			if (!item) return;
			// 先展开卡片再聚焦（隐藏元素无法获得焦点）
			if (item.row && item.row.body) {
				item.row.body.style.display = '';
				if (item.row.chev) item.row.chev.setText('▾');
			}
			if (item.input.focus) item.input.focus();
		};

		const next = cur >= 0 ? at(cur + 1) : at(0);
		if (next) {
			focusItem(next);
			return;
		}
		// 已到末尾：还有空项就先跳过去（同样先展开）
		for (const item of seq) {
			if (!String(item.input.value || '').trim()) {
				focusItem(item);
				return;
			}
		}
		if (this.contentEl && this.contentEl.__submit) this.contentEl.__submit();
	}
	onClose() {
		this.contentEl.empty();
	}
}

// ============================================================================
// ViewPlan — OrbitView 的一部分（通过 Object.assign 混入，方法内 this 指向视图）
// ============================================================================
const ViewPlan = {
	async gotoWeek(year, week) {
		const target = year && week ? { year, week } : Plan.isoWeekOf(new Date());
		this.weekYear = target.year;
		this.weekNum = target.week;
		this.dayOpen = null; // 换周重新决定展开哪几天
		await this.loadWeek();
	},

	planPathNow() {
		return Plan.planPath(this.plugin.settings.planFolder, this.weekYear, this.weekNum);
	},

	async loadWeek() {
		const path = this.planPathNow();
		let file = null;
		try {
			file = this.app.vault.getAbstractFileByPath(path);
		} catch (e) {
			file = null;
		}
		this.planFile = file && file.extension === 'md' ? file : null;
		if (this.planFile) {
			try {
				this.planText = await this.app.vault.read(this.planFile);
			} catch (e) {
				this.planText = '';
			}
		} else {
			this.planText = '';
		}
		// 旧格式（整篇只有一份四象限）→ 自动迁移成按天格式
		if (this.planText && this.planText.trim()) {
			const parsed = Plan.parse(this.planText);
			if (parsed.legacy) {
				const migrated = Plan.migrateLegacy(this.planText, this.weekYear, this.weekNum);
				await this.writePlanText(migrated);
				new Notice(Core.STR.planMigrated);
			}
		}
		this.renderPlan();
	},

	/** 写回笔记：文件不存在时按需创建目录与文件 */
	async writePlanText(next, opts) {
		if (next === null || next === undefined) return;
		this.planText = next;
		if (!(opts && opts.skipRender)) this.renderPlan();
		try {
			if (!this.planFile) {
				await this.createPlanFile(next);
			} else {
				const target = this.planFile;
				await this.app.vault.process(target, () => next);
			}
		} catch (e) {
			new Notice(Core.STR.planSaveFail);
		}
	},

	async createPlanFile(content) {
		const folder = String(this.plugin.settings.planFolder || 'orbit-plan').replace(/^\/+|\/+$/g, '');
		const yearDir = folder + '/' + this.weekYear;
		for (const p of [folder, yearDir]) {
			let exists = null;
			try {
				exists = this.app.vault.getAbstractFileByPath(p);
			} catch (e) {
				exists = null;
			}
			if (!exists) {
				try {
					await this.app.vault.createFolder(p);
				} catch (e) {
					/* 并发创建时忽略 */
				}
			}
		}
		const path = this.planPathNow();
		this.planFile = await this.app.vault.create(path, content);
	},

	/** 用当前 weekYear/weekNum/planText 重画下半区 */
	renderPlan() {
		const el = this.planEl;
		if (!el) return;
		// 记住滚动位置：勾选/编辑/删除后不要跳回顶部
		const keepTop = this.planBodyEl ? this.planBodyEl.scrollTop || 0 : 0;
		const keepPdca = this.pdcaBodyEl ? this.pdcaBodyEl.scrollTop || 0 : 0;
		el.empty();

		const parsed = Plan.parse(this.planText);

		// ---- 头部：紧凑工具条（图标按钮 + 更多菜单）----
		const head = el.createDiv({ cls: 'orbit-plan-head' });

		const iconBtn = (parent, icon, tip, onClick, extraCls) => {
			const btn = parent.createSpan({ cls: 'orbit-plan-icon' + (extraCls ? ' ' + extraCls : '') });
			btn.setAttribute('aria-label', tip);
			btn.setAttribute('title', tip);
			setIcon(btn, icon);
			btn.addEventListener('click', onClick);
			return btn;
		};

		iconBtn(head, 'chevron-left', Core.STR.planPrev, () => {
			const p = Plan.shiftWeek(this.weekYear, this.weekNum, -1);
			void this.gotoWeek(p.year, p.week);
		});

		const title = head.createSpan({ cls: 'orbit-plan-week', text: Plan.weekShort(this.weekYear, this.weekNum) });
		title.setAttribute('title', Core.STR.planJump);
		title.addEventListener('click', () => this.openWeekJump());

		iconBtn(head, 'chevron-right', Core.STR.planNext, () => {
			const n = Plan.shiftWeek(this.weekYear, this.weekNum, 1);
			void this.gotoWeek(n.year, n.week);
		});

		const actions = head.createDiv({ cls: 'orbit-plan-actions' });
		iconBtn(actions, 'calendar-check', Core.STR.planThisWeek, () => void this.gotoWeek(null, null));
		iconBtn(actions, 'sun', Core.STR.planCarry, () => void this.carryOverTasks());
		iconBtn(actions, 'download', Core.STR.planImport, () => void this.importLastWeek());
		iconBtn(actions, 'file-text', Core.STR.planOpenDoc, () => void this.openPlanNote());
		iconBtn(actions, 'eraser', Core.STR.planClearPins, () => this.clearPins());

		// ---- 七天 × 四象限 ----
		const body = el.createDiv({ cls: 'orbit-plan-body' });
		this.planBodyEl = body;
		this.rowRefs = new Map(); // line → { row, label, item }
		this.dayCountEls = new Map(); // day → 计数元素
		const totals = Plan.totals(parsed);
		const total = totals.total;
		const done = totals.done;
		const todayIdx = this.todayIndex();
		if (!this.dayOpen) this.dayOpen = new Map();

		for (let d = 0; d < Plan.DAYS.length; d++) {
			const dayTasks = parsed.days[d] ? parsed.days[d].quads : null;
			if (!dayTasks) continue;
			let dayTotal = 0;
			let dayDone = 0;
			for (let q = 0; q < Plan.QUADRANTS.length; q++) {
				dayTotal += dayTasks[q].tasks.length;
				for (const t of dayTasks[q].tasks) if (t.done) dayDone++;
			}

			const group = body.createDiv({ cls: 'orbit-plan-day' + (d === todayIdx ? ' is-today' : '') });
			const pendingHere = !!(this.pendingAdd && this.pendingAdd.d === d);
			const isOpen = pendingHere || (this.dayOpen.has(d) ? this.dayOpen.get(d) : d === todayIdx || dayTotal > 0);
			const head = group.createDiv({ cls: 'orbit-plan-day-head' });
			head.createSpan({ cls: 'orbit-plan-day-chevron', text: isOpen ? '▾' : '▸' });
			head.createSpan({ cls: 'orbit-plan-day-title', text: Plan.dayLabel(this.weekYear, this.weekNum, d) });
			const countEl = head.createSpan({ cls: 'orbit-plan-day-count', text: dayDone + '/' + dayTotal });
			this.dayCountEls.set(d, countEl);
			head.addEventListener('click', () => {
				this.dayOpen.set(d, !isOpen);
				this.renderPlan();
			});
			if (!isOpen) continue;

			const dayBody = group.createDiv({ cls: 'orbit-plan-day-body' });
			for (let q = 0; q < Plan.QUADRANTS.length; q++) {
				const quad = Plan.QUADRANTS[q];
				const tasks = dayTasks[q].tasks;

				const sec = dayBody.createDiv({ cls: 'orbit-plan-quad orbit-plan-tone-' + quad.tone });
				const qHead = sec.createDiv({ cls: 'orbit-plan-quad-head' });
				qHead.createSpan({ cls: 'orbit-plan-quad-title', text: quad.title });

				const list = sec.createDiv({ cls: 'orbit-plan-tasks' });
				for (let k = 0; k < tasks.length; k++) {
					const item = tasks[k];
					const row = list.createDiv({ cls: 'orbit-plan-task' });
					const box = row.createEl('input');
					box.setAttribute('type', 'checkbox');
					box.checked = item.done;
					box.addEventListener('change', () => {
						const next = Plan.toggleTask(this.planText, item.line);
						const doneNow = !item.done;
						label.classList.toggle('is-done', doneNow);
						void this.writePlanText(next, { skipRender: true });
						this.refreshPlanTotals();
					});
					const label = row.createSpan({ cls: 'orbit-plan-task-text', text: item.text });
					if (item.done) label.classList.add('is-done');
					this.rowRefs.set(item.line, { row, label, item });

					if (this.editingLine === item.line) {
						label.style.display = 'none';
						const input = row.createEl('input', { cls: 'orbit-plan-task-edit' });
						input.value = item.text;
						if (input.focus) input.focus();

						let settled = false;
						const finish = (save) => {
							if (settled) return;
							settled = true;
							this.editingLine = -1;
							if (!save) {
								this.renderPlan();
								return;
							}
							const next = Plan.setTaskText(this.planText, item.line, input.value);
							if (next) {
								const clean = String(input.value || '').replace(/\r?\n/g, ' ').trim();
								label.textContent = clean;
								label.style.display = '';
								if (input.parentElement) input.remove();
								void this.writePlanText(next, { skipRender: true });
							} else {
								this.renderPlan();
							}
						};
						input.addEventListener('keydown', (e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								finish(true);
							} else if (e.key === 'Escape') {
								finish(false);
							}
						});
						input.addEventListener('blur', () => finish(true));
					} else {
						label.addEventListener('dblclick', () => {
							this.editingLine = item.line;
							this.renderPlan();
						});
						const del = row.createSpan({ cls: 'orbit-plan-task-del', text: '×' });
						del.setAttribute('title', Core.STR.planDelete);
						del.addEventListener('click', () => {
							const next = Plan.removeTask(this.planText, item.line);
							void this.writePlanText(next);
						});
					}
				}

				const addBtn = sec.createDiv({ cls: 'orbit-plan-add', text: '+ ' + Core.STR.planAdd });
				addBtn.addEventListener('click', () => this.openAddInput(sec, addBtn, d, q));
				if (this.pendingAdd && this.pendingAdd.d === d && this.pendingAdd.q === q) {
					this.pendingAdd = null;
					this.openAddInput(sec, addBtn, d, q);
				}
			}
		}

		if (total === 0) body.createDiv({ cls: 'orbit-plan-empty', text: Core.STR.planEmpty });

		// ---- 本周完成度：胶囊进度条 ----
		const pct = total > 0 ? Math.round((done / total) * 100) : 0;
		const prog = el.createDiv({ cls: 'orbit-plan-progress' });
		const bar = prog.createDiv({ cls: 'orbit-plan-progress-bar' });
		const fill = bar.createDiv({ cls: 'orbit-plan-progress-fill' });
		fill.style.width = pct + '%';
		this.progressFillEl = fill;
		this.progressTextEl = prog.createSpan({ cls: 'orbit-plan-progress-text', text: pct + '%' });

		// ---- PDCA 复盘（默认折叠）----
		const pdcaWrap = el.createDiv({ cls: 'orbit-plan-pdca' });
		const pdcaHead = pdcaWrap.createDiv({ cls: 'orbit-plan-pdca-head' });
		const chev = pdcaHead.createSpan({ cls: 'orbit-plan-chevron', text: this.pdcaOpen ? '▾' : '▸' });
		pdcaHead.createSpan({ cls: 'orbit-plan-pdca-title', text: Core.STR.planPdca });
		pdcaHead.addEventListener('click', () => {
			this.pdcaOpen = !this.pdcaOpen;
			this.renderPlan();
		});
		let pdcaBodyRef = null;
		if (this.pdcaOpen) {
			const pdcaBody = pdcaWrap.createDiv({ cls: 'orbit-plan-pdca-body' });
			pdcaBodyRef = pdcaBody;
			for (let p = 0; p < Plan.PDCA.length; p++) {
				const item = Plan.PDCA[p];
				const block = pdcaBody.createDiv({ cls: 'orbit-plan-pdca-block' });
				const badge = block.createDiv({ cls: 'orbit-plan-pdca-label' });
				badge.createSpan({ cls: 'orbit-plan-pdca-badge', text: item.key.toUpperCase() });
				badge.createSpan({ cls: 'orbit-plan-pdca-name', text: item.title.slice(2) });

				const content = parsed.pdca[p] || '';
				const textEl = block.createDiv({ cls: 'orbit-plan-pdca-text' });
				if (content) {
					textEl.setText(content);
				} else {
					textEl.setText('+ ' + item.prompt);
					textEl.classList.add('is-empty');
				}
				textEl.addEventListener('click', () => {
					textEl.style.display = 'none';
					const ta = block.createEl('textarea', { cls: 'orbit-plan-pdca-input' });
					ta.value = content;
					ta.rows = 3;
					ta.focus();
					const save = () => {
						const next = Plan.setPdca(this.planText || Plan.skeleton(this.weekYear, this.weekNum), p, ta.value);
						void this.writePlanText(next);
					};
					ta.addEventListener('blur', save);
					ta.addEventListener('keydown', (e) => {
						if (e.key === 'Escape') {
							ta.remove();
							textEl.style.display = '';
						}
					});
				});
			}
		}

		chev && chev.setText(this.pdcaOpen ? '▾' : '▸');

		// 子节点全部建完之后再恢复滚动位置（空元素上赋值会被浏览器夹成 0）
		body.scrollTop = keepTop;
		this.pdcaBodyEl = pdcaBodyRef;
		if (pdcaBodyRef) pdcaBodyRef.scrollTop = keepPdca;
	},

	/** 局部刷新：只更新每日计数与顶部进度，不重建 DOM */
	refreshPlanTotals() {
		const parsed = Plan.parse(this.planText);
		const totals = Plan.totals(parsed);
		for (let d = 0; d < Plan.DAYS.length; d++) {
			const el = this.dayCountEls && this.dayCountEls.get(d);
			if (!el) continue;
			let dayTotal = 0;
			let dayDone = 0;
			const quads = parsed.days[d] ? parsed.days[d].quads : null;
			if (!quads) continue;
			for (let q = 0; q < Plan.QUADRANTS.length; q++) {
				dayTotal += quads[q].tasks.length;
				for (const t of quads[q].tasks) if (t.done) dayDone++;
			}
			el.setText(dayDone + '/' + dayTotal);
		}
		const pct = totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
		if (this.progressFillEl) this.progressFillEl.style.width = pct + '%';
		if (this.progressTextEl) this.progressTextEl.setText(pct + '%');
	},

	/** 打开某象限的「新任务」输入框；回车提交后自动再开一个，方便连续录入 */
	openAddInput(sec, addBtn, d, q) {
		if (this.editingLine >= 0) return; // 正在改某条任务时，不抢它的焦点
		addBtn.style.display = 'none';
		const input = sec.createEl('input', { cls: 'orbit-plan-add-input' });
		input.setAttribute('type', 'text');
		input.setAttribute('placeholder', Core.STR.planAddHint);
		if (input.focus) input.focus();

		let settled = false;
		const close = () => {
			settled = true;
			if (input.parentElement) input.remove();
			addBtn.style.display = '';
		};
		const commit = () => {
			if (settled) return;
			settled = true;
			const text = String(input.value || '').trim();
			if (!text) {
				close();
				return;
			}
			const base = this.planText && this.planText.trim() ? this.planText : Plan.skeleton(this.weekYear, this.weekNum);
			const next = Plan.addTask(base, d, q, text);
			this.pendingAdd = { d, q }; // 重绘后接着开下一个
			void this.writePlanText(next);
		};

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			} else if (e.key === 'Escape') {
				close();
			}
		});
		input.addEventListener('blur', commit);
	},

	openWeekJump() {
		new WeekJumpModal(this.app, this.weekYear, this.weekNum, (y, w) => {
			void this.gotoWeek(y, w);
		}).open();
	},

	async importLastWeek() {
		const prev = Plan.shiftWeek(this.weekYear, this.weekNum, -1);
		const path = Plan.planPath(this.plugin.settings.planFolder, prev.year, prev.week);
		let file = null;
		try {
			file = this.app.vault.getAbstractFileByPath(path);
		} catch (e) {
			file = null;
		}
		if (!file) {
			new Notice(Core.STR.planNoPrev);
			return;
		}
		let prevText = '';
		try {
			prevText = await this.app.vault.read(file);
		} catch (e) {
			prevText = '';
		}
		const items = Plan.collectUnfinished(prevText);
		if (!items.length) {
			new Notice(Core.STR.planNoUnfinished);
			return;
		}
		const base = this.planText && this.planText.trim() ? this.planText : Plan.skeleton(this.weekYear, this.weekNum);
		const merged = Plan.mergeUnfinished(base, items);
		await this.writePlanText(merged.text);
		new Notice(Core.STR.planImported.replace('{n}', String(merged.added)));
	},

	applySplit(ratio) {
		const r = Core.clamp(Number(ratio) || 0.55, 0.25, 0.8);
		this.splitRatio = r;
		if (this.graphEl) this.graphEl.style.flex = '0 0 ' + (r * 100).toFixed(2) + '%';
		if (this.renderer) this.renderer.resize();
	},

	startSplitDrag(e) {
		if (e && e.preventDefault) e.preventDefault();
		this.splitDragging = true;
		if (this.splitEl && this.splitEl.getBoundingClientRect) {
			const rect = this.splitEl.getBoundingClientRect();
			this.splitRect = rect;
		}
	},

	moveSplitDrag(e) {
		if (!this.splitDragging || !this.splitRect || !e) return;
		const h = this.splitRect.height || 1;
		const y = e.clientY - this.splitRect.top;
		this.applySplit(y / h);
	},

	endSplitDrag() {
		if (!this.splitDragging) return;
		this.splitDragging = false;
		this.plugin.settings.splitRatio = this.splitRatio;
		this.plugin.scheduleSave();
	},

	async openPlanNote() {
	const path = Plan.planPath(this.plugin.settings.planFolder, this.weekYear, this.weekNum);
	let exists = null;
	try {
	exists = this.app.vault.getAbstractFileByPath(path);
	} catch (e) {
	exists = null;
	}
	if (!exists) {
	await this.createPlanFile(this.planText || Plan.skeleton(this.weekYear, this.weekNum));
	new Notice(Core.STR.planDocMissing);
	}
	if (this.app.workspace && this.app.workspace.openLinkText) {
	this.app.workspace.openLinkText(path, '', false);
	}
},

	/** 清空拖拽记忆（两次点击确认，避免误触） */
	clearPins() {
		if (!this.pinsArmed) {
			this.pinsArmed = true;
			new Notice(Core.STR.planClearPinsAgain);
			setTimeout(() => {
				this.pinsArmed = false;
			}, 3000);
			return;
		}
		this.pinsArmed = false;
		this.plugin.settings.pins = {};
		this.plugin.scheduleSave();
		this.bump = {};
		this.applyLayout(true);
		new Notice(Core.STR.planPinsCleared);
	}
};

// ---- src/view-timer.js ----
class TimerModal extends Modal {
	constructor(app, onStart, onCancel) {
		super(app);
		this.onStart = onStart;
		this.onCancel = onCancel;
		this.started = false;
		this.quad = 0;
		this.chipEls = [];
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.classList.add('graph-orbit-modal', 'orbit-plan-timer-modal');
		contentEl.createEl('h3', { text: Core.STR.timerTitle, cls: 'orbit-plan-timer-title' });

		// 象限：四个彩色胶囊
		const fq = contentEl.createDiv({ cls: 'orbit-plan-field' });
		fq.createDiv({ cls: 'orbit-plan-field-label', text: Core.STR.timerQuad });
		const chips = fq.createDiv({ cls: 'orbit-plan-chips' });
		for (let i = 0; i < Plan.QUADRANTS.length; i++) {
			const q = Plan.QUADRANTS[i];
			const chip = chips.createDiv({ cls: 'orbit-plan-chip orbit-plan-tone-' + q.tone, text: q.title });
			chip.addEventListener('click', () => this.pickQuad(i));
			this.chipEls.push(chip);
		}
		this.pickQuad(0);

		// 名称
		const fn = contentEl.createDiv({ cls: 'orbit-plan-field' });
		fn.createDiv({ cls: 'orbit-plan-field-label', text: Core.STR.timerName });
		this.nameInput = fn.createEl('input', { cls: 'orbit-plan-field-input' });
		this.nameInput.setAttribute('placeholder', Core.STR.timerNameHint);

		// 内容
		const fc = contentEl.createDiv({ cls: 'orbit-plan-field' });
		fc.createDiv({ cls: 'orbit-plan-field-label', text: Core.STR.timerContent });
		this.bodyInput = fc.createEl('textarea', { cls: 'orbit-plan-field-textarea' });
		this.bodyInput.setAttribute('placeholder', Core.STR.timerContentHint);
		this.bodyInput.rows = 4;

		// 倒计时：留空 = 正计时
		const fd = contentEl.createDiv({ cls: 'orbit-plan-field' });
		fd.createDiv({ cls: 'orbit-plan-field-label', text: Core.STR.timerCountdown });
		const cdRow = fd.createDiv({ cls: 'orbit-plan-carry-row' });
		this.minutesInput = cdRow.createEl('input', { cls: 'orbit-plan-field-input' });
		this.minutesInput.setAttribute('placeholder', Core.STR.timerCountdownHint);
		cdRow.createSpan({ cls: 'orbit-plan-carry-label', text: Core.STR.timerUnitMin });
		this.secondsInput = cdRow.createEl('input', { cls: 'orbit-plan-field-input' });
		this.secondsInput.setAttribute('placeholder', Core.STR.timerUnitSecHint);
		cdRow.createSpan({ cls: 'orbit-plan-carry-label', text: Core.STR.timerUnitSec });
		this.minutesHintEl = fd.createDiv({ cls: 'orbit-plan-field-label orbit-plan-countdown-hint', text: '' });
		const updateHint = () => {
			const mmRaw = String(this.minutesInput.value || '').trim();
			const ssRaw = String(this.secondsInput.value || '').trim();
			const mm = mmRaw === '' ? 0 : Number(mmRaw);
			const ss = ssRaw === '' ? 0 : Number(ssRaw);
			const ok = isFinite(mm) && isFinite(ss) && mm >= 0 && ss >= 0;
			const total = ok ? Math.round(mm * 60 + ss) : 0;
			this.minutesHintEl.setText(total > 0 ? '= ' + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0') : '');
		};
		this.minutesInput.addEventListener('input', updateHint);
		this.secondsInput.addEventListener('input', updateHint);

		this.errorEl = contentEl.createDiv({ cls: 'orbit-plan-field-error', text: '' });

		const actions = contentEl.createDiv({ cls: 'orbit-plan-timer-actions' });
		const cancel = actions.createEl('button', { text: Core.STR.timerCancel, cls: 'orbit-plan-timer-cancel' });
		cancel.addEventListener('click', () => this.close());
		const ok = actions.createEl('button', { text: Core.STR.timerOk, cls: 'mod-cta' });
		ok.addEventListener('click', () => this.submit());

		this.nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
		});
		if (this.nameInput.focus) this.nameInput.focus();
	}

	pickQuad(i) {
		this.quad = i;
		for (let k = 0; k < this.chipEls.length; k++) this.chipEls[k].toggleClass('is-selected', k === i);
	}

	submit() {
		const name = String(this.nameInput.value || '').trim();
		if (!name) {
			this.errorEl.setText(Core.STR.timerNeedName);
			this.nameInput.addClass('is-invalid');
			return;
		}
		const rawMin = String(this.minutesInput ? this.minutesInput.value || '' : '').trim();
		const rawSec = String(this.secondsInput ? this.secondsInput.value || '' : '').trim();
		let totalSec = 0;
		if (rawMin !== '' || rawSec !== '') {
			const mm = rawMin === '' ? 0 : Number(rawMin);
			const ss = rawSec === '' ? 0 : Number(rawSec);
			const ok = isFinite(mm) && isFinite(ss) && mm >= 0 && ss >= 0 && mm <= 999 && ss < 60;
			totalSec = ok ? Math.round(mm * 60 + ss) : 0;
			if (!ok || totalSec < 1) {
				this.errorEl.setText(Core.STR.timerCountdownInvalid);
				if (this.minutesInput) this.minutesInput.addClass('is-invalid');
				if (this.secondsInput) this.secondsInput.addClass('is-invalid');
				return;
			}
		}
		this.errorEl.setText('');
		this.nameInput.removeClass('is-invalid');
		if (this.minutesInput) this.minutesInput.removeClass('is-invalid');
		if (this.secondsInput) this.secondsInput.removeClass('is-invalid');
		this.started = true;
		this.onStart(this.quad, name, String(this.bodyInput.value || '').trim(), totalSec);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
		if (!this.started) this.onCancel();
	}
}

class CarryOverModal extends Modal {
	constructor(app, items, onSave) {
		super(app);
		this.items = items || [];
		this.onSave = onSave;
		this.rows = [];
		this.saved = false;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.classList.add('graph-orbit-modal', 'orbit-plan-carry-modal');
		contentEl.createEl('h3', { text: Core.STR.planCarryTitle });
		contentEl.createDiv({
			cls: 'orbit-plan-carry-summary',
			text: Core.STR.planCarrySummary.replace('{n}', String(this.items.length)),
		});

		const scroll = contentEl.createDiv({ cls: 'orbit-plan-carry-scroll' });
		for (let k = 0; k < this.items.length; k++) {
			const item = this.items[k];
			const block = scroll.createDiv({ cls: 'orbit-plan-carry-item' });
			// 折叠卡片：标题行点击展开/收起，默认只展开第一条
			const isOpen = k === 0;
			const headRow = block.createDiv({ cls: 'orbit-plan-carry-head' });
			const chev = headRow.createSpan({ cls: 'orbit-plan-carry-chevron', text: isOpen ? '▾' : '▸' });
			headRow.createSpan({ cls: 'orbit-plan-carry-name', text: item.text });

			const body = block.createDiv({ cls: 'orbit-plan-carry-body' });
			body.style.display = isOpen ? '' : 'none';

			const rowR = body.createDiv({ cls: 'orbit-plan-carry-row' });
			rowR.createSpan({ cls: 'orbit-plan-carry-label', text: Core.STR.planCarryReason });
			const reason = rowR.createEl('input', { cls: 'orbit-plan-field-input' });
			reason.setAttribute('placeholder', Core.STR.planCarryReasonHint);

			const rowI = body.createDiv({ cls: 'orbit-plan-carry-row' });
			rowI.createSpan({ cls: 'orbit-plan-carry-label', text: Core.STR.planCarryImprove });
			const improve = rowI.createEl('input', { cls: 'orbit-plan-field-input' });
			improve.setAttribute('placeholder', Core.STR.planCarryImproveHint);

			headRow.addEventListener('click', () => {
				const openNow = body.style.display === 'none';
				body.style.display = openNow ? '' : 'none';
				chev.setText(openNow ? '▾' : '▸');
			});

			// Enter 依次跳到下一个输入框；最后一个输入框按下时才尝试保存
			const onKey = (e, self) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.stepNext(self);
				} else if (e.key === 'Escape') {
					this.close();
				}
			};
			reason.addEventListener('keydown', (e) => onKey(e, reason));
			improve.addEventListener('keydown', (e) => onKey(e, improve));
			// 聚焦到收起卡片里的输入框时自动展开
			const expand = () => {
				if (body.style.display === 'none') {
					body.style.display = '';
					chev.setText('▾');
				}
			};
			reason.addEventListener('focus', expand);
			improve.addEventListener('focus', expand);

			this.rows.push({ text: item.text, reason, improve, body, chev });
		}

		const actions = contentEl.createDiv({ cls: 'orbit-plan-timer-actions orbit-plan-carry-actions' });
		const cancel = actions.createEl('button', { text: Core.STR.planCarryCancel });
		cancel.addEventListener('click', () => this.close());
		const ok = actions.createEl('button', { text: Core.STR.planCarryOk, cls: 'mod-cta' });
		const submit = () => {
			const entries = [];
			for (const row of this.rows) {
				entries.push({
					text: row.text,
					reason: String(row.reason.value || '').trim(),
					improve: String(row.improve.value || '').trim(),
				});
			}
			this.saved = true;
			this.onSave(entries);
			this.close();
		};
		ok.addEventListener('click', submit);
		contentEl.__submit = submit;
	}

	/** 顺序：任务1原因 → 任务1改进 → 任务2原因 → … 末尾时若有空项先补空项，全填则保存 */
	stepNext(fromInput) {
		const seq = [];
		for (const row of this.rows) {
			seq.push({ input: row.reason, row }, { input: row.improve, row });
		}
		const at = (i) => seq[i];
		const cur = seq.findIndex((e) => e.input === fromInput);
		const focusItem = (item) => {
			if (!item) return;
			// 先展开卡片再聚焦（隐藏元素无法获得焦点）
			if (item.row && item.row.body) {
				item.row.body.style.display = '';
				if (item.row.chev) item.row.chev.setText('▾');
			}
			if (item.input.focus) item.input.focus();
		};

		const next = cur >= 0 ? at(cur + 1) : at(0);
		if (next) {
			focusItem(next);
			return;
		}
		// 已到末尾：还有空项就先跳过去（同样先展开）
		for (const item of seq) {
			if (!String(item.input.value || '').trim()) {
				focusItem(item);
				return;
			}
		}
		if (this.contentEl && this.contentEl.__submit) this.contentEl.__submit();
	}
	onClose() {
		this.contentEl.empty();
	}
}

// ============================================================================
// ViewTimer — OrbitView 的一部分（通过 Object.assign 混入，方法内 this 指向视图）
// ============================================================================
const ViewTimer = {
	toggleTimer() {
		if (!this.timerActive) {
			this.timerActive = true;
			this.timerStart = 0;
			this.timerItem = null;
			this.renderTimer();
			this.openTimerModal();
			return;
		}
		void this.stopTimer();
	},

	openTimerModal() {
		new TimerModal(
			this.app,
			(quad, name, content, totalSeconds) => this.startTimer(quad, name, content, totalSeconds),
			() => {
				this.timerActive = false;
				this.renderTimer();
			}
		).open();
	},

	startTimer(quad, name, content, totalSeconds) {
		const text = content ? name + '：' + content : name;
		this.timerItem = { quad, day: this.todayIndex(), text, year: this.weekYear, week: this.weekNum };
		this.timerStart = this.now();
		this.timerMode = totalSeconds > 0 ? 'down' : 'up';
		this.planSec = totalSeconds > 0 ? Math.round(totalSeconds) : 0;
		this.breathing = false;
		const base = this.planText && this.planText.trim() ? this.planText : Plan.skeleton(this.weekYear, this.weekNum);
		const day = this.todayIndex();
		this.timerItem.day = day;
		void this.writePlanText(Plan.addTask(base, day, quad, text));
		this.renderTimer();
	},

	async stopTimer() {
		const started = this.timerStart;
		const item = this.timerItem;
		const elapsed = started ? Math.max(0, this.now() - started) : 0;
		const down = this.timerMode === 'down';
		const remain = down ? Math.max(0, this.planSec - Math.floor(elapsed / 1000)) : 0;
		const planSec = this.planSec;
		this.timerActive = false;
		this.timerStart = 0;
		this.timerItem = null;
		this.timerMode = 'up';
		this.planSec = 0;
		this.timerRemain = 0;
		this.breathing = false;
		this.breathing = false;
		this.timerMode = 'up';
		this.planSec = 0;
		this.renderTimer();
		if (!started || !item) return;

		// 倒计时未到点 → 取消：不写笔记
		if (down && remain > 0) {
			new Notice(Core.STR.timerCancelDown || '已取消倒计时');
			return;
		}

		// 计时跨周时，仍写回开始那一周的笔记
		if (this.weekYear !== item.year || this.weekNum !== item.week) {
			await this.gotoWeek(item.year, item.week);
		}

		const line = Plan.findTaskLine(this.planText, item.text);
		if (line < 0) {
			new Notice(Core.STR.timerLost);
			return;
		}

		const totalSec = Math.floor(elapsed / 1000);
		const suffix = down
			? Core.STR.timerDownUsed
					.replace('{pm}', String(Math.floor(planSec / 60)))
					.replace('{ps}', String(planSec % 60))
					.replace('{am}', String(Math.floor(totalSec / 60)))
					.replace('{as}', String(totalSec % 60))
			: Core.STR.timerUsed.replace('{m}', String(Math.floor(totalSec / 60))).replace('{s}', String(totalSec % 60));
		const renamed = Plan.setTaskText(this.planText, line, item.text + suffix);
		const doneText = renamed ? Plan.toggleTask(renamed, line) : null;
		await this.writePlanText(doneText || renamed || this.planText);
	},

	/** 刷新按钮文案、右侧计时标签与三针角度 */
	renderTimer() {
		if (this.timerBtnEl) {
			let tip = this.timerActive ? Core.STR.timerStop : Core.STR.timerStart;
			if (this.timerActive && this.timerMode === 'down' && this.timerLabelEl) {
				const remainText = String(this.timerLabelEl.textContent || '');
				if (remainText) tip += '（剩余 ' + remainText + '）';
			}
			this.timerBtnEl.setAttribute('aria-label', tip);
			this.timerBtnEl.setAttribute('title', tip);
			this.timerBtnEl.toggleClass('is-active', this.timerActive);
		}
		if (!this.timerActive) {
			this.handAngles = null;
			if (this.timerLabelEl) this.timerLabelEl.setText('');
			return;
		}

		const elapsed = this.timerStart ? Math.max(0, this.now() - this.timerStart) : 0;
		this.timerElapsed = elapsed;
		const down = this.timerMode === 'down';
		const remain = down ? Math.max(0, this.planSec - Math.floor(elapsed / 1000)) : 0;
		this.timerRemain = down ? remain : 0;
		if (down) this.breathing = remain === 0;
		const shown = down ? remain : Math.floor(elapsed / 1000);
		const mm = Math.floor(shown / 60);
		const ss = shown % 60;
		if (this.timerLabelEl) this.timerLabelEl.setText((mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss);

		// 倒计时：从时长对应位置出发，随剩余减少而逆时针回退
		this.handAngles = down
			? {
					s: (remain % 60) / 60,
					m: ((remain / 60) % 60) / 60,
					h: ((remain / 3600) % 12) / 12,
				}
			: {
					s: (elapsed % 60000) / 60000,
					m: ((elapsed / 60000) % 60) / 60,
					h: ((elapsed / 3600000) % 12) / 12,
				};
	},

	/** ☀ 迁移昨天未完成任务：勾选+加后缀、复制到今天、弹窗记录原因/改进并写入 PDCA */
	async carryOverTasks() {
		const today = this.todayIndex();
		if (today === 0) {
			new Notice(Core.STR.planCarryMonday);
			return;
		}
		const base = this.planText && this.planText.trim() ? this.planText : Plan.skeleton(this.weekYear, this.weekNum);
		const pending = Plan.unfinishedOf(base, today - 1);
		if (!pending.length) {
			new Notice(Core.STR.planCarryEmpty);
			return;
		}

		// 弹窗按"昨天全部未完成"列条目（即使今天已有同名任务，也要逐条填写）
		const rows = pending.map((p) => ({ text: p.text, quad: p.quad }));
		const res = Plan.carryOver(base, today - 1, today);
		await this.writePlanText(res.text);

		new CarryOverModal(this.app, rows, (entries) => {
			const dayLabel = Plan.dayName(today - 1);
			const next = Plan.appendPdca(this.planText, dayLabel, entries);
			void this.writePlanText(next);
			new Notice(Core.STR.planCarrySaved);
		}).open();
	}
};

// ---- src/view.js ----
// ============================================================================
// view.js — 关系图谱视图（ItemView，开在主编辑区的标签页里）
//
// 打开方式与 Obsidian 自带的「关系图谱」一致：占一个标签页，可拖到分栏，
// 位置与开关由 workspace.json 记住。渲染与布局完全复用 Layout / Renderer。
// ============================================================================
const Views = (function () {
	const VIEW_TYPE = 'orbit-plan-kle-view';
	const LEGACY_VIEW_TYPE = 'graph-orbit-kle-view'; // 改名前旧标签页的类型，onload 时清掉

	// ------------------------------------------------------------------
	// 节点取色弹窗
	// ------------------------------------------------------------------


	// ------------------------------------------------------------------
	// 「跳到某周」小窗
	// ------------------------------------------------------------------


	// ------------------------------------------------------------------
	// ------------------------------------------------------------------
	// 未完成任务：逐条记录原因与改进
	// ------------------------------------------------------------------

	// 计时器：选象限 + 填名称/内容
	// ------------------------------------------------------------------


	// ------------------------------------------------------------------
	// 主视图
	// ------------------------------------------------------------------
	class OrbitView extends ItemView {
		constructor(leaf, plugin) {
			super(leaf);
			this.plugin = plugin;

			this.canvasEl = null;
			this.wrapEl = null;
			this.renderer = null;
			this.resizeObs = null;
			this.frameId = null;
			this.lastTs = 0;

			this.clock = 0;
			this.paused = false;
			this.wall = 0;

			this.scale = 1;
			this.ox = 0;
			this.oy = 0;
			this.hasFit = false;
			this.fitWait = 0;

			this.dragging = false;
			this.moved = false;
			this.dragX = 0;
			this.dragY = 0;
			this.dragOx = 0;
			this.dragOy = 0;

			this.graph = null;
			this.recs = null;
			this.layoutMaxR = 1;
			this.n = 0;
			this.m = 0;
			this.labels = [];
			this.colors = new Array(0);
			this.cometMask = new Int8Array(0);
			this.holdClock = new Float64Array(0);
			this.lag = new Float64Array(0);
			this.adj = null;
			this.hovered = -1;
			this.nodeDrag = null;
			this.dragWorld = null;
			this.bump = {}; // 被 PDF 彗星撞下来的临时降轨（不持久化）
			this.hitAt = new Float64Array(0);
			this.cometPdfs = [];
			this.cometMds = [];
			this.dirs = new Float64Array(0);
			this.orbitNow = new Int32Array(0);
			this.timerActive = false;
			this.timerStart = 0;
			this.timerItem = null;
			this.timerMode = 'up';
			this.planSec = 0;
			this.timerRemain = 0;
			this.breathing = false;
			this.handAngles = null;
			this.timerElapsed = 0;
			this.editingLine = -1;
			this.pendingAdd = null;
			this.dayOpen = null;
			this.accent = null;
			this.focusIdx = -1;
			this.timerBtnEl = null;
			this.timerLabelEl = null;
			this.needRecolor = true;
			this.model = {};

			// 下半区：计划表状态
			const now = Plan.isoWeekOf(new Date());
			this.weekYear = now.year;
			this.weekNum = now.week;
			this.planText = '';
			this.planFile = null;
			this.pdcaOpen = false;
			this.splitDragging = false;
			this.splitRatio = 0.55;
			this.splitRect = null;
			this.splitEl = null;
			this.graphEl = null;
			this.dividerEl = null;
			this.planEl = null;

			this.scheduleRebuild = debounce(() => this.rebuild(), 700, true);

			this.onWheel = this.handleWheel.bind(this);
			this.onDown = this.handleDown.bind(this);
			this.onMove = this.handleMove.bind(this);
			this.onUp = this.handleUp.bind(this);
			this.onClick = this.handleClick.bind(this);
			this.onContext = this.handleContext.bind(this);
			this.onHover = this.handleHover.bind(this);
			this.onKey = this.handleKey.bind(this);
			this.tick = this.tick.bind(this);
		}

		getViewType() {
			return VIEW_TYPE;
		}

		getDisplayText() {
			return Core.STR.viewTitle;
		}

		getIcon() {
			return 'atom';
		}

		// --------------------------------------------------------------
		// 生命周期
		// --------------------------------------------------------------
		async onOpen() {
			const root = this.contentEl;
			root.empty();
			root.classList.add('orbit-plan-root');

			// 上下分区：上星图，下计划表，中间可拖拽
			const split = root.createDiv({ cls: 'orbit-plan-split' });
			this.splitEl = split;

			this.graphEl = split.createDiv({ cls: 'orbit-plan-graph' });
			this.wrapEl = this.graphEl.createDiv({ cls: 'graph-orbit-wrap' });
			this.canvasEl = this.wrapEl.createEl('canvas', { cls: 'graph-orbit-canvas' });
			this.canvasEl.setAttribute('aria-label', '关系图谱画布');
			this.canvasEl.setAttribute('tabindex', '0');
			this.registerDomEvent(this.canvasEl, 'keydown', (e) => this.handleKeydown(e));
			this.renderer = new Render.Renderer(this.canvasEl);
			this.renderer.resize();

			// 计时器：按钮 + 右侧浮动计时标签
			this.timerBtnEl = this.graphEl.createDiv({ cls: 'orbit-plan-timer-btn' });
			this.timerBtnEl.setAttribute('aria-label', Core.STR.timerStart);
			this.timerBtnEl.setAttribute('title', Core.STR.timerStart);
			setIcon(this.timerBtnEl, 'timer');
			this.timerLabelEl = this.graphEl.createDiv({ cls: 'orbit-plan-timer-label', text: '' });
			this.timerBtnEl.addEventListener('click', () => this.toggleTimer());

		// 搜索：计时按钮下方的放大镜
		this.searchBtnEl = this.graphEl.createDiv({ cls: 'orbit-plan-icon orbit-plan-search-btn' });
		this.searchBtnEl.setAttribute('aria-label', Core.STR.searchTip);
		this.searchBtnEl.setAttribute('title', Core.STR.searchTip);
		setIcon(this.searchBtnEl, 'search');
		this.searchBtnEl.addEventListener('click', () => this.toggleSearch());

			this.dividerEl = split.createDiv({ cls: 'orbit-plan-divider' });
			this.dividerEl.setAttribute('title', Core.STR.dragDivider);

			this.planEl = split.createDiv({ cls: 'orbit-plan-panel' });
			this.applySplit(this.plugin.settings.splitRatio);

			this.resizeObs = new ResizeObserver(() => {
				if (this.renderer) this.renderer.resize();
			});
			this.resizeObs.observe(this.graphEl);

			this.registerDomEvent(this.canvasEl, 'wheel', this.onWheel, { passive: false });
			this.registerDomEvent(this.canvasEl, 'mousedown', this.onDown);
			this.registerDomEvent(this.canvasEl, 'click', this.onClick);
			this.registerDomEvent(this.canvasEl, 'contextmenu', this.onContext);
			this.registerDomEvent(this.canvasEl, 'mousemove', this.onHover);
			this.registerDomEvent(this.canvasEl, 'mouseleave', () => this.setHovered(-1));
			this.registerDomEvent(window, 'mousemove', this.onMove);
			this.registerDomEvent(window, 'mouseup', this.onUp);
			this.registerDomEvent(window, 'keydown', this.onKey);

			this.registerDomEvent(this.dividerEl, 'pointerdown', (e) => this.startSplitDrag(e));
			this.registerDomEvent(window, 'pointermove', (e) => this.moveSplitDrag(e));
			this.registerDomEvent(window, 'pointerup', () => this.endSplitDrag());

			// 计划笔记本身的增删改不触发星图重建（否则会打断缩放/位置）
			this.onVaultChange = (file) => {
				const folder = String(this.plugin.settings.planFolder || 'orbit-plan').replace(/^\/+|\/+$/g, '');
				if (file && typeof file.path === 'string' && file.path.indexOf(folder + '/') === 0) return;
				this.scheduleRebuild();
			};
			this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onVaultChange(file)));
			// 冷启动时 resolvedLinks 还没建好，可能所有 degree 都是 0（球一样大）；
			// 缓存解析完成后按真实双链数重建 + 重新取景。
			this.registerEvent(
				this.app.metadataCache.on('resolved', () => {
					const first = !this.hasFit;
					this.rebuild();
					if (first) {
						this.fit();
						this.hasFit = true;
					}
				})
			);
			this.registerEvent(this.app.vault.on('create', (file) => this.onVaultChange(file)));
			this.registerEvent(this.app.vault.on('delete', (file) => this.onVaultChange(file)));
			this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleRename(file, oldPath)));

			this.restoreView();
			this.rebuild();
			this.applyAccent();
			await this.gotoWeek(this.weekYear, this.weekNum);
			this.primeGrowth();

			this.lastTs = performance.now();
			this.frameId = window.requestAnimationFrame(this.tick);
		}

		async onClose() {
			try {
				this.saveView();
				this.plugin.scheduleSave();
			} catch (e) {
				/* 视图销毁阶段忽略 */
			}
			if (this.frameId !== null) {
				window.cancelAnimationFrame(this.frameId);
				this.frameId = null;
			}
			if (this.resizeObs) {
				this.resizeObs.disconnect();
				this.resizeObs = null;
			}
			this.canvasEl = null;
			this.wrapEl = null;
			this.renderer = null;
			this.graph = null;
			this.recs = null;
			this.n = 0;
			this.planEl = null;
			this.splitEl = null;
			this.graphEl = null;
			this.dividerEl = null;
		}

		// --------------------------------------------------------------
		// 建图 / 布局 / 取景
		// --------------------------------------------------------------












		// --------------------------------------------------------------
		// 每帧
		// --------------------------------------------------------------



































































		// --------------------------------------------------------------
		// 交互
		// --------------------------------------------------------------


























		// --------------------------------------------------------------
		// 下半区：每周四项计划表 + PDCA
		// --------------------------------------------------------------


















		// --------------------------------------------------------------
		// 分隔条拖动
		// --------------------------------------------------------------








		// --------------------------------------------------------------
		// 计时器
		// --------------------------------------------------------------










		// --------------------------------------------------------------
		// 外部通知
		// --------------------------------------------------------------



	}

	// 把拆分出去的方法混入 OrbitView
	Object.assign(OrbitView.prototype, ViewGraph, ViewPlan, ViewTimer);

	return { VIEW_TYPE, LEGACY_VIEW_TYPE, OrbitView, ColorModal, WeekJumpModal, TimerModal, CarryOverModal };
})();

// ---- src/plugin.js ----
// ============================================================================
// plugin.js — 插件入口：在主编辑区开标签页、侧边栏按钮、命令、中文设置页
// ============================================================================
const DEFAULT_SETTINGS = {
	scheme: 'purple', // 色系（purple / red）
	spacing: 1.0, // 层间距
	spin: 1.0, // 自转速度
	trail: 0.55, // 轨迹长度（0 关闭）
	nodeScale: 1.0, // 节点大小
	colors: {}, // { "笔记路径": "#rrggbb" }
	planFolder: 'orbit-plan', // 每周计划笔记的根目录
	splitRatio: 0.55, // 上半星图占整个视图的比例
	repel: 0.35, // 球间斥力（0 关闭）
	pins: {}, // { "笔记路径": 轨道序号 } 拖拽吸附的结果
	orbitView: null, // { scale, ox, oy, w, h } 上次的画幅，用来恢复缩放/平移
	language: 'auto', // auto / zh / en
};

class GraphOrbitPlugin extends Plugin {
	settings = Object.assign({}, DEFAULT_SETTINGS);

	async onload() {
		await this.loadSettings();

		// 改名前叫 graph-orbit-kle-view，清掉旧标签页避免留下空白视图
		try {
			const ws = this.app.workspace;
			if (ws && typeof ws.detachLeavesOfType === 'function') {
				ws.detachLeavesOfType(Views.LEGACY_VIEW_TYPE);
			}
		} catch (e) {
			/* 清理失败不影响使用 */
		}

		this.registerView(Views.VIEW_TYPE, (leaf) => new Views.OrbitView(leaf, this));

		// 不再注册左侧 ribbon 图标：入口统一放在左侧栏顶部的标签里

		this.addCommand({
			id: 'open-graph-view',
			name: Core.STR.commandOpen,
			callback: () => {
				void this.attachView();
			},
		});

		this.addSettingTab(new OrbitSettingTab(this.app, this));

		// 布局就绪后把入口放到左侧栏顶部（并清理历史残留）
		if (this.app.workspace && this.app.workspace.onLayoutReady) {
			this.app.workspace.onLayoutReady(() => this.ensureSidebarLeaf());
		}
	}

	onunload() {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		if (this._solveTimer) clearTimeout(this._solveTimer);
	}

	/**
	 * 打开图谱：已有这个视图就聚焦过去；没有则放进**左侧栏**（像搜索 / 书签那样），
	 * 侧栏收起时会自动展开。
	 */
		/** 加载后确保左侧栏恰好有一个本视图的 leaf：多余的 detach，没有则创建 */
		ensureSidebarLeaf() {
			const workspace = this.app.workspace;
			if (!workspace || !workspace.getLeavesOfType) return;
			const leaves = workspace.getLeavesOfType(Views.VIEW_TYPE) || [];
			if (leaves.length > 1) {
				// 保留第一个（通常是侧栏里的那个），其余关掉
				for (let i = 1; i < leaves.length; i++) {
					const leaf = leaves[i];
					if (leaf && typeof leaf.detach === 'function') leaf.detach();
				}
			}
			if (leaves.length === 0) void this.attachView();
		}
	async attachView() {
		const workspace = this.app.workspace;
		const existing = workspace.getLeavesOfType(Views.VIEW_TYPE);
		if (existing.length > 0) {
			// 再次点击激活键：聚焦并软重载（重建图、重新取景、清筛选）
			workspace.revealLeaf(existing[0]);
			const v = existing[0].view;
			if (v && typeof v.reactivate === 'function') v.reactivate();
			return;
		}

		const leaf = workspace.getLeftLeaf ? workspace.getLeftLeaf(false) : workspace.getLeaf('tab');
		if (!leaf) {
			new Notice(Core.STR.noticeFail);
			return;
		}
		await leaf.setViewState({ type: Views.VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
		if (workspace.leftSplit && workspace.leftSplit.expand) workspace.leftSplit.expand();
	}

	async loadSettings() {
		const data = await this.loadData();
		// colors / pins 是可变对象：必须各自新建，否则会共用 DEFAULT_SETTINGS 里的同一份
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {}, {
			colors: Object.assign({}, (data && data.colors) || {}),
			pins: Object.assign({}, (data && data.pins) || {}),
		});
		if (!this.settings.colors || typeof this.settings.colors !== 'object') {
			this.settings.colors = {};
		}
		// 旧版本的 warm / cool / violet 已不存在，迁移到新默认色系
		if (!Palette.exists(this.settings.scheme)) {
			this.settings.scheme = DEFAULT_SETTINGS.scheme;
			this._schemeMigrated = true;
		}
		// 这两个设置已废弃（轨道改由容量公式 + 拖拽决定），从旧 data.json 里清掉
		delete this.settings.arms;
		delete this.settings.capacity;
		this.settings.spacing = clampNumber(this.settings.spacing, 0.4, 2.5, DEFAULT_SETTINGS.spacing);
		this.settings.spin = clampNumber(this.settings.spin, 0, 2, DEFAULT_SETTINGS.spin);
		this.settings.trail = clampNumber(this.settings.trail, 0, 1, DEFAULT_SETTINGS.trail);
		this.settings.nodeScale = clampNumber(this.settings.nodeScale, 0.6, 2.5, DEFAULT_SETTINGS.nodeScale);
		this.settings.splitRatio = clampNumber(this.settings.splitRatio, 0.25, 0.8, DEFAULT_SETTINGS.splitRatio);
		this.settings.repel = clampNumber(this.settings.repel, 0, 1, DEFAULT_SETTINGS.repel);
		if (!this.settings.pins || typeof this.settings.pins !== 'object') this.settings.pins = {};
		if (!this.settings.orbitView || typeof this.settings.orbitView !== 'object') this.settings.orbitView = null;
		if (['auto', 'zh', 'en'].indexOf(this.settings.language) < 0) this.settings.language = 'auto';
		Core.setLanguage(Core.detectLanguage(this.settings.language));
		if (typeof this.settings.planFolder !== 'string' || !this.settings.planFolder.trim()) {
			this.settings.planFolder = DEFAULT_SETTINGS.planFolder;
		}
		this.settings.planFolder = this.settings.planFolder.replace(/^\/+|\/+$/g, '');
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 改完设置后统一出口。
	 * kind: 'solve' 需要重算布局 / 'color' 只需重算颜色 / 'none' 每帧自然生效
	 */
	applySettings(kind) {
		this.scheduleSave();
		this.broadcast(kind);
	}

	/** 设置落盘做去抖：拖动滑块时不要每次都写 data.json */
	scheduleSave() {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null;
			void this.saveSettings();
		}, 400);
	}

	/** 重算布局相对较重，连续拖动滑块时按 80ms 节流 */
	broadcast(kind) {
		if (kind !== 'solve') {
			this.broadcastNow(kind);
			return;
		}
		const now = Date.now();
		if (!this._lastSolveAt || now - this._lastSolveAt > 80) {
			this._lastSolveAt = now;
			this.broadcastNow('solve');
			return;
		}
		if (this._solveTimer) return;
		this._solveTimer = setTimeout(() => {
			this._solveTimer = null;
			this._lastSolveAt = Date.now();
			this.broadcastNow('solve');
		}, 80);
	}

	broadcastNow(kind) {
		for (const leaf of this.app.workspace.getLeavesOfType(Views.VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof Views.OrbitView) view.onSettingsChanged(kind);
		}
	}
}

function clampNumber(value, lo, hi, fallback) {
	const n = Number(value);
	if (!isFinite(n)) return fallback;
	return n < lo ? lo : n > hi ? hi : n;
}

// ----------------------------------------------------------------------------
// 设置页（全部中文；设置页顶部不加插件名标题，符合 Obsidian 的界面规范）
// ----------------------------------------------------------------------------
class OrbitSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		const s = this.plugin.settings;

		// 语言：跟随系统 / 中文 / English
		new Setting(containerEl)
			.setName(Core.STR.setLanguage)
			.setDesc(Core.STR.setLanguageDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ auto: Core.STR.languageAuto, zh: Core.STR.languageZh, en: Core.STR.languageEn })
					.setValue(s.language || 'auto')
					.onChange((value) => {
						s.language = value;
						Core.setLanguage(Core.detectLanguage(value));
						this.plugin.applySettings('all');
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setScheme)
			.setDesc(Core.STR.setSchemeDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(Palette.options())
					.setValue(s.scheme)
					.onChange((value) => {
						s.scheme = value;
						this.plugin.applySettings('color');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setSpacing)
			.setDesc(Core.STR.setSpacingDesc)
			.addSlider((slider) =>
				slider
					.setLimits(0.4, 2.5, 0.1)
					.setValue(s.spacing)
					.setDynamicTooltip()
					.onChange((value) => {
						s.spacing = value;
						this.plugin.applySettings('solve');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setSpin)
			.setDesc(Core.STR.setSpinDesc)
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(s.spin)
					.setDynamicTooltip()
					.onChange((value) => {
						s.spin = value;
						this.plugin.applySettings('none');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setTrail)
			.setDesc(Core.STR.setTrailDesc)
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(s.trail)
					.setDynamicTooltip()
					.onChange((value) => {
						s.trail = value;
						this.plugin.applySettings('none');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setNodeScale)
			.setDesc(Core.STR.setNodeScaleDesc)
			.addSlider((slider) =>
				slider
					.setLimits(0.6, 2.5, 0.1)
					.setValue(s.nodeScale)
					.setDynamicTooltip()
					.onChange((value) => {
						s.nodeScale = value;
						this.plugin.applySettings('none');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setRepel)
			.setDesc(Core.STR.setRepelDesc)
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(s.repel)
					.setDynamicTooltip()
					.onChange((value) => {
						s.repel = value;
						this.plugin.applySettings('none');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setClearPins)
			.setDesc(Core.STR.setClearPinsDesc + '（当前 ' + Object.keys(s.pins || {}).length + ' 个）')
			.addButton((button) =>
				button.setButtonText(Core.STR.setClearPinsBtn).onClick(() => {
					s.pins = {};
					this.plugin.applySettings('solve');
					new Notice(Core.STR.noticePinsCleared);
					this.display();
				})
			);

		const colorCount = Object.keys(s.colors || {}).length;

		new Setting(containerEl)
			.setName(Core.STR.setPlanFolder)
			.setDesc(Core.STR.setPlanFolderDesc)
			.addText((text) =>
				text
					.setPlaceholder('orbit-plan')
					.setValue(s.planFolder)
					.onChange((value) => {
						s.planFolder = String(value || '').trim().replace(/^\/+|\/+$/g, '') || 'orbit-plan';
						this.plugin.applySettings('plan');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setSplit)
			.setDesc(Core.STR.setSplitDesc)
			.addSlider((slider) =>
				slider
					.setLimits(25, 80, 5)
					.setValue(Math.round(s.splitRatio * 100))
					.setDynamicTooltip()
					.onChange((value) => {
						s.splitRatio = value / 100;
						this.plugin.applySettings('split');
					})
			);

		new Setting(containerEl)
			.setName(Core.STR.setColors)
			.setDesc(Core.STR.setColorsDesc + '（当前 ' + colorCount + ' 个节点单独设色）')
			.addButton((button) =>
				button
					.setButtonText(Core.STR.setClearColors)
					.setWarning()
					.onClick(async () => {
						s.colors = {};
						this.plugin.applySettings('color');
						new Notice(Core.STR.noticeCleared);
						this.display();
					})
			);
	}
}

module.exports = GraphOrbitPlugin;
