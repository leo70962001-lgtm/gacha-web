r"""Gemini 手繪スタンプ表（4×3，扭蛋寶寶）→ 12 個透明底スタンプ（web/assets/stamps/s0–s11.webp）
  py -I tools/cut_stamps.py D:/ai/gemini/gacha/stamps.png web/assets/stamps
紙是淺灰、貼紙的白邊幾乎一樣亮 → 照畫的線切（從四邊連過來的「亮、沒什麼顏色」＝紙），
前景先閉合補線條的小縫、補洞（主體裡的白色留著）；愛心、星星、彩帶、zzz 這種分開的小塊膨脹後併成同一張；
每張重新加一圈白色裁切邊（距離場，跟 sticker.js 的 die-cut 一樣的感覺）＋很淡的外框線，長邊 200 px 的透明 webp；
另外輸出 stamps_check.png 看切得對不對（順序＝左到右、上到下，對應 social.js 的 soc.st0–st11）。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(np.int16)
H, W, _ = a.shape
paper = (a.min(axis=2) > 222) & ((a.max(axis=2) - a.min(axis=2)) < 16)
fg0 = ~paper
fg0 = ndimage.binary_opening(fg0, iterations=1)  # 紙紋的雜點
fg0 = ndimage.binary_closing(fg0, iterations=3)  # 鉛筆線的小縫
lab, _ = ndimage.label(~fg0)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(edge))
mask = ndimage.binary_fill_holes(~bg)
# 分塊：膨脹後連在一起的算同一張
# （膨脹太多會把火焰那張跟上面那張連在一起：W/90 太大，用 10）；碰到圖邊的＝紙的陰影，丟掉；
# 離得遠一點的小塊（星星、彩帶）併到最近的那張
grow = ndimage.binary_dilation(mask, iterations=10)
blobs, n = ndimage.label(grow)
big, small = [], []
for i, sl in enumerate(ndimage.find_objects(blobs), 1):
    ys, xs = sl
    if ys.start == 0 or xs.start == 0 or ys.stop == H or xs.stop == W:
        continue
    area = (mask[sl] & (blobs[sl] == i)).sum()
    (big if area >= (W * H) * 0.002 else small).append([ys.start, ys.stop, xs.start, xs.stop, i])
for y0, y1, x0, x1, i in small:
    def gap(b):
        return max(0, b[0] - y1, y0 - b[1]) + max(0, b[2] - x1, x0 - b[3])
    tgt = min(big, key=gap)
    if gap(tgt) < 60:
        blobs[blobs == i] = tgt[4]
        tgt[0], tgt[1], tgt[2], tgt[3] = min(tgt[0], y0), max(tgt[1], y1), min(tgt[2], x0), max(tgt[3], x1)
items = [tuple(b) for b in big]
print('blobs', len(items), 'small merged', len(small))
assert len(items) == 12, len(items)
# 照列排：先按中心 y 分 3 列，每列按 x
items.sort(key=lambda b: (b[0] + b[1]) / 2)
rows = [sorted(items[r * 4:(r + 1) * 4], key=lambda b: b[2]) for r in range(3)]
order = [b for r in rows for b in r]
BORDER = 7  # 白邊（原圖 px）
check = Image.new('RGB', (W, H), (255, 0, 255))
check.paste(im)
dr = ImageDraw.Draw(check)
for k, (y0, y1, x0, x1, i) in enumerate(order):
    pad = BORDER + 4
    y0, y1, x0, x1 = max(0, y0 - pad), min(H, y1 + pad), max(0, x0 - pad), min(W, x1 + pad)
    m = mask[y0:y1, x0:x1] & (blobs[y0:y1, x0:x1] == i)
    # 小塊（星星、愛心）跟主體之間也補成白底：膨脹 BORDER 再閉合
    dist = ndimage.distance_transform_edt(~m)
    die = dist <= BORDER
    die = ndimage.binary_closing(die, iterations=4)
    die = ndimage.binary_fill_holes(die)
    # 白邊連不上主體的小碎塊（紙的陰影）丟掉
    dl, dn = ndimage.label(die)
    if dn > 1:
        sizes = ndimage.sum(die, dl, range(1, dn + 1))
        keep = [j + 1 for j, v in enumerate(sizes) if v >= sizes.max() * 0.15]
        die = np.isin(dl, keep)
        m &= die
        dist = ndimage.distance_transform_edt(~m)
    rgb = np.asarray(im.crop((x0, y0, x1, y1))).astype(np.float32)
    white = np.full_like(rgb, 255.0)
    # 畫的部分用原圖，白邊用純白；交界柔一點
    soft = np.clip(1.5 - dist, 0, 1)[..., None]
    col = rgb * soft + white * (1 - soft)
    # 裁切邊最外圈淡淡的灰線（白底上也看得到形狀）
    ddie = ndimage.distance_transform_edt(die)
    rim = ((ddie > 0) & (ddie <= 1.6))[..., None]
    col = np.where(rim, col * 0.82 + np.array([150, 160, 175]) * 0.18, col)
    alpha = np.clip(ddie / 1.2, 0, 1) * 255
    rgba = np.dstack([col, alpha]).astype(np.uint8)
    st = Image.fromarray(rgba, 'RGBA')
    bb = st.getbbox()
    st = st.crop(bb)
    s = 200 / max(st.size)
    st = st.resize((max(1, round(st.width * s)), max(1, round(st.height * s))), Image.LANCZOS)
    # 正方形畫布置中（各張一樣大小，排起來整齊）
    sq = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
    sq.paste(st, ((200 - st.width) // 2, (200 - st.height) // 2), st)
    sq.save(os.path.join(out, f's{k}.webp'), 'WEBP', quality=88, method=6)
    dr.rectangle([x0, y0, x1, y1], outline=(255, 0, 0), width=3)
    dr.text((x0 + 6, y0 + 4), str(k), fill=(255, 0, 0))
check.save(os.path.join(os.path.dirname(src), 'stamps_check.png'))
print('ok', [os.path.getsize(os.path.join(out, f's{k}.webp')) for k in range(12)])
