"""web/ → docs/（GitHub Pages 從 main 分支的 /docs 提供）
index.html 是 artifact 格式（沒有 doctype），這裡包上跟 tools/serve.py 一樣的外殼，
再加上 <meta description> 和分享預覽圖。
  py -I tools/build_site.py
"""
import os, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(ROOT, 'docs')

SHELL_HEAD = ('<!doctype html><html lang="zh-Hant"><head><meta charset=utf8>'
              '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
              '<meta name="description" content="開一台自己的轉蛋機：放進獎品、設定價錢、產生連結，拿到連結的人就能投幣、轉把手、開扭蛋。">'
              '<meta property="og:title" content="Clatter 轉蛋鋪">'
              '<meta property="og:description" content="投幣、轉把手、開扭蛋！">'
              '<meta property="og:image" content="https://leo70962001-lgtm.github.io/gacha-web/assets/og.jpg">'
              '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
              'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
              '</head><body>')
SHELL_TAIL = '</body></html>'

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
# gacha.glb 不用放：網頁讀的是 gacha.b64.txt
shutil.copytree(WEB, OUT, ignore=shutil.ignore_patterns('index.html', '*.glb'))
with open(os.path.join(WEB, 'index.html'), encoding='utf-8') as f:
    body = f.read()
with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(SHELL_HEAD + body + SHELL_TAIL)
open(os.path.join(OUT, '.nojekyll'), 'w').close()

# 分享預覽圖：Blender toon 版的渲染（裁成 1200×630）
from PIL import Image
src = os.path.join(ROOT, 'renders', 'toon_preview.png')
if os.path.exists(src):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    tw, th = 1200, 630
    s = max(tw / w, th / h * 0.62)
    im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    canvas = Image.new('RGB', (tw, th), im.getpixel((5, 5)))
    canvas.paste(im, ((tw - im.width) // 2, (th - im.height) // 2 + 20))
    canvas.save(os.path.join(OUT, 'assets', 'og.jpg'), quality=85)

total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print('built docs/', round(total / 1024), 'KB')
