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
