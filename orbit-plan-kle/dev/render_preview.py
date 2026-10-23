# ============================================================================
# dev/render_preview.py — 把 preview.json 画成 PNG，用于和参考图对照
#
#   python dev/render_preview.py
#
# 只做"形状"对照：单色点 + 淡弧尾迹 + 极淡连线，和插件里的绘制规则一致。
# ============================================================================
import json
import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(HERE, 'preview.json')
OUT_PATH = os.path.join(HERE, 'preview.png')

W, H = 900, 620
BG = (255, 255, 255)
FG = (60, 60, 60)
TRAIL_SPAN = 1.1  # 必须与 renderer.js 的 TRAIL_SPAN 一致


def rgba(alpha):
    return (FG[0], FG[1], FG[2], int(round(alpha * 255)))


def hex_rgb(h):
    h = str(h or '').lstrip('#')
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return FG


def tint(color, alpha):
    r, g, b = hex_rgb(color)
    return (r, g, b, int(round(alpha * 255)))


def main():
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    max_r = max(data['maxR'], 1.0)
    scale = min(W - 160, H - 120) / (2 * max_r)
    cx, cy = W / 2, H / 2

    # 用 RGBA 画布，最后再合成到白底，才能有半透明叠加
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def sx(x):
        return cx + x * scale

    def sy(y):
        return cy + y * scale

    nodes = data['nodes']
    comet_mask = data.get('cometMask') or [0] * len(nodes)

    # ---- 连线：插件默认不画，预览也保持一致（仅悬停时在应用内显示） ----

    # ---- 彗星尾迹：沿椭圆采样的折线 ----
    for pts in data.get('cometTrails') or []:
        for k in range(len(pts) - 1, 0, -1):
            alpha = 0.26 * (1 - (k - 1) / len(pts))
            d.line(
                [
                    (sx(pts[k][0]), sy(pts[k][1])),
                    (sx(pts[k - 1][0]), sy(pts[k - 1][1])),
                ],
                fill=rgba(alpha),
                width=1,
            )

    # ---- 尾迹：沿各自圆轨道的一段弧 ----
    trail = max(0.0, min(1.0, float(data.get('trail', 0))))
    if trail > 0.01:
        span = TRAIL_SPAN * trail
        for idx, node in enumerate(nodes):
            if comet_mask[idx]:
                continue  # 彗星用上面的折线
            x, y = node['x'], node['y']
            r = math.hypot(x, y)
            if r * scale < 6:
                continue
            head = math.degrees(math.atan2(y, x))
            tail = head - math.degrees(span)
            rr = r * scale
            box = [cx - rr, cy - rr, cx + rr, cy + rr]
            # 由淡到浓：分 6 段递进，模拟渐变
            seg = 6
            for k in range(seg):
                a0 = tail + (head - tail) * (k / seg)
                a1 = tail + (head - tail) * ((k + 1) / seg)
                d.arc(box, a0, a1, fill=rgba(0.04 + 0.22 * (k + 1) / seg), width=1)

    # ---- 点 ----
    for node in nodes:
        x, y, r = sx(node['x']), sy(node['y']), max(node['r'] * scale, 2.2)
        kind = node['kind']
        color = node.get('color')
        alpha = 0.95 if kind == 2 else (0.72 if kind == 1 else 0.86)
        d.ellipse([x - r, y - r, x + r, y + r], fill=tint(color, alpha) if color else rgba(alpha))
        if kind == 1:
            rr = r + 2.2
            outline = tint(color, 0.6) if color else rgba(0.55)
            d.ellipse([x - rr, y - rr, x + rr, y + rr], outline=outline, width=1)

    canvas = Image.new('RGB', (W, H), BG)
    canvas.paste(layer, (0, 0), layer)
    canvas.save(OUT_PATH)
    print('wrote', OUT_PATH, 'nodes=', len(nodes), 'maxR=%.1f' % max_r)


if __name__ == '__main__':
    sys.exit(main())
