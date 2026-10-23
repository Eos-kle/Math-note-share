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
