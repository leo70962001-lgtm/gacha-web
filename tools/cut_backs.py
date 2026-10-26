# 卡背樣式（Gemini 手繪，一排 4 張直的卡）→ web/assets/tex/back_<id>.webp（300×437）
#   py -I tools/cut_backs.py <sheet.png> <id1,id2,id3,id4> web/assets/tex
#   找出每張卡：直向的白色空隙把卡分開 → 每張裁掉四周白邊 → 往內縮一點（圓角外的白色不要）→ 照卡片比例 0.686 置中裁、縮放
import sys
from PIL import Image

src, ids, out = sys.argv[1], sys.argv[2].split(','), sys.argv[3]
im = Image.open(src).convert('RGB')
W, H = im.size
px = im.load()


def ink(r, g, b):
    return min(r, g, b) < 225


# 每一欄有沒有「不是白色」的點（上下各留一點邊）
cols = []
for x in range(W):
    n = 0
    for y in range(0, H, 2):
        if ink(*px[x, y]):
            n += 1
    cols.append(n)
runs = []
start = None
for x, n in enumerate(cols + [0]):
    if n > 3 and start is None:
        start = x
    elif n <= 3 and start is not None:
        if x - start > W * 0.08:
            runs.append((start, x))
        start = None
print('cards found', len(runs), runs)
assert len(runs) == len(ids), f'expected {len(ids)} cards, found {len(runs)}'
for (x0, x1), cid in zip(runs, ids):
    ys = [y for y in range(H) if any(ink(*px[x, y]) for x in range(x0, x1, 3))]
    y0, y1 = min(ys), max(ys) + 1
    card = im.crop((x0, y0, x1, y1))
    cw, ch = card.size
    k = 0.035  # 圓角外的白色裁掉
    card = card.crop((round(cw * k), round(ch * k * 0.686), round(cw * (1 - k)), round(ch * (1 - k * 0.686))))
    cw, ch = card.size
    r = 0.686
    if cw / ch > r:
        nw = round(ch * r)
        card = card.crop(((cw - nw) // 2, 0, (cw - nw) // 2 + nw, ch))
    else:
        nh = round(cw / r)
        card = card.crop((0, (ch - nh) // 2, cw, (ch - nh) // 2 + nh))
    card = card.resize((300, 437), Image.LANCZOS)
    card.save(f'{out}/back_{cid}.webp', quality=88)
    print(cid, (x0, y0, x1, y1), '->', card.size)
