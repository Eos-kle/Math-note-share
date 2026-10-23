// ============================================================================
// renderer.js — Canvas 2D 渲染（单色星图：点 + 弧线尾迹 + 极淡连线）
//
// 全部在「屏幕像素」空间绘制（手动投影），线宽恒定，缩放不糊。
// 背景透明交给 CSS 变量；颜色统一取 canvas 的计算样式 color（跟随主题），
// 只靠透明度区分层次，不再有调色板与文字标签。
// ============================================================================
const Render = (function () {
	const MIN_SCREEN_RADIUS = 2.2; // 球体在屏幕上的最小半径
	const SAT_MIN_SCREEN_RADIUS = 1.5; // 标签卫星的最小屏幕半径（更小，便于体现大小差异）
	const SAT_FADE_FROM = 0.9; // 低于此缩放：卫星完全不可见
	const SAT_FADE_TO = 1.3; // 高于此缩放：卫星完全可见
	const TRAIL_SPAN = 0.75; // 轨迹最长弧度（再乘设置里的「轨迹长度」）
	// canvas 的 ctx.font 不认 CSS 变量，必须给具体字体族（中文楷体、西文 Times New Roman）
	const CLOCK_FONT = '"Times New Roman", "KaiTi", "STKaiti", "楷体", serif';
	class Renderer {
		constructor(canvas) {
			this.canvas = canvas;
			this.ctx = canvas.getContext('2d');
			this.dpr = 0;
			this.w = 0;
			this.h = 0;
			this.fg = null;
		}

		resize() {
			const rect = this.canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const w = Math.max(1, Math.round(rect.width));
			const h = Math.max(1, Math.round(rect.height));
			if (w === this.w && h === this.h && dpr === this.dpr) return;
			this.dpr = dpr;
			this.w = w;
			this.h = h;
			this.canvas.width = Math.round(w * dpr);
			this.canvas.height = Math.round(h * dpr);
			this.fg = null;
		}

		foreground() {
			if (this.fg) return this.fg;
			let color = 'rgb(140,140,140)';
			try {
				color = window.getComputedStyle(this.canvas).color || color;
			} catch (e) {
				/* 取不到就用默认灰 */
			}
			this.fg = Core.parseCssColor(color);
			return this.fg;
		}

		projectX(x, model) {
			return (x - model.ox) * model.scale + this.w / 2;
		}

		projectY(y, model) {
			return (y - model.oy) * model.scale + this.h / 2;
		}

		screenToWorld(sx, sy, model) {
			return {
				x: (sx - this.w / 2) / model.scale + model.ox,
				y: (sy - this.h / 2) / model.scale + model.oy,
			};
		}

		begin() {
			const ctx = this.ctx;
			ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			ctx.clearRect(0, 0, this.w, this.h);
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			return ctx;
		}

		drawMessage(title, sub) {
			const ctx = this.begin();
			const fg = this.foreground();
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.font = '600 16px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.fillStyle = Core.rgba(fg, 0.78);
			ctx.fillText(title, this.w / 2, this.h / 2 - 12);
			if (sub) {
				ctx.font = '400 13px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
				ctx.fillStyle = Core.rgba(fg, 0.5);
				ctx.fillText(sub, this.w / 2, this.h / 2 + 16);
			}
		}

		draw(model) {
			const ctx = this.begin();
			const n = model.n;
			if (!n) return;

			const fg = this.foreground();
			const s = model.scale;
			const ox = this.oxScreen(model);
			const oy = this.oyScreen(model);

			const margin = 80 / s;
			const halfW = this.w / 2 / s;
			const halfH = this.h / 2 / s;
			const left = model.ox - halfW - margin;
			const right = model.ox + halfW + margin;
			const top = model.oy - halfH - margin;
			const bottom = model.oy + halfH + margin;
			const inside = (x, y) => x >= left && x <= right && y >= top && y <= bottom;

			const xs = model.xs;
			const ys = model.ys;
			const rads = model.rads;
			const kinds = model.kinds;

			// ---------- 连线：默认不画，只在悬停时画该球的关联连线（每对一根） ----------
			const hoverIdx = model.hover;
			const hoverLinks = model.hoverLinks;
			if (hoverIdx !== undefined && hoverIdx >= 0 && hoverLinks && hoverLinks.length) {
				const warm = model.linkWarm ? Core.hexToRgb(model.linkWarm) : fg;
				const cool = model.linkCool ? Core.hexToRgb(model.linkCool) : fg;
				const outFlags = model.linkOut;
				const t = model.clock || 0;
				const hx0 = this.projectX(xs[hoverIdx], model);
				const hy0 = this.projectY(ys[hoverIdx], model);

				for (let k = 0; k < hoverLinks.length; k++) {
					const j = hoverLinks[k];
					const isOut = !outFlags || outFlags[j] === 1;
					const x1 = this.projectX(xs[j], model);
					const y1 = this.projectY(ys[j], model);

					// 单线 + 双色渐变：靠悬停球一侧暖（出链）/冷（入链）
					const grad = ctx.createLinearGradient(hx0, hy0, x1, y1);
					if (isOut) {
						grad.addColorStop(0, Core.rgba(warm, 0.55));
						grad.addColorStop(1, Core.rgba(cool, 0.3));
					} else {
						grad.addColorStop(0, Core.rgba(cool, 0.55));
						grad.addColorStop(1, Core.rgba(warm, 0.3));
					}
					ctx.strokeStyle = grad;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(hx0, hy0);
					ctx.lineTo(x1, y1);
					ctx.stroke();

					// 流光：出链从悬停球向外、入链向内
					for (let d = 0; d < 2; d++) {
						let f = (t * 0.35 + d * 0.5 + k * 0.17) % 1;
						if (f < 0) f += 1;
						const frac = isOut ? f : 1 - f;
						const px = hx0 + (x1 - hx0) * frac;
						const py = hy0 + (y1 - hy0) * frac;
						const col = isOut ? warm : cool;
						ctx.fillStyle = Core.rgba(col, 0.85);
						ctx.beginPath();
						ctx.arc(px, py, 1.7, 0, Core.TAU);
						ctx.fill();
					}
				}
			}

			// ---------- 彗星尾迹：沿椭圆采样的渐隐折线 ----------
			const cometMask = model.cometMask;
			const cometTrails = model.cometTrails;
			if (cometTrails && cometTrails.length) {
				ctx.lineWidth = 1.2;
				for (let c = 0; c < cometTrails.length; c++) {
					const pts = cometTrails[c].pts;
					for (let k = pts.length - 1; k > 0; k--) {
						const alpha = 0.26 * (1 - (k - 1) / pts.length);
						ctx.strokeStyle = Core.rgba(fg, alpha);
						ctx.beginPath();
						ctx.moveTo(this.projectX(pts[k][0], model), this.projectY(pts[k][1], model));
						ctx.lineTo(this.projectX(pts[k - 1][0], model), this.projectY(pts[k - 1][1], model));
						ctx.stroke();
					}
				}
			}

			// ---------- 尾迹：沿各自圆轨道的一段淡弧（方向跟随该球的转动方向）----------
			const trail = Core.clamp(model.trail || 0, 0, 1);
			if (trail > 0.01) {
				const dirs = model.dirs;
				ctx.lineWidth = 1;
				const span = TRAIL_SPAN * trail;
				for (let i = 0; i < n; i++) {
					if (cometMask && cometMask[i]) continue; // 彗星用上面的折线
					const x = xs[i];
					const y = ys[i];
					if (!inside(x, y)) continue;
					const r = Math.hypot(x, y);
					if (r * s < 6) continue; // 太靠近中心就不画，避免糊成一团
					const headAng = Math.atan2(y, x);
					// 倒计时期间时间球在逆时针扫动 → 尾巴要画在反侧
					const isClockDown = model.clockDown && model.clockHands && model.clockHands[i];
					const dir = isClockDown ? -1 : dirs && dirs[i] < 0 ? -1 : 1;
					const tailAng = headAng - span * dir; // dir=−1 时尾迹在另一侧
					const a0 = Math.min(tailAng, headAng);
					const a1 = Math.max(tailAng, headAng);

					const hx = this.projectX(x, model);
					const hy = this.projectY(y, model);
					const tx = this.projectX(Math.cos(tailAng) * r, model);
					const ty = this.projectY(Math.sin(tailAng) * r, model);

					const grad = ctx.createLinearGradient(tx, ty, hx, hy);
					grad.addColorStop(0, Core.rgba(fg, 0));
					grad.addColorStop(1, Core.rgba(fg, 0.18));
					ctx.strokeStyle = grad;
					ctx.beginPath();
					ctx.arc(ox, oy, r * s, a0, a1);
					ctx.stroke();
				}
			}

			// ---------- 球体：全部圆形，颜色来自色系或单节点自定义 ----------
			const colors = model.colors;
			for (let i = 0; i < n; i++) {
				const x = xs[i];
				const y = ys[i];
				if (!inside(x, y)) continue;
				const sx = this.projectX(x, model);
				const sy = this.projectY(y, model);
				const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);

				const base = colors && colors[i] ? Core.hexToRgb(colors[i]) : fg;
				const isCenter = kinds[i] === 2;
				let alpha = isCenter ? 0.95 : kinds[i] === 1 ? 0.72 : 0.86;
				const hits = model.searchHits;
				if (hits) alpha = hits[i] ? Math.min(1, alpha + 0.1) : alpha * 0.35;
				ctx.fillStyle = Core.rgba(base, alpha);
				ctx.beginPath();
				ctx.arc(sx, sy, rr, 0, Core.TAU);
				ctx.fill();

				if (kinds[i] === 1) {
					// PDF：加一道很细的描边作为识别，形状仍是圆
					ctx.strokeStyle = Core.rgba(base, 0.6);
					ctx.lineWidth = 1.2;
					ctx.beginPath();
					ctx.arc(sx, sy, rr + 2.2, 0, Core.TAU);
					ctx.stroke();
				}
			}

			// ---------- 搜索命中：显示名称 + 细环 ----------
			const searchHits = model.searchHits;
			if (searchHits) {
				for (let i = 0; i < n; i++) {
					if (!searchHits[i]) continue;
					if (!inside(xs[i], ys[i])) continue;
					const sx = this.projectX(xs[i], model);
					const sy = this.projectY(ys[i], model);
					const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);
					const base = colors && colors[i] ? Core.hexToRgb(colors[i]) : fg;
					ctx.save();
					ctx.strokeStyle = Core.rgba(base, 0.9);
					ctx.lineWidth = 1.4;
					ctx.beginPath();
					ctx.arc(sx, sy, rr + 3.5, 0, Core.TAU);
					ctx.stroke();
					ctx.restore();
					this.drawNodeLabel(model, i, fg, 0.95);
				}
			}

			// ---------- M1：悬停球的轨道轮廓 ----------
			const outline = model.hoverOrbit;
			if (outline) {
				ctx.save();
				ctx.strokeStyle = Core.rgba(fg, 0.18);
				ctx.lineWidth = 1;
				ctx.setLineDash([4, 4]);
				const cx0 = this.projectX(0, model);
				const cy0 = this.projectY(0, model);
				ctx.beginPath();
				if (outline.circle) {
					ctx.arc(cx0, cy0, Math.max(1, outline.r * s), 0, Core.TAU);
				} else {
					const a = outline.a * s;
					const b = outline.b * s;
					const focusOffset = outline.a * outline.e * s;
					if (a > 0.5 && b > 0.5) ctx.ellipse(cx0 + focusOffset, cy0, a, b, 0, 0, Core.TAU);
				}
				ctx.stroke();
				ctx.restore();
			}
			// ---------- 标签卫星：绕宿主的小圆点，悬停宿主时显示标签名 ----------
			const satellites = model.satellites;
			const satAlpha = Core.clamp((s - SAT_FADE_FROM) / (SAT_FADE_TO - SAT_FADE_FROM), 0, 1);
			model.satAlpha = satAlpha;
			if (satellites && satellites.length && satAlpha > 0.01) {
				for (let k = 0; k < satellites.length; k++) {
					const sat = satellites[k];
					if (!inside(sat.x, sat.y)) continue;
					const sx = this.projectX(sat.x, model);
					const sy = this.projectY(sat.y, model);
					const rr = sat.r * s;
					if (rr < 0.35) continue;
					const col = sat.color ? Core.hexToRgb(sat.color) : fg;
					ctx.fillStyle = Core.rgba(col, 0.8 * satAlpha);
					ctx.beginPath();
					ctx.arc(sx, sy, rr, 0, Core.TAU);
					ctx.fill();
				}

				// 悬停宿主 → 把它的标签名画在卫星旁
				const hv = model.hover;
				if (hv !== undefined && hv >= 0 && satAlpha > 0.99) {
					ctx.font = '10px var(--font-interface, sans-serif)';
					ctx.fillStyle = Core.rgba(fg, 0.75 * satAlpha);
					for (let k = 0; k < satellites.length; k++) {
						const sat = satellites[k];
						if (sat.host !== hv) continue;
						if (!inside(sat.x, sat.y)) continue;
						const sx = this.projectX(sat.x, model);
						const sy = this.projectY(sat.y, model);
						ctx.fillText(sat.tag, sx + sat.r * s + 3, sy + 3);
					}
				}
			}

			// ---------- M8：键盘焦点环 / M4：命中标签的提示字 ----------
			const focusIdx = model.focus;
			if (focusIdx !== undefined && focusIdx >= 0 && focusIdx < n) {
				const fx = this.projectX(xs[focusIdx], model);
				const fy = this.projectY(ys[focusIdx], model);
				ctx.save();
				ctx.strokeStyle = Core.rgba(fg, 0.75);
				ctx.lineWidth = 1.6;
				ctx.setLineDash([3, 3]);
				ctx.beginPath();
				ctx.arc(fx, fy, Math.max(rads[focusIdx] * s, MIN_SCREEN_RADIUS) + 5, 0, Core.TAU);
				ctx.stroke();
				ctx.restore();
				// 键盘焦点也显示名称（与悬停是同一颗时只画一次）
				if (focusIdx !== model.hover) this.drawNodeLabel(model, focusIdx, fg, 0.85);
			}
			const clockText = model.clockText;
			if (clockText) {
				const centerIdx = model.center;
				const centerColor = colors && centerIdx >= 0 && colors[centerIdx] ? colors[centerIdx] : null;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				for (let i = 0; i < n; i++) {
					const text = clockText[i];
					if (!text) continue;
					if (!inside(xs[i], ys[i])) continue;
					const sx = this.projectX(xs[i], model);
					const sy = this.projectY(ys[i], model);
					const rr = Math.max(rads[i] * s, MIN_SCREEN_RADIUS);
					// 字号跟着球的屏幕尺寸走（canvas 不认 CSS 变量，必须给具体字体族）
					const px = Math.min(rr * 1.15, Math.max(7, rr * 1.05));
					ctx.font = '600 ' + px.toFixed(1) + 'px ' + CLOCK_FONT;
					ctx.fillStyle = centerColor || Core.rgba(fg, 0.95);
					ctx.fillText(text, sx, sy + 0.5);
				}
				ctx.textAlign = 'start';
				ctx.textBaseline = 'alphabetic';
			}

			// ---------- 悬停：细高亮环 + 只给这一个节点显示名称 ----------
			const hover = model.hover;
			if (hover !== undefined && hover >= 0 && hover < n) {
				const sx = this.projectX(xs[hover], model);
				const sy = this.projectY(ys[hover], model);
				const rr = Math.max(rads[hover] * s, MIN_SCREEN_RADIUS);
				const base = colors && colors[hover] ? Core.hexToRgb(colors[hover]) : fg;

				ctx.strokeStyle = Core.rgba(base, 0.8);
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.arc(sx, sy, rr + 3.5, 0, Core.TAU);
				ctx.stroke();

				this.drawNodeLabel(model, hover, fg, 0.92);
			}

			// 倒计时到点：整幅画布叠一层 accent 色呼吸
			if (model.breathing) {
				const col = model.accentColor ? Core.hexToRgb(model.accentColor) : fg;
				const phase = 0.5 + 0.5 * Math.sin((model.breathT || 0) * Math.PI);
				ctx.fillStyle = Core.rgba(col, 0.05 + 0.1 * phase);
				ctx.fillRect(0, 0, this.w, this.h);
			}
			this.drawPausedHint(model, fg);
		}

		/** 在球上方（或下方）画名称，含画布边缘避让 */
		drawNodeLabel(model, i, fg, alpha) {
			if (i === undefined || i < 0) return;
			const text = model.labels && model.labels[i];
			if (!text) return;
			const ctx = this.ctx;
			const s = model.scale;
			const rr = Math.max((model.rads[i] || 0) * s, MIN_SCREEN_RADIUS);
			const sx = this.projectX(model.xs[i], model);
			const sy = this.projectY(model.ys[i], model);

			ctx.font = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			const half = Math.min(ctx.measureText(String(text)).width / 2 + 6, this.w / 2 - 4);
			const tx = Core.clamp(sx, half, this.w - half);
			let ty = sy - rr - 8;
			if (ty < 16) {
				ty = sy + rr + 22;
				ctx.textBaseline = 'top';
			}
			ctx.fillStyle = Core.rgba(fg, alpha);
			ctx.fillText(String(text), tx, ty);
		}
		oxScreen(model) {
			return this.projectX(0, model);
		}

		oyScreen(model) {
			return this.projectY(0, model);
		}

		drawPausedHint(model, fg) {
			if (!model.paused) return;
			const ctx = this.ctx;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'bottom';
			ctx.font = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
			ctx.fillStyle = Core.rgba(fg, 0.55);
			ctx.fillText(Core.STR.pausedHint, 14, this.h - 12);
		}
	}

	return { Renderer };
})();
