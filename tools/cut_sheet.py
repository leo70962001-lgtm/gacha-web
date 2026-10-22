"""Gemini 貼紙組合表 → 一張張貼圖（web/assets/tex/*.webp）
  py -I tools/cut_sheet.py D:/ai/gemini/gacha/sheet_b.png D:/ai/gemini/gacha/side_a.png web/assets/tex
1. 白底以外的像素 → 遮罩 → 連通區塊（縮小 4 倍做，快）
2. 依位置與長寬比認出：橫幅、圓章、台紙框、代幣、直條
3. 每塊裁切、把外圍白邊去掉（圓章與代幣保留透明背景），存 webp
"""
import sys, os
import numpy as np
from PIL import Image
from collections import deque

sheet_p, side_p, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
im = Image.open(sheet_p).convert('RGB')
a = np.asarray(im).astype(np.int16)
S = 4
small = a[::S, ::S]
mask = (small.min(axis=2) < 232)
H, W = mask.shape
lab = np.zeros((H, W), np.int32)
boxes = []
for y in range(H):
    for x in range(W):
        if mask[y, x] and not lab[y, x]:
            n = len(boxes) + 1
            q = deque([(y, x)])
            lab[y, x] = n
            x0 = x1 = x
            y0 = y1 = y
            cnt = 0
            while q:
                cy, cx = q.popleft()
                cnt += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            q.append((ny, nx))
            boxes.append((cnt, x0 * S, y0 * S, (x1 + 1) * S, (y1 + 1) * S))
boxes = [b for b in boxes if b[0] > 400]
boxes.sort(key=lambda b: -b[0])
for b in boxes:
    print('box', b, 'aspect', round((b[3] - b[1]) / (b[4] - b[2]), 2))

named = {}
for cnt, x0, y0, x1, y1 in boxes[:6]:
    w, h = x1 - x0, y1 - y0
    asp = w / h
    if asp > 4:
        named.setdefault('banner', (x0, y0, x1, y1))
    elif asp < 0.7:
        named.setdefault('strip', (x0, y0, x1, y1))
    elif asp > 1.15:
        named.setdefault('card', (x0, y0, x1, y1))
    elif w > 150:
        named.setdefault('badge', (x0, y0, x1, y1))
    else:
        named.setdefault('coin', (x0, y0, x1, y1))
print('named', named)


def crop(box, inset, alpha=False):
    x0, y0, x1, y1 = box
    c = im.crop((x0 + inset, y0 + inset, x1 - inset, y1 - inset))
    if not alpha:
        return c
    # 圓形貼紙：外圍白色變透明（從四角往內灌）
    arr = np.asarray(c.convert('RGBA')).copy()
    h, w = arr.shape[:2]
    white = arr[:, :, :3].min(axis=2) > 236
    seen = np.zeros((h, w), bool)
    q = deque([(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)])
    while q:
        y, x = q.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or seen[y, x] or not white[y, x]:
            continue
        seen[y, x] = True
        q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    arr[seen, 3] = 0
    return Image.fromarray(arr)


# 貼紙外圍有一圈白邊（die-cut），橫幅/台紙/直條往內裁掉一點只留圖案
specs = {'banner': (10, False), 'card': (10, False), 'strip': (8, False), 'badge': (0, True), 'coin': (0, True)}
for name, box in named.items():
    inset, alpha = specs[name]
    c = crop(box, inset, alpha)
    p = os.path.join(out, name + '.webp')
    c.save(p, 'WEBP', quality=86, method=6)
    print('saved', p, c.size, os.path.getsize(p))

side = Image.open(side_p).convert('RGB')
side.thumbnail((1024, 1024))
p = os.path.join(out, 'side.webp')
side.save(p, 'WEBP', quality=84, method=6)
print('saved', p, side.size, os.path.getsize(p))
