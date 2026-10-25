# 看 clatter-1.blend 裡有什麼：物件、階層、變換、尺寸、面數、材質；再從四個方向拍 Workbench 圖
#   blender -b D:/ai/clatter-1.blend --python D:/ai/gacha-web/blender/inspect_card.py -- D:/ai/gacha-web/renders/card_inspect
import bpy, sys, os, math, mathutils

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene

print("=== objects ===")
for o in bpy.data.objects:
    d = o.dimensions
    info = f"{o.name:28s} type={o.type:6s} parent={(o.parent.name if o.parent else '-'):14s} loc={tuple(round(v,3) for v in o.location)} rot={tuple(round(math.degrees(v),1) for v in o.rotation_euler)} scale={tuple(round(v,4) for v in o.scale)} dim={tuple(round(v,3) for v in d)}"
    if o.type == 'MESH':
        me = o.data
        info += f" v={len(me.vertices)} f={len(me.polygons)} mats={[m.name if m else None for m in me.materials]} uv={len(me.uv_layers)} cn={me.has_custom_normals}"
    print(info)

# 世界座標外框
mn = mathutils.Vector((1e9, 1e9, 1e9)); mx = -mn
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
print("world bbox min", tuple(round(v, 3) for v in mn), "max", tuple(round(v, 3) for v in mx))

# 四個方向的 Workbench 圖
center = (mn + mx) / 2
size = max(mx - mn)
cam_data = bpy.data.cameras.new("InspCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = size * 1.25
cam = bpy.data.objects.new("InspCam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_cavity = True
sc.display.shading.show_object_outline = True
sc.render.resolution_x = 900
sc.render.resolution_y = 900
up_axis = 'Z' if (mx.z - mn.z) >= (mx.y - mn.y) else 'Y'
print("up axis guess", up_axis)
views = {
    "front": mathutils.Vector((0, -1, 0)) if up_axis == 'Z' else mathutils.Vector((0, 0, 1)),
    "side": mathutils.Vector((1, 0, 0)),
    "back": mathutils.Vector((0, 1, 0)) if up_axis == 'Z' else mathutils.Vector((0, 0, -1)),
    "top": mathutils.Vector((0, 0, 1)) if up_axis == 'Z' else mathutils.Vector((0, 1, 0)),
    "persp": mathutils.Vector((0.8, -1, 0.6)).normalized() if up_axis == 'Z' else mathutils.Vector((0.8, 0.6, 1)).normalized(),
}
for name, d in views.items():
    cam.location = center + d * size * 3
    up = mathutils.Vector((0, 0, 1)) if up_axis == 'Z' else mathutils.Vector((0, 1, 0))
    if abs(d.dot(up)) > 0.99:
        up = mathutils.Vector((0, 1, 0)) if up_axis == 'Z' else mathutils.Vector((0, 0, -1))
    rot = (center - cam.location).to_track_quat('-Z', 'Y' if False else 'Y')
    # 讓相機上方對準 up
    look = (center - cam.location).normalized()
    right = look.cross(up).normalized()
    true_up = right.cross(look).normalized()
    m = mathutils.Matrix((right, true_up, -look)).transposed()
    cam.matrix_world = mathutils.Matrix.Translation(cam.location) @ m.to_4x4()
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
print("done")
