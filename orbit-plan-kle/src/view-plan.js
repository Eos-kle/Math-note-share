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
