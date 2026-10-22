"""開蛋演出逐格圖：renders/fx_frames/*.jpg → 一張對照表
  py -I tools/fx_sheet.py <prefix> <out.png> [cols]
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
prefix, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
files = sorted(glob.glob(os.path.join(ROOT, 'renders', 'fx_frames', prefix + '*.jpg')))
ims = [Image.open(f).convert('RGB') for f in files]
tw = 360
th = int(ims[0].height * tw / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + 10) + 10, rows * (th + 40) + 10), (240, 243, 246))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 20)
except OSError:
    font = ImageFont.load_default()
for i, (f, im) in enumerate(zip(files, ims)):
    x = 10 + (i % cols) * (tw + 10)
    y = 10 + (i // cols) * (th + 40)
    sheet.paste(im.resize((tw, th)), (x, y + 28))
    d.text((x, y + 2), os.path.basename(f)[:-4], font=font, fill=(28, 35, 64))
sheet.save(out)
print('saved', out, sheet.size, len(ims))
