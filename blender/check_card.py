# 檢查 card_web.blend 的材質分區：每個材質一個醒目顏色，Workbench 拍正面＋斜前方＋右側
#   blender -b D:/ai/gacha-web/blender/card_web.blend --python D:/ai/gacha-web/blender/check_card.py -- D:/ai/gacha-web/renders/card_check
import bpy, sys, os, mathutils

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(OUT, exist_ok=True)
COL = {"M_Body": (0.75, 0.75, 0.75, 1), "M_Lid": (1, 1, 1, 1), "M_Metal": (0.2, 0.45, 1, 1), "M_ExitDark": (0.05, 0.05, 0.05, 1),
       "M_Board": (1, 0.85, 0.1, 1), "M_Handle": (1, 0.3, 0.3, 1), "M_Window": (0.6, 1, 1, 0.3)}
for m in bpy.data.materials:
    if m.name in COL:
        m.diffuse_color = COL[m.name]
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "MATERIAL"
sc.display.shading.show_object_outline = True
sc.render.resolution_x = sc.render.resolution_y = 800
cd = bpy.data.cameras.new("C")
cd.type = "ORTHO"
cd.ortho_scale = 1.6
cam = bpy.data.objects.new("C", cd)
sc.collection.objects.link(cam)
sc.camera = cam
target = mathutils.Vector((0.05, 0, 0.68))
for name, d in {"front": (0, -1, 0), "persp": (0.9, -1, 0.5), "right": (1, 0, 0)}.items():
    d = mathutils.Vector(d).normalized()
    cam.location = target + d * 5
    look = -d
    up = mathutils.Vector((0, 0, 1))
    right = look.cross(up).normalized()
    tu = right.cross(look)
    cam.matrix_world = mathutils.Matrix.Translation(cam.location) @ mathutils.Matrix((right, tu, -look)).transposed().to_4x4()
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
