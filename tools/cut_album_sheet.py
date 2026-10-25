# Gemini 的收集簿素材表（D:\ai\gemini\gacha\album_sheet.png：左＝卡片冊封面、右上＝木頭層板、右下＝薄荷色扭蛋壁紙）→ web/assets/tex/
#   py -I tools/cut_album_sheet.py D:/ai/gemini/gacha/album_sheet.png web/assets/tex
#   binder.webp（白底去掉、留描邊）、shelf_row.webp（層板放在 160 px 高透明圖的底部，CSS 一列一列往下鋪）、wall.webp（無縫壁紙）
import sys
from PIL import Image, ImageChops
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
px = im.load()


def bbox(x0, x1, y0=0, y1=None, thr=232):
    y1 = y1 or H
    xs, ys = [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if min(px[x, y]) < thr:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def clear_white(img, thr=228):
    # 從外框往內把白底填成透明（物件裡面的白不會動）
    img = img.convert('RGBA')
    w, h = img.size
    p = img.load()
    seen = set()
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        if min(p[x, y][:3]) < thr:
            continue
        seen.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    for (x, y) in seen:
        r, g, b, a = p[x, y]
        p[x, y] = (r, g, b, 0)
    # 描邊外圍一圈半透明（白底跟描邊混色的那一圈）→ 依亮度給 alpha，邊緣不會有白毛
    for y in range(h):
        for x in range(w):
            r, g, b, a = p[x, y]
            if a and any((x + dx, y + dy) in seen for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                lum = (r + g + b) / 3
                if lum > 150:
                    p[x, y] = (r, g, b, int(255 * max(0, min(1, (255 - lum) / 105))))
    return img, len(seen)


# 封面：左半邊
b = bbox(0, W * 47 // 100)  # 層板從 W/2 附近開始，不要切到
cover, n = clear_white(im.crop((b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2)))
cover.save(f'{out}/binder.webp', quality=92)
print('binder', b, cover.size, 'cleared', n)

# 層板：右上（壁紙上緣以上）
b2 = bbox(W // 2, W, 0, H * 2 // 5)
plank, n2 = clear_white(im.crop((b2[0] - 2, b2[1] - 2, b2[2] + 2, b2[3] + 2)))
pw, ph = plank.size
# 一列 160 px 高：上面透明、層板貼底，高 44 px；兩端（斜角）保持比例、中間拉長（九宮格）
PH = 44
pl = plank.resize((round(pw * PH / ph), PH), Image.LANCZOS)
end = 40
row = Image.new('RGBA', (1200, 160), (0, 0, 0, 0))
mid = pl.crop((end, 0, pl.size[0] - end, PH)).resize((1200 - 2 * end, PH), Image.LANCZOS)
row.alpha_composite(pl.crop((0, 0, end, PH)), (0, 160 - PH))
row.alpha_composite(mid, (end, 160 - PH))
row.alpha_composite(pl.crop((pl.size[0] - end, 0, pl.size[0], PH)), (1200 - end, 160 - PH))
row.save(f'{out}/shelf_row.webp', quality=92)
print('plank', b2, plank.size, '-> row', row.size)

# 壁紙：右下的方塊，往內縮一點避開邊線，再做成無縫（位移一半、接縫用另一份淡入淡出蓋掉）
b3 = bbox(W // 2, W, H * 2 // 5, H, thr=245)
tile = im.crop((b3[0] + 6, b3[1] + 6, b3[2] - 6, b3[3] - 6)).resize((320, 320), Image.LANCZOS)
t = tile.size[0]
shifted = ImageChops.offset(tile, t // 2, t // 2)
mask = Image.new('L', (t, t), 0)
mp = mask.load()
band = t // 6
for y in range(t):
    for x in range(t):
        d = min(abs(x - t // 2), abs(y - t // 2))
        mp[x, y] = 255 if d < band // 2 else max(0, 255 - int((d - band // 2) * 255 / band))
seamless = Image.composite(tile, shifted, mask)  # 接縫（在正中間）用原圖蓋掉
seamless.save(f'{out}/wall.webp', quality=88)
print('wall', b3, seamless.size)
