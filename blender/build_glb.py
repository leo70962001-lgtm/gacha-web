# 轉蛋機模型 → 網頁用 GLB
# 用法（背景執行，不動使用者開著的 Blender）：
#   blender -b D:/ai/clatter.blend --python D:/ai/gacha-web/blender/build_glb.py -- D:/ai/gacha-web
# 做的事：
#   1. 把 Maya 匯入的 group8/group9（縮放 0.01、旋轉 90°）套用到網格 → 全部變成公尺、Z 向上
#   2. 重新命名零件：Body / Window / Lid / Handle / CapsuleTop / CapsuleBottom / Coin
#   3. 依位置把機身的面分成：塑膠外殼、出口凹槽（暗色）、投幣口與退幣口（金屬）
#   4. 真實材質（ABS、PC 透明窗、PP 扭蛋殼、黃銅代幣），數值寫在 MATS
#   5. Smart UV → Cycles 烘焙 AO（網頁用 aoMap 讀）
#   6. 存成 blender/gacha_web.blend（可打開學習）＋ web/assets/gacha.glb ＋ AO png
import bpy, bmesh, mathutils, math, sys, os

ROOT = sys.argv[sys.argv.index("--") + 1]
ASSETS = os.path.join(ROOT, "web", "assets")
os.makedirs(ASSETS, exist_ok=True)

RENAME = {
    "polySurface21": "Body",
    "polySurface10": "Window",
    "polySurface20": "Lid",
    "pCylinder10": "Handle",
    "polySurface18": "CapsuleTop",
    "polySurface19": "CapsuleBottom",
    "pCylinder11": "Coin",
}

# 材質：base, roughness, metallic, transmission, ior
#   ABS 外殼 IOR 1.53；PC 透明窗 IOR 1.585；PP 扭蛋殼 IOR 1.49；代幣＝黃銅
#   顏色在網頁端由賣家選（主題色），這裡給白色當底
MATS = {
    "M_Body":     dict(base=(0.86, 0.86, 0.84), rough=0.32, metal=0.0, trans=0.0, ior=1.53),
    "M_Lid":      dict(base=(0.86, 0.86, 0.84), rough=0.30, metal=0.0, trans=0.0, ior=1.53),
    "M_Handle":   dict(base=(0.86, 0.86, 0.84), rough=0.28, metal=0.0, trans=0.0, ior=1.53),
    "M_ExitDark": dict(base=(0.035, 0.035, 0.04), rough=0.55, metal=0.0, trans=0.0, ior=1.53),
    "M_Metal":    dict(base=(0.80, 0.80, 0.80), rough=0.20, metal=1.0, trans=0.0, ior=1.50),
    "M_Window":   dict(base=(1.0, 1.0, 1.0), rough=0.03, metal=0.0, trans=1.0, ior=1.585),
    "M_CapClear": dict(base=(1.0, 1.0, 1.0), rough=0.12, metal=0.0, trans=0.92, ior=1.49),
    "M_CapColor": dict(base=(0.9, 0.9, 0.9), rough=0.30, metal=0.0, trans=0.0, ior=1.49),
    "M_Coin":     dict(base=(0.92, 0.70, 0.32), rough=0.28, metal=1.0, trans=0.0, ior=1.50),
}


def make_mat(name, p):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*p["base"], 1.0)
    bsdf.inputs["Roughness"].default_value = p["rough"]
    bsdf.inputs["Metallic"].default_value = p["metal"]
    bsdf.inputs["Transmission Weight"].default_value = p["trans"]
    bsdf.inputs["IOR"].default_value = p["ior"]
    return m


# ---------- 1. 套用變換、拔掉 Maya 的 group ----------
scene = bpy.context.scene
for old, new in RENAME.items():
    o = bpy.data.objects[old]
    mw = o.matrix_world.copy()
    o.parent = None
    o.data = o.data.copy()          # 不改到原檔的網格資料
    o.data.transform(mw)
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.name = new
    o.data.name = new
for n in ("group8", "group9", "Camera", "Light"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])


def center_origin(o):
    vs = [v.co for v in o.data.vertices]
    c = mathutils.Vector([(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)])
    o.data.transform(mathutils.Matrix.Translation(-c))
    o.location = c
    return c


hc = center_origin(bpy.data.objects["Handle"])
print("HANDLE_CENTER", tuple(round(x, 4) for x in hc))
# 扭蛋兩半共用同一個中心（上下半球的接縫）
top, bot = bpy.data.objects["CapsuleTop"], bpy.data.objects["CapsuleBottom"]
cc = mathutils.Vector((0, 0, 0.113))
for o in (top, bot):
    o.data.transform(mathutils.Matrix.Translation(-cc))
    o.location = (0.9, 0, 0.3)        # 放旁邊當樣本，網頁端複製使用
