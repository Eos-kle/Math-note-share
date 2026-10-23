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
