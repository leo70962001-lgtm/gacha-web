# App 圖示（PWA）：Gemini 畫的 1:1 轉蛋機（D:\ai\gemini\gacha\app_icon.png）→ web/assets/icons/
#   py -I tools/make_icons.py D:/ai/gemini/gacha/app_icon.png web/assets/icons
#   icon-192／512：整張（奶油色底填滿）；maskable-512：往內縮 88%、四周補底色（Android 會裁成圓形／圓角，主體要在安全區內）
#   apple-touch-icon（180、不透明）；favicon-32：裁近一點，小小的也看得出是轉蛋機
import os, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGB')
w, h = im.size
s = min(w, h)
im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
# 四個角的平均色＝底色
corners = [im.getpixel(p) for p in ((4, 4), (s - 5, 4), (4, s - 5), (s - 5, s - 5))]
bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))


def save(img, size, name):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)
    print(name, size)


save(im, 512, 'icon-512.png')
save(im, 192, 'icon-192.png')
save(im, 180, 'apple-touch-icon.png')
pad = Image.new('RGB', (s, s), bg)
k = round(s * 0.88)
pad.paste(im.resize((k, k), Image.LANCZOS), ((s - k) // 2, (s - k) // 2))
save(pad, 512, 'maskable-512.png')
c = round(s * 0.14)
save(im.crop((c, c, s - c, s - c)), 32, 'favicon-32.png')
print('bg', bg)
