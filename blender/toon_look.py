# 轉蛋機的 Toon（卡通渲染）版本，跟網頁同一套看法
#   blender -b D:/ai/gacha-web/blender/gacha_web.blend --python toon_look.py -- D:/ai/gacha-web
# 做的事：
#   1. 每個材質換成 toon：Diffuse → Shader to RGB → ColorRamp（常數三階）× 底色 → Emission
#      （Shader to RGB 只有 EEVEE 能用）
#   2. 描邊：Solidify 反向殼（翻法線、背面剔除的深藍材質）＝網頁的 inverted hull
#   3. 透明窗、扭蛋上半：透明＋邊緣深藍線（Layer Weight 的 Facing → 常數 ColorRamp）
#   4. Gemini 貼圖貼在側面、上蓋、台紙位置（跟網頁 machine.js 的座標一樣）
#   5. 存 blender/gacha_toon.blend，EEVEE 算一張 renders/toon_preview.png
import bpy, math, os, sys, mathutils

ROOT = sys.argv[sys.argv.index("--") + 1]
TEX = os.path.join(ROOT, "web", "assets", "tex")
INK = (0.011, 0.016, 0.05, 1)  # #1c2340 線性值
COLORS = {  # 跟網頁 THEMES.red 一樣（sRGB → 線性）
    "M_Body": "#d8262c", "M_Lid": "#f3f1ec", "M_Handle": "#f3f1ec",
    "M_ExitDark": "#23283a", "M_Metal": "#c9d1dc", "M_CapColor": "#f6b91a", "M_Coin": "#f2b630",
}


def lin(hexs):
    h = hexs.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def node(nt, t, loc):
    n = nt.nodes.new(t)
    n.location = loc
    return n


def toon_material(m, base, tex_img=None):
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial", (600, 0))
    dif = node(nt, "ShaderNodeBsdfDiffuse", (-600, 0))
    s2r = node(nt, "ShaderNodeShaderToRGB", (-400, 0))
    ramp = node(nt, "ShaderNodeValToRGB", (-200, 0))
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.42, 0.42, 0.45, 1)   # 暗部（帶一點藍）
    els[1].position, els[1].color = 0.25, (0.72, 0.72, 0.74, 1)  # 半影
    e = els.new(0.45)
    e.color = (1, 1, 1, 1)                                      # 受光
    mul = node(nt, "ShaderNodeMix", (100, 0))
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    color_in = [s for s in mul.inputs if s.type == "RGBA" and s.enabled]
    if tex_img:
        ti = node(nt, "ShaderNodeTexImage", (-200, -260))
        ti.image = tex_img
        nt.links.new(ti.outputs["Color"], color_in[1])
    else:
        color_in[1].default_value = base
    em = node(nt, "ShaderNodeEmission", (350, 0))
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], color_in[0])
    res = [s for s in mul.outputs if s.type == "RGBA" and s.enabled][0]
    nt.links.new(res, em.inputs["Color"])
    if tex_img:  # 貼紙有透明 → 混透明
        mix = node(nt, "ShaderNodeMixShader", (480, 0))
        tr = node(nt, "ShaderNodeBsdfTransparent", (350, -150))
        nt.links.new(ti.outputs["Alpha"], mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        m.surface_render_method = "BLENDED"
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])


