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
