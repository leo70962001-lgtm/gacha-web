# 轉卡機模型（clatter-1.blend）→ 網頁用 GLB
#   blender -b D:/ai/clatter-1.blend --python D:/ai/gacha-web/blender/build_card_glb.py -- D:/ai/gacha-web
# 跟 build_glb.py 同一套做法：
#   1. 套用 Maya 群組（縮放 0.01、旋轉 90°）→ 公尺、Z 向上、正面朝 −Y；零件改名
#   2. 清 Maya 自訂法線 → 30° 銳邊 → Weighted Normal（大平面平的、圓角才平滑）
#   3. 依位置分材質：機身塑膠、窗框（上蓋色）、投幣板（金屬）、出卡口內部（暗色）、窗後的底板
#   4. Smart UV → Cycles 烘 AO → 匯出 web/assets/card.glb ＋ card.b64.txt ＋ ao_card_*.png
# 量測（blender/measure_card.py，2026-10-25）：
#   機身 x ±0.352、y −0.526..0.41、z 0..1.269；上蓋 z 1.269..1.365
#   上段正面 y −0.418（z 0.483..1.269）；下段往前凸到 y −0.526（z 0..0.397），中間斜面
#   窗：玻璃 y −0.434，x −0.286..0.101、z 0.542..1.236；窗後底板 y −0.422
#   投幣板：x 0.134..0.272、z 0.524..0.916，正面 y −0.433；投幣口小方塊 x 0.189..0.217、z 0.709..0.738、凸到 y −0.462
#   出卡口：外框凹槽 x −0.118..0.112、z 0.348..0.442、深 y −0.526..−0.476；裡面的細縫 x −0.107..0.102、z 0.389..0.397
#   旋鈕：右側面 x 0.352..0.488，中心 (0.420, 0, 0.430)，半徑 0.121，軸＝X
import bpy, mathutils, math, sys, os, base64

ROOT = sys.argv[sys.argv.index("--") + 1]
ASSETS = os.path.join(ROOT, "web", "assets")
os.makedirs(ASSETS, exist_ok=True)

RENAME = {
    "pTorus2": "CardBody",
    "polySurface25": "CardLid",
    "polySurface27": "CardBack",
    "polySurface32": "CardGlass",
    "pCylinder18": "Knob",
}

# 材質：ABS 外殼 IOR 1.53、PC 窗 1.585、鍍鉻投幣板；顏色在網頁端套主題色，這裡給中性色
MATS = {
    "M_Body":     dict(base=(0.86, 0.86, 0.84), rough=0.32, metal=0.0, trans=0.0, ior=1.53),
    "M_Lid":      dict(base=(0.86, 0.86, 0.84), rough=0.30, metal=0.0, trans=0.0, ior=1.53),
    "M_Handle":   dict(base=(0.86, 0.86, 0.84), rough=0.28, metal=0.0, trans=0.0, ior=1.53),
    "M_ExitDark": dict(base=(0.035, 0.035, 0.04), rough=0.55, metal=0.0, trans=0.0, ior=1.53),
    "M_Metal":    dict(base=(0.80, 0.80, 0.80), rough=0.20, metal=1.0, trans=0.0, ior=1.50),
    "M_Window":   dict(base=(1.0, 1.0, 1.0), rough=0.03, metal=0.0, trans=1.0, ior=1.585),
    "M_Board":    dict(base=(0.95, 0.95, 0.95), rough=0.6, metal=0.0, trans=0.0, ior=1.5),
}


def make_mat(name, p):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*p["base"], 1.0)
    bsdf.inputs["Roughness"].default_value = p["rough"]
    bsdf.inputs["Metallic"].default_value = p["metal"]
    bsdf.inputs["Transmission Weight"].default_value = p["trans"]
    bsdf.inputs["IOR"].default_value = p["ior"]
    return m


