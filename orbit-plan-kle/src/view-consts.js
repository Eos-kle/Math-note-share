// ============================================================================
// view-consts.js — 视图层的模块级常量（split 出来的 mixin 与 view.js 共用）
// ============================================================================
const ViewConsts = (function () {
	const BASE_SPIN = 0.34; // rad/s，spin=1 时约 19°/秒
	const LAG_TAU = 0.16; // 解冻后「追上」的时间常数，约 0.5 秒归位
	const HIT_COOLDOWN = 3; // PDF 彗星撞击同一颗球的冷却（秒）
	const FILL_COOLDOWN = 2; // 空轨补位后该球的冷却（秒），避免来回拉锯
	const PROMOTE_THROTTLE = 0.2; // 贴近升轨的最小间隔（秒）
	const SAT_SIZE_RATIO = 0.15; // 卫星半径 = 宿主半径 × 0.15
	const SAT_TURNS = 10; // 宿主转 1 圈，卫星转 10 圈
	const AVOID_ANGLE = 0.35; // 星带避让：与分针球角度差小于 20° 就让位
	const AVOID_SHIFT = 0.12; // 星带避让：最多沿径向让开 12%
	const COMET_TRAIL_SEC = 1.8; // 彗星拖尾的时间窗口（秒，再乘「轨迹长度」）
	const PROMOTE_FACTOR = 2; // 「过近」的判定：(r₁+r₂) × 2（斥力分离阈值为 1.7 倍）
	return { BASE_SPIN, LAG_TAU, HIT_COOLDOWN, FILL_COOLDOWN, PROMOTE_THROTTLE, SAT_SIZE_RATIO, SAT_TURNS, AVOID_ANGLE, AVOID_SHIFT, COMET_TRAIL_SEC, PROMOTE_FACTOR };
})();
const { BASE_SPIN, LAG_TAU, HIT_COOLDOWN, FILL_COOLDOWN, PROMOTE_THROTTLE, SAT_SIZE_RATIO, SAT_TURNS, AVOID_ANGLE, AVOID_SHIFT, COMET_TRAIL_SEC, PROMOTE_FACTOR } = ViewConsts;
