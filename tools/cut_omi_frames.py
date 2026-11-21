# おみくじ的籤紙框（Gemini 2026-11-21，一張 16:9 五種）→ web/assets/tex/omi_frame_<id>.webp ＋ 中間白色紙面、上面小標籤的位置
#   py tools/cut_omi_frames.py D:/ai/gemini/gacha/omi_frames.png
# 做法：灰底以外的部分照欄投影切成 5 張 → 各自裁掉灰邊 → 縮成 360 × 840（3:7）
#   白色紙面＝「一整列幾乎都是白」的那些列裡最大的一段；標籤＝紙面上緣之上、中間那塊白
import sys, os, json
import numpy as np
from PIL import Image

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'web', 'assets', 'tex')
IDS = ['red', 'teal', 'gold', 'indigo', 'pink']
W, H = 360, 840

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.int16)
bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)]), axis=0)
diff = np.abs(a - bg).sum(axis=2)
fg = diff > 14
cols = fg.mean(axis=0) > 0.25
# 框裡淡色的那一圈（金色那張的內緣）跟灰底很像 → 小於 12 px 的縫補起來
xs = np.where(cols)[0]
for x0, x1 in zip(xs[:-1], xs[1:]):
    if 1 < x1 - x0 <= 12:
        cols[x0:x1] = True
# 連續的欄 → 一張籤
runs = []
x = 0
while x < len(cols):
    if cols[x]:
        x0 = x
        while x < len(cols) and cols[x]:
            x += 1
        if x - x0 > 40:
            runs.append((x0, x))
    x += 1
print('runs', runs)
assert len(runs) == 5, runs
meta = {}
for id_, (x0, x1) in zip(IDS, runs):
    rows = fg[:, x0:x1].mean(axis=1) > 0.5
    ys = np.where(rows)[0]
    y0, y1 = ys[0], ys[-1] + 1
    crop = im.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    c = np.asarray(crop).astype(np.int16)
    white = (c.min(axis=2) > 232) & ((c.max(axis=2) - c.min(axis=2)) < 18)
    rw = white.mean(axis=1)
    # 紙面：白的比例 > 55% 的列裡最長的一段
    good = rw > 0.55
    best = (0, 0)
    y = 0
    while y < ch:
        if good[y]:
            s = y
            while y < ch and good[y]:
                y += 1
            if y - s > best[1] - best[0]:
                best = (s, y)
        y += 1
    py0, py1 = best
    band = white[py0 + 4:py1 - 4]
    cw_white = band.mean(axis=0) > 0.9
    xs = np.where(cw_white)[0]
    px0, px1 = xs[0], xs[-1] + 1
    # 標籤：紙面上緣往上，中間那一塊白
    mid = (px0 + px1) // 2
    ty1 = py0 + int(0.02 * ch)
    ty0 = py0
    while ty0 > 0 and white[ty0 - 1, mid - 3:mid + 4].mean() > 0.7:
        ty0 -= 1
    tw = white[ty0 + 2:py0, :].mean(axis=0) > 0.6 if py0 - ty0 > 4 else np.zeros(cw, bool)
    txs = np.where(tw)[0]
    tab = None
    if len(txs) and py0 - ty0 > 4:
        tab = [round(txs[0] / cw, 4), round(ty0 / ch, 4), round((txs[-1] + 1 - txs[0]) / cw, 4), round((py0 + 0.03 * ch - ty0) / ch, 4)]
    meta[id_] = {
        'inner': [round(px0 / cw, 4), round(py0 / ch, 4), round((px1 - px0) / cw, 4), round((py1 - py0) / ch, 4)],
        'tab': tab,
        'size': [cw, ch],
    }
    crop.resize((W, H), Image.LANCZOS).save(os.path.join(OUT, f'omi_frame_{id_}.webp'), quality=86)
    print(id_, meta[id_], os.path.getsize(os.path.join(OUT, f'omi_frame_{id_}.webp')))
print(json.dumps(meta))