def toon_glass(m, tint, alpha):
    nt = m.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputMaterial", (600, 0))
    lw = node(nt, "ShaderNodeLayerWeight", (-500, 0))
    lw.inputs["Blend"].default_value = 0.5
    ramp = node(nt, "ShaderNodeValToRGB", (-300, 0))  # Facing → 透明度：中間透明、邊緣變線
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (alpha, alpha, alpha, 1)
    els[1].position, els[1].color = 0.55, (0.45, 0.45, 0.45, 1)
    e = els.new(0.9)
    e.color = (1, 1, 1, 1)
    col = node(nt, "ShaderNodeValToRGB", (-300, -250))  # Facing → 顏色：白帶、邊緣深藍
    col.color_ramp.interpolation = "CONSTANT"
    c = col.color_ramp.elements
    c[0].position, c[0].color = 0.0, tint
    c[1].position, c[1].color = 0.55, (1, 1, 1, 1)
    e = c.new(0.9)
    e.color = INK
    em = node(nt, "ShaderNodeEmission", (0, -200))
    tr = node(nt, "ShaderNodeBsdfTransparent", (0, 100))
    mix = node(nt, "ShaderNodeMixShader", (300, 0))
    nt.links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
    nt.links.new(lw.outputs["Facing"], col.inputs["Fac"])
    nt.links.new(col.outputs["Color"], em.inputs["Color"])
    nt.links.new(ramp.outputs["Color"], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    m.use_backface_culling = True


# ---------- 1. 材質 ----------
for name, hexs in COLORS.items():
    toon_material(bpy.data.materials[name], lin(hexs))
toon_glass(bpy.data.materials["M_Window"], (0.86, 0.94, 1.0, 1), 0.04)
toon_glass(bpy.data.materials["M_CapClear"], (1, 1, 1, 1), 0.15)

# ---------- 2. 描邊 ----------
outline = bpy.data.materials.new("M_Outline")
outline.use_backface_culling = True
nt = outline.node_tree
nt.nodes.clear()
o_out = node(nt, "ShaderNodeOutputMaterial", (300, 0))
o_em = node(nt, "ShaderNodeEmission", (0, 0))
o_em.inputs["Color"].default_value = INK
nt.links.new(o_em.outputs[0], o_out.inputs["Surface"])
for obj, w in (("Body", 0.0045), ("Lid", 0.0045), ("Handle", 0.005), ("CapsuleBottom", 0.0045), ("Coin", 0.002)):
    o = bpy.data.objects[obj]
    o.data.materials.append(outline)
    mod = o.modifiers.new("Toon_Outline", "SOLIDIFY")
    mod.thickness = -w if False else w  # 往外長
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(o.data.materials) - 1

# ---------- 3. Gemini 貼圖 ----------
def decal(name, img, w, h, loc, rot_z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    p = bpy.context.active_object
    p.name = name
    p.scale = (w, h, 1)
    # 網頁座標（Y 上、+Z 前）→ Blender（Z 上、−Y 前）
    x, y, z = loc
    p.location = (x, -z, y)
    p.rotation_euler = (math.pi / 2, 0, rot_z)
    m = bpy.data.materials.new("M_" + name)
    toon_material(m, (1, 1, 1, 1), bpy.data.images.load(os.path.join(TEX, img)))
    p.data.materials.append(m)
    return p


decal("Decal_SideR", "side.webp", 0.66, 0.56, (0.3535, 0.37, -0.06), math.pi / 2)
decal("Decal_SideL", "side.webp", 0.66, 0.56, (-0.3535, 0.37, -0.06), -math.pi / 2)
decal("Decal_StripR", "strip.webp", 0.24, 0.48, (0.3535, 0.99, -0.3), math.pi / 2)
decal("Decal_StripL", "strip.webp", 0.24, 0.48, (-0.3535, 0.99, -0.3), -math.pi / 2)
decal("Decal_Lid", "banner.webp", 0.66, 0.082, (0, 1.319, 0.4225))
decal("Decal_Card", "card.webp", 0.68, 0.45, (0, 1.035, -0.117))
decal("Decal_Badge", "badge.webp", 0.13, 0.13, (-0.272, 0.402, 0.359))

# 窗裡放幾顆扭蛋（同一組幾何，換顏色）
top = bpy.data.objects["CapsuleTop"]
bot = bpy.data.objects["CapsuleBottom"]
k = 0.065 / 0.113
cols = ["#e8423b", "#f6b91a", "#2f7fe0", "#36c18f", "#ef6fa8", "#f08a24", "#8a5cd6", "#4cc3e6"]
import random
random.seed(3)
spots = [(-0.26, -0.05), (-0.13, -0.08), (0, -0.05), (0.13, -0.08), (0.26, -0.05),
         (-0.2, 0.06), (-0.07, 0.08), (0.06, 0.06), (0.19, 0.08), (-0.2, -0.18), (0.05, -0.2), (0.24, -0.19)]
for i, (x, zf) in enumerate(spots):
    layer = 0.724 + 0.065 + (0.11 if i >= 5 and i < 9 else 0.0)
    for src, tag in ((top, "T"), (bot, "B")):
        c = src.copy()
        c.data = src.data if tag == "T" else src.data.copy()
        c.name = f"Cap{i:02d}{tag}"
        c.scale = (k, k, k)
        c.location = (x, -(zf + 0.12), layer)
        c.rotation_euler = (random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(0, 6))
        bpy.context.scene.collection.objects.link(c)
        if tag == "B":
            m = bpy.data.materials["M_CapColor"].copy()
            toon_material(m, lin(cols[i % len(cols)]))
            c.data.materials[0] = m
top.hide_render = bot.hide_render = True
bpy.data.objects["Coin"].hide_render = True

# ---------- 4. 場景 ----------
sc = bpy.context.scene
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.view_settings.view_transform = "Standard"  # toon：顏色照原樣
sc.render.resolution_x, sc.render.resolution_y = 900, 1100
w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
sc.world = w
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = lin("#dce8ef")
bg.inputs[1].default_value = 0.25
# 鏡頭看到的背景用原色（強度 1），照明只用 0.25 → 背景不會變暗
wnt = w.node_tree
lp = wnt.nodes.new("ShaderNodeLightPath")
bg_cam = wnt.nodes.new("ShaderNodeBackground")
bg_cam.inputs[0].default_value = lin("#dce8ef")
bg_cam.inputs[1].default_value = 1.0
wmix = wnt.nodes.new("ShaderNodeMixShader")
wout = next(n for n in wnt.nodes if n.type == "OUTPUT_WORLD")
wnt.links.new(lp.outputs["Is Camera Ray"], wmix.inputs[0])
wnt.links.new(bg.outputs[0], wmix.inputs[1])
wnt.links.new(bg_cam.outputs[0], wmix.inputs[2])
wnt.links.new(wmix.outputs[0], wout.inputs["Surface"])
sun = bpy.data.lights.new("Key", "SUN")
sun.energy = 2.2
sun.angle = math.radians(2)
so = bpy.data.objects.new("Key", sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(-35))
cam_d = bpy.data.cameras.new("Cam")
cam_d.lens = 50
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
cam.location = (1.45, -3.0, 1.55)
cam.rotation_euler = (mathutils.Vector((0, 0, 0.68)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
bpy.ops.mesh.primitive_plane_add(size=8)
fl = bpy.context.active_object
fl.name = "Floor"
fm = bpy.data.materials.new("M_Floor")
toon_material(fm, lin("#d2e0e8"))
fl.data.materials.append(fm)

os.makedirs(os.path.join(ROOT, "renders"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "gacha_toon.blend"))
sc.render.filepath = os.path.join(ROOT, "renders", "toon_preview.png")
bpy.ops.render.render(write_still=True)
print("TOON_DONE", sc.render.filepath)
