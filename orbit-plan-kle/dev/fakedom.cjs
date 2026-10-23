// ============================================================================
// dev/fakedom.cjs — 极简假 DOM / Canvas
//
// 目的：让 view.js 的 onOpen → tick → paint → renderer.draw 整条链在 Node 里
// 真跑一遍，从而抓住「渲染代码里的运行时错误」（拼错方法、读 undefined 等）。
// 它不检验视觉效果，也不模拟 Obsidian 的布局行为。
// ============================================================================

function makeCtx(records) {
	const noop = () => {};
	let fontValue = '12px sans-serif';
	const ctx = {
		// 状态
		lineCap: 'butt',
		lineJoin: 'miter',
		strokeStyle: '#000',
		fillStyle: '#000',
		lineWidth: 1,
		textAlign: 'start',
		textBaseline: 'alphabetic',
		globalAlpha: 1,
		// 绘制
		setTransform: noop,
		clearRect: () => {
			records.clears++;
		},
		save: noop,
		restore: noop,
		beginPath: noop,
		closePath: noop,
		moveTo: noop,
		lineTo: noop,
		arc: (x, y, r, a0, a1) => {
			records.arcs++;
			if (!records.arcArgs) records.arcArgs = [];
			records.arcArgs.push({ x, y, r, a0, a1 });
		},
		rect: () => {
			records.rects++;
		},
		setLineDash: (d) => {
			records.dashes = (records.dashes || 0) + 1;
		},
		ellipse: () => {
			records.ellipses++;
		},
		fill: () => {
			records.fills++;
			if (!records.log) records.log = [];
			records.log.push('fill');
		},
		stroke: () => {
			records.strokes++;
			if (!records.log) records.log = [];
			records.log.push('stroke:' + String(ctx.strokeStyle));
		},
		fillRect: noop,
		fillText: (text) => {
			records.texts.push(String(text));
		},
		measureText: (t) => ({ width: String(t).length * 7 }),
		createLinearGradient: () => ({ addColorStop: noop }),
		createRadialGradient: () => ({ addColorStop: noop }),
	};
	Object.defineProperty(ctx, 'font', {
		get: () => fontValue,
		set: (v) => {
			fontValue = String(v);
			if (!records.fonts) records.fonts = [];
			records.fonts.push(fontValue);
		},
	});
	return ctx;
}

class FakeElement {
	constructor(tag) {
		this.tagName = String(tag || 'div').toUpperCase();
		this.children = [];
		this.style = {
			vars: {},
			setProperty(name, value) {
				this.vars[name] = String(value);
			},
			getPropertyValue(name) {
				return this.vars[name] || '';
			},
		};
		this.attrs = {};
		this.classes = new Set();
		this.textContent = '';
		this.isConnected = true;
		this.offsetWidth = 800;
		this.offsetHeight = 600;
		this.width = 800;
		this.height = 600;
		this._listeners = [];
		// 滚动条行为：像浏览器一样夹取 scrollTop（空元素设不了滚动位置）
		let scrollTopValue = 0;
		const countAll = (el) => {
			let n = 0;
			for (const c of el.children) n += 1 + countAll(c);
			return n;
		};
		Object.defineProperty(this, 'scrollHeight', {
			get: () => countAll(this) * 24,
			configurable: true,
		});
		Object.defineProperty(this, 'clientHeight', {
			get: () => 200,
			configurable: true,
		});
		Object.defineProperty(this, 'scrollTop', {
			get: () => scrollTopValue,
			set: (v) => {
				const max = Math.max(0, countAll(this) * 24 - 200);
				scrollTopValue = Math.max(0, Math.min(Number(v) || 0, max));
			},
			configurable: true,
		});
		const self = this;
		this.classList = {
			add: (...c) => c.forEach((x) => self.classes.add(x)),
			remove: (...c) => c.forEach((x) => self.classes.delete(x)),
			contains: (c) => self.classes.has(c),
			toggle: (c) => {
				if (self.classes.has(c)) {
					self.classes.delete(c);
					return false;
				}
				self.classes.add(c);
				return true;
			},
		};
	}

	getContext() {
		if (!this._ctx) {
			this._records = { clears: 0, arcs: 0, rects: 0, fills: 0, strokes: 0, ellipses: 0, texts: [] };
			this._ctx = makeCtx(this._records);
		}
		return this._ctx;
	}

	getBoundingClientRect() {
		return { left: 0, top: 0, right: this.offsetWidth, bottom: this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
	}

	setAttribute(k, v) {
		this.attrs[k] = v;
	}
	getAttribute(k) {
		return this.attrs[k];
	}
	remove() {
		if (this.parent) {
			this.parent.removeChild(this);
			this.parent = null;
		}
		this.isConnected = false;
	}
	appendChild(el) {
		el.parent = this;
		this.children.push(el);
		return el;
	}
	removeChild(el) {
		const i = this.children.indexOf(el);
		if (i >= 0) this.children.splice(i, 1);
		return el;
	}
	addEventListener(type, cb) {
		this._listeners.push({ type, cb });
	}
	fire(type, ev) {
		for (const l of this._listeners) {
			if (l.type === type) l.cb(ev || { preventDefault() {} });
		}
	}
	removeEventListener() {}
	addClass(c) {
		this.classes.add(c);
	}
	removeClass(c) {
		this.classes.delete(c);
	}
	toggleClass(c, on) {
		if (on === undefined) {
			if (this.classes.has(c)) this.classes.delete(c);
			else this.classes.add(c);
			return;
		}
		if (on) this.classes.add(c);
		else this.classes.delete(c);
	}
	setText(t) {
		this.textContent = String(t);
	}
	empty() {
		this.children.length = 0;
		return this;
	}
	createDiv(info) {
		const el = this.createEl('div');
		if (info && info.cls) String(info.cls).split(/\s+/).forEach((c) => el.classes.add(c));
		if (info && info.text !== undefined) el.setText(info.text);
		return el;
	}
	createSpan(info) {
		const el = this.createEl('span');
		if (info && info.cls) String(info.cls).split(/\s+/).forEach((c) => el.classes.add(c));
		if (info && info.text !== undefined) el.setText(info.text);
		return el;
	}
	createEl(tag, info) {
		const el = new FakeElement(tag);
		if (info && info.cls) String(info.cls).split(/\s+/).forEach((c) => el.classes.add(c));
		if (info && info.text !== undefined) el.setText(info.text);
		this.children.push(el);
		el.parent = this;
		return el;
	}
	querySelector() {
		return null;
	}
}

function installFakeDom() {
	const rafQueue = [];
	const win = {
		devicePixelRatio: 2,
		innerWidth: 1200,
		innerHeight: 800,
		requestAnimationFrame: (cb) => {
			rafQueue.push(cb);
			return rafQueue.length;
		},
		cancelAnimationFrame: () => {},
		setTimeout: (fn) => setTimeout(fn, 0),
		clearTimeout: (id) => clearTimeout(id),
		addEventListener: () => {},
		removeEventListener: () => {},
		getComputedStyle: () => ({ color: 'rgb(20, 20, 20)' }),
	};
	const doc = {
		createElement: (tag) => new FakeElement(tag),
		body: new FakeElement('body'),
	};

	globalThis.window = win;
	globalThis.document = doc;
	globalThis.getComputedStyle = win.getComputedStyle;
	globalThis.ResizeObserver = class {
		observe() {}
		disconnect() {}
	};

	return { win, doc, rafQueue };
}

module.exports = { installFakeDom, FakeElement };
