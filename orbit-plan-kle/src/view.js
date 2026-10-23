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
