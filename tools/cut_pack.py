r"""Gemini 畫的鋁箔貼紙包 → web/assets/tex/foil_pack.webp（透明底）＋撕口、標籤的位置
  py -I tools/cut_pack.py D:/ai/gemini/gacha/foil_pack.png web/assets/tex/foil_pack.webp
背景＝從四邊連過來的白（標籤裡的白被粉紅框圍住，不會被挖掉）。
量：撕口＝左邊 V 形切口最深的那一列（peel.js 的 seal＝那一列／高度）；標籤＝袋子裡最大的一塊白（圓心、半徑／寬）。"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.int16)
light = (a.min(axis=2) > 236) & ((a.max(axis=2) - a.min(axis=2)) < 18)
lab, _ = ndimage.label(light)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
fg = ~np.isin(lab, list(edge))
fg = ndimage.binary_opening(fg, iterations=1)
# 只留最大一塊（袋子本身）
blobs, n = ndimage.label(fg)
sizes = ndimage.sum(fg, blobs, range(1, n + 1))
fg = blobs == (int(np.argmax(sizes)) + 1)
fg = ndimage.binary_fill_holes(fg) | fg
ys, xs = np.where(fg)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.7)
alpha = np.clip((alpha - 0.15) / 0.7, 0, 1)
rgba = np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
H, W = rgba.shape[:2]
# 撕口：上面 35% 裡，左邊緣最往內凹的那一列
left = np.array([np.argmax(fg[y0 + r, x0:x1]) if fg[y0 + r, x0:x1].any() else 0 for r in range(H)])
top = int(H * 0.35)
base = np.median(left[int(H * 0.2):int(H * 0.8)])
notch = int(np.argmax(left[:top] - (left[:top] == 0) * 999))
seal = notch / H
# 標籤：袋子裡（不碰邊）最大的一塊白
inner = light[y0:y1, x0:x1] & fg[y0:y1, x0:x1]
lb, m = ndimage.label(inner)
best = None
for i, sl in enumerate(ndimage.find_objects(lb), 1):
    if sl is None:
        continue
    area = (lb[sl] == i).sum()
    if best is None or area > best[0]:
        best = (area, sl)
_, sl = best
cy = (sl[0].start + sl[0].stop) / 2 / H
cx = (sl[1].start + sl[1].stop) / 2 / W
r = max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) / 2 / W
t = Image.fromarray(rgba, 'RGBA')
s = min(1, 1024 / H)
if s < 1:
    t = t.resize((round(W * s), round(H * s)), Image.LANCZOS)
t.save(out, 'WEBP', quality=90, method=6)
print(json.dumps({'size': t.size, 'seal': round(seal, 4), 'notchDepth': int(left[notch] - base), 'labelAt': {'x': round(cx, 4), 'y': round(cy, 4), 'r': round(r, 4)}}))
