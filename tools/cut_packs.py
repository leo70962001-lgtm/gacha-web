r"""Gemini 一張圖畫好幾款貼紙袋（橫排）→ 一款一張 web/assets/tex/pack_<id>.webp（透明底）＋撕口、標籤的位置
  py -I tools/cut_packs.py D:/ai/gemini/gacha/pack_sheet.png web/assets/tex kraft,night,candy,gingham
袋子之間的白縫很窄（有時候碰在一起）→ 先找每兩款之間前景最少的那一直條切開，再一款一款照 cut_pack.py 的做法：
背景＝從四邊連過來的白；撕口＝左邊在上面 35% 裡最往內凹的那一列（seal＝那一列／高度）；標籤＝袋子裡最大的一塊白（圓心、半徑／寬）。"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, outdir, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
im = Image.open(src).convert('RGB')
A = np.asarray(im).astype(np.int16)
H0, W0 = A.shape[:2]
light_all = (A.min(axis=2) > 232) & ((A.max(axis=2) - A.min(axis=2)) < 20)
# 切開：每個預期的分界附近（±9% 寬）找前景最少的直條
col = (~light_all).sum(axis=0).astype(float)
n = len(names)
cuts = [0]
for i in range(1, n):
    c = W0 * i / n
    lo, hi = int(c - W0 * 0.09), int(c + W0 * 0.09)
    cuts.append(lo + int(np.argmin(col[lo:hi])))
cuts.append(W0)

res = {}
for i, name in enumerate(names):
    a = A[:, cuts[i]:cuts[i + 1]]
    light = light_all[:, cuts[i]:cuts[i + 1]]
    lab, _ = ndimage.label(light)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ~np.isin(lab, list(edge))
    fg = ndimage.binary_opening(fg, iterations=1)
    blobs, m = ndimage.label(fg)
    sizes = ndimage.sum(fg, blobs, range(1, m + 1))
    fg = blobs == (int(np.argmax(sizes)) + 1)
    fg = ndimage.binary_fill_holes(fg) | fg
    ys, xs = np.where(fg)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.7)
    alpha = np.clip((alpha - 0.15) / 0.7, 0, 1)
    rgba = np.dstack([a.astype(np.uint8), (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    H, W = rgba.shape[:2]
    left = np.array([np.argmax(fg[y0 + r, x0:x1]) if fg[y0 + r, x0:x1].any() else 0 for r in range(H)])
    # 上緣是鋸齒（最上面幾列的左邊緣亂跳）→ 從 6% 往下找到 35%
    r0, r1 = int(H * 0.06), int(H * 0.35)
    seg = left[r0:r1] - (left[r0:r1] == 0) * 999
    notch = r0 + int(np.argmax(seg))
    inner = light[y0:y1, x0:x1] & fg[y0:y1, x0:x1]
    lb, k = ndimage.label(inner)
    best = None
    for j, sl in enumerate(ndimage.find_objects(lb), 1):
        if sl is None:
            continue
        area = (lb[sl] == j).sum()
        if best is None or area > best[0]:
            best = (area, sl)
    _, sl = best
    cy = (sl[0].start + sl[0].stop) / 2 / H
    cx = (sl[1].start + sl[1].stop) / 2 / W
    r = max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) / 2 / W
    t = Image.fromarray(rgba, 'RGBA')
    out = os.path.join(outdir, f'pack_{name}.webp')
    t.save(out, 'WEBP', quality=90, method=6)
    res[name] = {'size': t.size, 'seal': round(notch / H, 4), 'notchDepth': int(left[notch] - np.median(left[int(H * 0.2):int(H * 0.8)])), 'labelAt': {'x': round(cx, 4), 'y': round(cy, 4), 'r': round(r, 4)}}
print(json.dumps({'cuts': cuts, 'packs': res}, ensure_ascii=False))
