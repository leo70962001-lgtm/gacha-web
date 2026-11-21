# おみくじ箱（使用者 2026-11-21 從 Maya 匯出的 D:/_bg/omikuji.blend）→ 網頁用 GLB
#   blender -b D:/_bg/omikuji.blend --python D:/ai/gacha-web/blender/build_omikuji_glb.py -- D:/ai/gacha-web
# 跟 build_card_glb.py 同一套：套用 Maya 群組（0.01、90°）→ 公尺、Z 上、正面 −Y；清自訂法線 → 30° 銳邊 → Weighted Normal；
#   依位置分材質；Smart UV → Cycles 烘 AO → web/assets/omikuji.glb ＋ omikuji.b64.txt ＋ ao_omi_*.png
# 模型不動（使用者 2026-10-25：「模型不要改變」），只改名、分材質
# 量測（blender/measure_omikuji.py，2026-11-21）：
#   箱子 x ±0.621、y ±0.408、z 0..0.763；裡面的底板 z 0.051（x ±0.565、y ±0.341）
#   左邊＝玻璃箱：正面玻璃 y −0.386..−0.359、左側玻璃 x −0.604..−0.581、上面玻璃 z 0.716..0.743（x −0.565..0.183）
#     上面玻璃的圓洞：中心 (−0.194, 0)、半徑 0.176；隔板 x 0.184..0.254（頂 z 0.758）
#   右邊＝香油錢箱：木格柵 8 條（x 0.253..0.565、z 0.713..0.750），縫的中心 y −0.2465 −0.1605 −0.0775 0.0065 0.089 0.1695 0.25
#     正面木板 y −0.394（x 0.250..0.572、z 0.069..0.717）；右側木板 x 0.604
#   後面的看板：框 x ±0.5、y 0.349..0.399、z 0.763..1.487；紙 polySurface36 y 0.3524、x ±0.464、z 0.799..1.451
import bpy, mathutils, math, sys, os, base64

ROOT = sys.argv[sys.argv.index("--") + 1]
ASSETS = os.path.join(ROOT, "web", "assets")
os.makedirs(ASSETS, exist_ok=True)

RENAME = {
    "pCube54": "OmiBody",
    "pCube24": "OmiFloor",
    "pCube1": "OmiGlassF",
    "pCube25": "OmiGlassL",
    "polySurface33": "OmiGlassTop",
    "polySurface35": "OmiSign",
    "polySurface36": "OmiPaper",
}

# 木頭（顏色在網頁端照主題換：白木、飴色、朱塗り…）、玻璃、紙
MATS = {
    "M_Body":     dict(base=(0.91, 0.80, 0.60), rough=0.45, metal=0.0, trans=0.0, ior=1.5),
    "M_ExitDark": dict(base=(0.035, 0.035, 0.04), rough=0.6, metal=0.0, trans=0.0, ior=1.5),
    "M_Window":   dict(base=(1.0, 1.0, 1.0), rough=0.03, metal=0.0, trans=1.0, ior=1.52),
    "M_Board":    dict(base=(0.97, 0.96, 0.93), rough=0.7, metal=0.0, trans=0.0, ior=1.5),
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
    if mw.determinant() < 0:  # 負縮放（看板的紙）→ 面翻了，翻回來
        o.data.flip_normals()
    o.matrix_world = mathutils.Matrix.Identity(4)
    o.name = new
    o.data.name = new
for n in ("group10", "Camera", "Light"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])

paper = bpy.data.objects["OmiPaper"]
pn = paper.data.polygons[0].normal
if pn.y > 0:  # 紙要朝正面（−Y）
    paper.data.flip_normals()
print("PAPER_NORMAL", tuple(round(v, 3) for v in paper.data.polygons[0].normal))

# ---------- 2. 法線 ----------
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        if o.data.has_custom_normals:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=math.radians(30))
    if o.name in ("OmiBody", "OmiSign", "OmiFloor"):
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


for n in ("OmiGlassF", "OmiGlassL", "OmiGlassTop"):
    set_single(bpy.data.objects[n], "M_Window")
set_single(bpy.data.objects["OmiSign"], "M_Body")
set_single(bpy.data.objects["OmiFloor"], "M_Body")
set_single(paper, "M_Board")

body = bpy.data.objects["OmiBody"]
body.data.materials.clear()
order = ("M_Body", "M_ExitDark")
for n in order:
    body.data.materials.append(mats[n])
counts = dict.fromkeys(order, 0)
for f in body.data.polygons:
    c = f.center
    name = "M_Body"
    # 香油錢箱的裡面（只從格柵的縫看得到）→ 暗色，縫才看得出是投錢的地方
    if 0.256 < c.x < 0.567 and -0.37 < c.y < 0.37 and 0.06 < c.z < 0.712:
        name = "M_ExitDark"
    f.material_index = order.index(name)
    counts[name] += 1
print("BODY_FACES", counts)

# ---------- 4. UV + AO ----------
AO_OBJS = {"OmiBody": 1024, "OmiSign": 512, "OmiFloor": 512}
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
for n in ("OmiGlassF", "OmiGlassL", "OmiGlassTop"):
    bpy.data.objects[n].hide_render = True
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "BakeFloor"
OUTS = {"OmiBody": "ao_omi_body.png", "OmiSign": "ao_omi_sign.png", "OmiFloor": "ao_omi_floor.png"}
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
    path = os.path.join(ASSETS, OUTS[name])
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    for slot in o.material_slots:
        nt = slot.material.node_tree
        if "BAKE" in nt.nodes:
            nt.nodes.remove(nt.nodes["BAKE"])
    print("BAKED", path)
bpy.data.objects.remove(floor)
for n in ("OmiGlassF", "OmiGlassL", "OmiGlassTop"):
    bpy.data.objects[n].hide_render = False

# ---------- 4b. 木紋 UV（第二組 UV，TEXCOORD_1）----------
#   木紋貼圖＝Poly Haven ash_veneer（CC0，1 m 見方；紋路沿著圖的橫向 u）→ web/assets/tex/wood_ash.webp
#   每個面投影到跟法線垂直的平面，紋路順著這個面比較長的那一邊（橫木橫紋、直柱直紋），1 UV＝1 公尺
from mathutils import Vector as _V
for name in ("OmiBody", "OmiSign", "OmiFloor"):
    me = bpy.data.objects[name].data
    uvl = me.uv_layers.new(name="WoodUV")
    for f in me.polygons:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        cs = [me.vertices[v].co for v in f.vertices]
        ea = max(c[a] for c in cs) - min(c[a] for c in cs)
        eb = max(c[b] for c in cs) - min(c[b] for c in cs)
        if eb > ea:
            a, b = b, a
        for li in f.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co[a], co[b])
    print("WOOD_UV", name, [l.name for l in me.uv_layers])

# ---------- 5. 存檔＋匯出 ----------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "omikuji_web.blend"), copy=True)
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type == "MESH":
        o.select_set(True)
glb = os.path.join(ASSETS, "omikuji.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_materials="EXPORT")
print("EXPORTED", glb, os.path.getsize(glb))
with open(glb, "rb") as f, open(os.path.join(ASSETS, "omikuji.b64.txt"), "w") as g:
    g.write(base64.b64encode(f.read()).decode("ascii"))
