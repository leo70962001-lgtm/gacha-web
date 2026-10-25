# Gemini 的轉卡機素材表（D:\ai\gemini\gacha\card_sheet.png，左：卡背、右：側面插畫）→ web/assets/tex/
#   py -I tools/cut_card_sheet.py D:/ai/gemini/gacha/card_sheet.png web/assets/tex
import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
px = im.load()

def bbox(x0, x1, thr=232):
    xs, ys = [], []
    for y in range(H):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if min(r, g, b) < thr:
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1

# 左邊三分之一：卡背；角落外面的白底 → 透明（從四個角往內填）
b = bbox(0, W * 2 // 5)
card = im.crop(b).convert('RGBA')
cw, ch = card.size
mask = Image.new('L', card.size, 0)
cp = card.load()
seen = set()
stack = [(0, 0), (cw - 1, 0), (0, ch - 1), (cw - 1, ch - 1)]
while stack:
    x, y = stack.pop()
    if (x, y) in seen or not (0 <= x < cw and 0 <= y < ch):
        continue
    r, g, bl, a = cp[x, y]
    if min(r, g, bl) < 225:
        continue
    seen.add((x, y))
    stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
for (x, y) in seen:
    r, g, bl, a = cp[x, y]
    cp[x, y] = (r, g, bl, 0)
card.save(f'{out}/cardback.webp', quality=92)
print('cardback', b, card.size, 'cleared', len(seen))

# 右邊：側面插畫（米色底的方塊）
b2 = bbox(W * 2 // 5, W)
side = im.crop(b2)
side.save(f'{out}/cside.webp', quality=88)
print('cside', b2, side.size)