# ---------- 1. 套用變換、改名 ----------
scene = bpy.context.scene
for old, new in RENAME.items():
    o = bpy.data.objects[old]
    mw = o.matrix_world.copy()
    o.parent = None
    o.data = o.data.copy()
    o.data.transform(mw)
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.name = new
    o.data.name = new
for n in ("group9", "Camera", "Light"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])

# 旋鈕：原點放在中心（網頁端繞 X 軸轉）
knob = bpy.data.objects["Knob"]
vs = [v.co for v in knob.data.vertices]
kc = mathutils.Vector([(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)])
knob.data.transform(mathutils.Matrix.Translation(-kc))
knob.location = kc
print("KNOB_CENTER", tuple(round(x, 4) for x in kc))

# ---------- 2. 法線 ----------
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        if o.data.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=math.radians(30))
    if o.name in ("CardBody", "CardLid", "Knob", "CardBack"):
        wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        wn.mode = "FACE_AREA"
        wn.weight = 50
        wn.keep_sharp = True
print("CUSTOM_NORMALS_LEFT", [o.name for o in bpy.data.objects if o.type == "MESH" and o.data.has_custom_normals])

# ---------- 3. 材質 ----------
mats = {k: make_mat(k, v) for k, v in MATS.items()}


def set_single(o, mname):
    o.data.materials.clear()
    o.data.materials.append(mats[mname])


set_single(bpy.data.objects["CardGlass"], "M_Window")
set_single(bpy.data.objects["CardLid"], "M_Lid")
set_single(bpy.data.objects["CardBack"], "M_Body")
set_single(knob, "M_Handle")

body = bpy.data.objects["CardBody"]
old_names = [m.name if m else "" for m in body.data.materials]
old_idx = [f.material_index for f in body.data.polygons]
body.data.materials.clear()
order = ("M_Body", "M_Lid", "M_Metal", "M_ExitDark", "M_Board")
for n in order:
    body.data.materials.append(mats[n])
counts = dict.fromkeys(order, 0)
for f, oi in zip(body.data.polygons, old_idx):
    c = f.center
    name = "M_Body"
    framed = old_names[oi] == "lambert1"     # Maya 那邊標成 lambert1 的＝窗框＋投幣板
    if framed and c.x > 0.125:
        name = "M_Metal"                     # 投幣板（含投幣口、退幣桿）
    elif framed:
        name = "M_Lid"                       # 窗框：跟上蓋同色
    # 窗後的底板（台紙貼在它前面）
    if abs(c.y + 0.422) < 0.002 and -0.29 < c.x < 0.105 and 0.53 < c.z < 1.24:
        name = "M_Board"
    # 出卡口：凹槽內側＋細縫（正面那圈不算）
    if -0.12 < c.x < 0.114 and 0.345 < c.z < 0.445 and c.y > -0.524:
        name = "M_ExitDark"
    f.material_index = order.index(name)
    counts[name] += 1
print("BODY_FACES", counts)

# ---------- 4. UV + AO ----------
AO_OBJS = {"CardBody": 1024, "CardLid": 512, "Knob": 512}
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
glass = bpy.data.objects["CardGlass"]
glass.hide_render = True
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
    path = os.path.join(ASSETS, {"CardBody": "ao_card_body.png", "CardLid": "ao_card_lid.png", "Knob": "ao_card_knob.png"}[name])
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    for slot in o.material_slots:
        nt = slot.material.node_tree
        if "BAKE" in nt.nodes:
            nt.nodes.remove(nt.nodes["BAKE"])
    print("BAKED", path)
bpy.data.objects.remove(floor)
glass.hide_render = False

# ---------- 5. 存檔＋匯出 ----------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "card_web.blend"), copy=True)
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(True)
glb = os.path.join(ASSETS, "card.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_materials="EXPORT")
print("EXPORTED", glb, os.path.getsize(glb))
with open(glb, "rb") as f, open(os.path.join(ASSETS, "card.b64.txt"), "w") as g:
    g.write(base64.b64encode(f.read()).decode("ascii"))