coin = bpy.data.objects["Coin"]
center_origin(coin)
coin.location = (0.9, 0, 0.05)

for o in bpy.data.objects:
    if o.type == "MESH":
        o.data.shade_smooth() if hasattr(o.data, "shade_smooth") else None
        o.data.set_sharp_from_angle(angle=math.radians(40))

# ---------- 2. 材質 ----------
mats = {k: make_mat(k, v) for k, v in MATS.items()}


def set_single(o, mname):
    o.data.materials.clear()
    o.data.materials.append(mats[mname])


set_single(bpy.data.objects["Window"], "M_Window")
set_single(bpy.data.objects["Lid"], "M_Lid")
set_single(bpy.data.objects["Handle"], "M_Handle")
set_single(top, "M_CapClear")
set_single(bot, "M_CapColor")
# 扭蛋原本只有 110 個頂點，拉到鏡頭前輪廓是多邊形 → 細分 2 次（匯出時套用）
for o in (top, bot):
    sub = o.modifiers.new("Smooth", "SUBSURF")
    sub.levels = sub.render_levels = 2
set_single(coin, "M_Coin")

# 機身：依面的位置分材質（座標＝公尺，前面朝 −Y）
body = bpy.data.objects["Body"]
body.data.materials.clear()
for n in ("M_Body", "M_ExitDark", "M_Metal"):
    body.data.materials.append(mats[n])
FRONT = -0.357          # 機身正面
counts = [0, 0, 0]
for f in body.data.polygons:
    c = f.center
    idx = 0
    # 出口凹槽：x −0.27..−0.03、z 0.07..0.32，深到 y −0.154
    if -0.275 < c.x < -0.025 and 0.06 < c.z < 0.33 and c.y > FRONT + 0.004:
        idx = 1
    # 退幣口：x 0.11..0.22、z 0.07..0.18
    elif 0.10 < c.x < 0.235 and 0.06 < c.z < 0.19 and c.y > FRONT + 0.004:
        idx = 2
    # 投幣口（凹下去的圓盤，中心 x 0.20 z 0.60）＋下方兩個小按鈕（凸出）
    elif (math.hypot(c.x - 0.20, c.z - 0.60) < 0.065 and c.y < -0.30) or (
        c.y < FRONT - 0.002 and (
            math.hypot(c.x - 0.20, c.z - 0.495) < 0.03
            or math.hypot(c.x - 0.20, c.z - 0.43) < 0.03)
    ):
        idx = 2
    f.material_index = idx
    counts[idx] += 1
print("BODY_FACES body/exit/metal", counts)

# ---------- 3. UV + AO 烘焙 ----------
AO_OBJS = {"Body": 1024, "Lid": 512, "Handle": 512}
for name in AO_OBJS:
    o = bpy.data.objects[name]
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")

scene.render.engine = "CYCLES"
scene.cycles.samples = 128
try:
    scene.cycles.device = "GPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception as e:
    print("GPU fallback", e)
# 透明窗不參與遮蔽（AO 只看實體塑膠）
win = bpy.data.objects["Window"]
win.hide_render = True
for o in (top, bot, coin):
    o.hide_render = True
# 地板：讓底部有接地陰影
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "BakeFloor"

for name, res in AO_OBJS.items():
    o = bpy.data.objects[name]
    img = bpy.data.images.new(f"AO_{name}", res, res)
    img.colorspace_settings.name = "Non-Color"
    for slot in o.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.name = "BAKE"
        nt.nodes.active = n
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type="AO", margin=8)
    path = os.path.join(ASSETS, f"ao_{name.lower()}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    for slot in o.material_slots:     # 烘完把貼圖節點拿掉，GLB 不帶它
        nt = slot.material.node_tree
        nt.nodes.remove(nt.nodes["BAKE"])
    print("BAKED", path)

bpy.data.objects.remove(floor)
win.hide_render = False
for o in (top, bot, coin):
    o.hide_render = False

# ---------- 4. 存檔 + 匯出 ----------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "gacha_web.blend"), copy=True)
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(True)
glb = os.path.join(ASSETS, "gacha.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True,
    export_yup=True, export_apply=True,
    export_materials="EXPORT",
)
print("EXPORTED", glb, os.path.getsize(glb))
# claude.ai artifact 不提供 .glb 檔案類型 → 另存一份 base64 文字，網頁讀進來再解碼
import base64
with open(glb, "rb") as f, open(os.path.join(ASSETS, "gacha.b64.txt"), "w") as g:
    g.write(base64.b64encode(f.read()).decode("ascii"))
