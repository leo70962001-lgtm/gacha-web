r"""Gemini 的手繪貼紙素材表 → 一張一張去背的貼紙素材（web/assets/stickers/sNN.webp）
  py -I tools/cut_stickers.py D:/ai/gemini/gacha/sticker_sheet.png web/assets/stickers
背景＝從圖的四邊連過來的白色（主體裡面的白色，像貓臉、扭蛋的白半邊，不會被挖掉）；
前景稍微膨脹後分塊（彩虹＋雲這種分開的小塊會併在一起），太小的雜點丟掉；照「列、行」排序。
每張：邊緣柔化一點、裁到剛好、長邊最多 384 px、透明底 webp；另外輸出 sheet_check.png 看切得對不對。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.int16)
H, W, _ = a.shape
# 接近白（亮、不太有顏色）
light = (a.min(axis=2) > 232) & ((a.max(axis=2) - a.min(axis=2)) < 22)
lab, _ = ndimage.label(light)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(edge))
fg = ~bg
fg = ndimage.binary_opening(fg, iterations=1)
# 分塊：膨脹後連在一起的算同一張
grow = ndimage.binary_dilation(fg, iterations=max(4, W // 160))
blobs, n = ndimage.label(grow)
boxes = []
for i, sl in enumerate(ndimage.find_objects(blobs), 1):
    if sl is None:
        continue
    ys, xs = sl
    m = (blobs[sl] == i) & fg[sl]
    if m.sum() < (W * H) * 0.002:
        continue
    boxes.append((ys.start, ys.stop, xs.start, xs.stop, i))
# 排序：先分列（中心 y 差不到高度一半的算同一列），再由左到右
boxes.sort(key=lambda b: (b[0] + b[1]) / 2)
rows = []
for b in boxes:
    cy = (b[0] + b[1]) / 2
    if rows and abs(cy - rows[-1][0]) < (b[1] - b[0]) * 0.5:
        rows[-1][1].append(b)
    else:
        rows.append([cy, [b]])
ordered = [b for _, r in rows for b in sorted(r, key=lambda b: b[2])]
check = im.copy()
dr = ImageDraw.Draw(check)
alpha_full = ndimage.gaussian_filter(fg.astype(np.float32), 0.8)
for k, (y0, y1, x0, x1, i) in enumerate(ordered, 1):
    m = blobs[y0:y1, x0:x1] == i
    al = np.where(m, alpha_full[y0:y1, x0:x1], 0)
    al = np.clip((al - 0.15) / 0.7, 0, 1)
    rgba = np.dstack([a[y0:y1, x0:x1].astype(np.uint8), (al * 255).astype(np.uint8)])
    t = Image.fromarray(rgba, 'RGBA')
    bb = t.getbbox()
    if bb:
        t = t.crop(bb)
    s = min(1, 384 / max(t.size))
    if s < 1:
        t = t.resize((max(1, round(t.width * s)), max(1, round(t.height * s))), Image.LANCZOS)
    name = f's{k:02d}.webp'
    t.save(os.path.join(out, name), 'WEBP', quality=88, method=6)
    dr.rectangle([x0, y0, x1, y1], outline=(255, 0, 128), width=3)
    dr.text((x0 + 6, y0 + 4), str(k), fill=(255, 0, 128))
    print(name, t.size)
check.save(os.path.join(os.path.dirname(src), 'sticker_sheet_check.png'))
print(len(ordered), 'stickers')
