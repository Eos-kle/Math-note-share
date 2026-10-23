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
