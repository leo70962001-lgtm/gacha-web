# 材質檢查：開 gacha_web.blend，加簡單攝影棚燈，Cycles 渲染正面斜角
#   blender -b D:/ai/gacha-web/blender/gacha_web.blend --python check_render.py -- <out.png>
import bpy, sys, mathutils, os

out = sys.argv[sys.argv.index("--") + 1]
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 800, 1000
sc.view_settings.view_transform = "AgX"
for o in bpy.data.objects:
    if o.type == "MESH":
        mw = o.matrix_world.translation
# 機身染成主題色（紅），把手/蓋子白
for n, col in (("M_Body", (0.75, 0.06, 0.08)), ("M_Lid", (0.9, 0.9, 0.88)), ("M_Handle", (0.95, 0.85, 0.2))):
    b = next(x for x in bpy.data.materials[n].node_tree.nodes if x.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
w = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
sc.world = w
next(x for x in w.node_tree.nodes if x.type == "BACKGROUND").inputs[0].default_value = (0.5, 0.52, 0.56, 1)
next(x for x in w.node_tree.nodes if x.type == "BACKGROUND").inputs[1].default_value = 0.6
bpy.ops.mesh.primitive_plane_add(size=8)
cam_data = bpy.data.cameras.new("C")
cam_data.lens = 50
cam = bpy.data.objects.new("C", cam_data)
sc.collection.objects.link(cam)
cam.location = (1.6, -3.2, 1.4)
cam.rotation_euler = (mathutils.Vector((0, 0, 0.65)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
for loc, e, s in (((-2, -2.5, 3), 600, 2.0), ((2.5, -1, 2), 250, 1.5), ((0, 3, 3), 300, 2.0)):
    ld = bpy.data.lights.new("L", "AREA")
    ld.energy, ld.size = e, s
    lo = bpy.data.objects.new("L", ld)
    sc.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (mathutils.Vector((0, 0, 0.6)) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
