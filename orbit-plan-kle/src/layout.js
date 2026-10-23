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
