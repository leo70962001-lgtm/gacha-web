"""法線查證報告：Blender 偏差熱圖（修正前／後）＋網頁 toon 畫面（修正前／後）＋邊緣放大
  py -I tools/normal_report.py <web_before.png> <web_after.png> <out.png>
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
before_web, after_web, out = sys.argv[1:4]
hb = Image.open(os.path.join(ROOT, 'renders/normals/normal_dev.png')).convert('RGB')
ha = Image.open(os.path.join(ROOT, 'renders/normals_fixed/normal_dev.png')).convert('RGB')
wb = Image.open(before_web).convert('RGB')
wa = Image.open(after_web).convert('RGB')

try:
    font = ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc', 26)
    small = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 20)
except OSError:
    font = small = ImageFont.load_default()

W = 1700
sheet = Image.new('RGB', (W, 1640), (246, 248, 250))
d = ImageDraw.Draw(sheet)
d.text((24, 18), '法線查證：頂點法線和面法線差幾度（白 0°、黃 5°、橘 15°、紅 30°+）', font=font, fill=(28, 35, 64))
for i, (im, cap) in enumerate(((hb, '修正前：Maya 自訂法線蓋掉銳邊\n機身 56% 面積偏 >5°，正面、側面大面偏 50–60°'),
                                (ha, '修正後：清自訂法線＋30° 銳邊＋Weighted Normal\n機身 11%，大平面 0°，只剩圓角和斜角'))):
    t = im.resize((560, 700))
    x = 24 + i * 600
    sheet.paste(t, (x, 70))
    d.multiline_text((x, 778), cap, font=small, fill=(60, 66, 85), spacing=4)

d.text((24, 840), '網頁 toon 畫面（同一角度、同一顏色）', font=font, fill=(28, 35, 64))
for i, (im, cap) in enumerate(((wb, '修正前'), (wa, '修正後'))):
    t = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    x = 24 + i * 840
    sheet.paste(t, (x, 880))
    d.text((x, 880 + t.height + 8), cap, font=small, fill=(60, 66, 85))
sheet.save(out)
print('saved', out, sheet.size)
