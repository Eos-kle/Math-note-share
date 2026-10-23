// ============================================================================
// dev/obsidian-stub.cjs — 最小 obsidian 模块桩
//
// 仅用于 Node 里的冒烟测试：验证 main.js 的 API 调用点没写错、设置页能构造。
// 不做任何真实行为模拟（不渲染、不存盘），因此它证明不了「在 Obsidian 里完美」，
// 只能证明「调用的方法和字段名是对的」。
// ============================================================================

class Component {
	constructor() {
		this._registered = [];
	}
	registerEvent(e) {
		this._registered.push(e);
		return e;
	}
	registerInterval(id) {
		return id;
	}
	registerDomEvent() {
		return () => {};
	}
	register(cb) {
		this._registered.push(cb);
		return cb;
	}
	addChild(c) {
		return c;
	}
	removeChild(c) {
		return c;
	}
	load() {}
	unload() {}
	onload() {}
	onunload() {}
}

class Plugin extends Component {
	constructor(app, manifest) {
		super();
		this.app = app || { vault: {}, metadataCache: {}, workspace: {} };
		this.manifest = manifest || { id: 'stub', name: 'Stub' };
		this._data = null;
		this.views = [];
		this.commands = [];
		this.ribbon = [];
		this.settingTabs = [];
	}
	async loadData() {
		return this._data;
	}
	async saveData(d) {
		this._data = d;
	}
	registerView(type, factory) {
		this.views.push({ type, factory });
	}
	addRibbonIcon(icon, title, cb) {
		this.ribbon.push({ icon, title, cb });
		return { addClass() {} };
	}
	addCommand(cmd) {
		this.commands.push(cmd);
		return cmd;
	}
	addSettingTab(tab) {
		this.settingTabs.push(tab);
	}
	addStatusBarItem() {
		return { setText() {} };
	}
}

// 极简元素工厂：测试里装了假 DOM 就用它，否则给个够用的空实现
function makeEl() {
	if (typeof document !== 'undefined' && document.createElement) {
		return document.createElement('div');
	}
	const el = {
		empty() {},
		classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
		setText() {},
		setAttribute() {},
		addEventListener() {},
		removeEventListener() {},
		createEl() {
			return makeEl();
		},
		createDiv() {
			return makeEl();
		},
		createSpan() {
			return makeEl();
		},
	};
	return el;
}

class ItemView extends Component {
	constructor(leaf) {
		super();
		this.leaf = leaf || {};
		this.app = this.leaf.app || {};
		this.containerEl = makeEl();
		this.contentEl = makeEl();
	}
	getViewType() {
		return 'stub';
	}
	getDisplayText() {
		return 'stub';
	}
	getIcon() {
		return 'stub';
	}
	async onOpen() {}
	async onClose() {}
}

class WorkspaceLeaf {}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = makeEl();
	}
	display() {}
	hide() {}
}

class Setting {
	constructor() {}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	setHeading() {
		return this;
	}
	setClass() {
		return this;
	}
	addDropdown(cb) {
		cb(new DropdownStub());
		return this;
	}
	addSlider(cb) {
		cb(new SliderStub());
		return this;
	}
	addButton(cb) {
		cb(new ButtonStub());
		return this;
	}
	addText(cb) {
		cb({ setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } });
		return this;
	}
	addToggle(cb) {
		cb({ setValue() { return this; }, onChange() { return this; } });
		return this;
	}
}

class DropdownStub {
	addOption() {
		return this;
	}
	addOptions() {
		return this;
	}
	setValue() {
		return this;
	}
	onChange() {
		return this;
	}
}

class SliderStub {
	setLimits() {
		return this;
	}
	setValue() {
		return this;
	}
	setDynamicTooltip() {
		return this;
	}
	onChange() {
		return this;
	}
}

class ButtonStub {
	setButtonText() {
		return this;
	}
	setWarning() {
		return this;
	}
	setIcon() {
		return this;
	}
	onClick() {
		return this;
	}
}

class Notice {
	constructor(message) {
		this.message = message;
		Notice.last = message;
	}
}

class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = makeEl();
		this.titleEl = makeEl();
		Modal.last = this;
	}
	open() {
		Modal.last = this;
		this.onOpen();
	}
	close() {
		this.onClose();
	}
	onOpen() {}
	onClose() {}
}
Modal.last = null;

class MenuItem {
	constructor() {
		this.title = '';
		this.icon = '';
		this.click = null;
	}
	setTitle(t) {
		this.title = t;
		return this;
	}
	setIcon(i) {
		this.icon = i;
		return this;
	}
	onClick(fn) {
		this.click = fn;
		return this;
	}
}

class Menu {
	constructor() {
		this.items = [];
		Menu.last = this;
	}
	addItem(fn) {
		const item = new MenuItem();
		fn(item);
		this.items.push(item);
		return this;
	}
	showAtPosition() {}
	showAtMouseEvent() {}
}
Menu.last = null;
class TFile {}

class MarkdownView extends ItemView {}

function debounce(fn) {
	const wrapped = function (...args) {
		return fn.apply(this, args);
	};
	wrapped.cancel = () => {};
	return wrapped;
}

function setIcon() {}
function normalizePath(p) {
	return p;
}

module.exports = {
	Component,
	Plugin,
	ItemView,
	WorkspaceLeaf,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
	TFile,
	MarkdownView,
	debounce,
	setIcon,
	Menu,
	normalizePath,
};
