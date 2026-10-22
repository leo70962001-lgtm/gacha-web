# 法線查證：每個面「頂點法線」和「面本身的法線」差幾度
#   blender -b D:/ai/gacha-web/blender/gacha_web.blend --python normal_check.py -- <out_dir> [wn]
#   wn：先加 Weighted Normal 修改器（面積加權、保留銳邊）再量，用來比較修正前後
# 平的大面（例如機身正面）頂點法線應該跟面法線一樣（0°）；
# 如果邊角的圓角把旁邊大面的頂點法線拉歪，toon 的硬色階就會在大面中間切出一條暗帶。
# 輸出：<out_dir>/normal_dev[_wn].png（熱圖，鏡頭＝網頁的斜前方）、normal_dev[_wn].json（統計）
import bpy, bmesh, math, sys, os, json, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
WN = len(argv) > 1 and argv[1] == "wn"
os.makedirs(OUT, exist_ok=True)
tag = "_wn" if WN else ""

OBJS = ["Body", "Lid", "Handle"]
if WN:
    for n in OBJS:
        m = bpy.data.objects[n].modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        m.mode = "FACE_AREA"
        m.weight = 50
        m.keep_sharp = True

dg = bpy.context.evaluated_depsgraph_get()
stats = {}


def colormap(d):
    # 0° 白 → 5° 黃 → 15° 橘 → 30°+ 紅
    stops = [(0, (1, 1, 1)), (5, (1, 0.9, 0.2)), (15, (1, 0.45, 0.05)), (30, (0.8, 0.0, 0.0))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if d <= b:
            k = (d - a) / (b - a)
            return tuple(ca[i] + (cb[i] - ca[i]) * k for i in range(3)) + (1.0,)
    return stops[-1][1] + (1.0,)


for name in OBJS:
    o = bpy.data.objects[name]
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    cn = me.corner_normals
    rows = []
    devs = []
    for poly in me.polygons:
        fn = poly.normal
        dmax = 0.0
        for li in poly.loop_indices:
            v = cn[li].vector
            dmax = max(dmax, math.degrees(fn.angle(v, 0.0)))
        devs.append(dmax)
        rows.append((poly.area, dmax, tuple(round(c, 3) for c in (o.matrix_world @ poly.center)), tuple(round(c, 2) for c in fn)))
    area = sum(r[0] for r in rows)
    big = [r for r in rows if r[0] > 0.004]  # 大面（> 40 cm²）
    stats[name] = {
        "faces": len(rows),
        "area_m2": round(area, 4),
        "area_dev_gt5": round(sum(r[0] for r in rows if r[1] > 5) / area, 3),
        "area_dev_gt15": round(sum(r[0] for r in rows if r[1] > 15) / area, 3),
        "big_faces": len(big),
        "big_faces_dev_gt5": sum(1 for r in big if r[1] > 5),
        "worst_big": sorted(big, key=lambda r: -r[1])[:8],
    }
    # 熱圖：面角落顏色
    col = me.color_attributes.new("dev", "BYTE_COLOR", "CORNER")
    for poly, d in zip(me.polygons, devs):
        c = colormap(d)
        for li in poly.loop_indices:
            col.data[li].color = c
    me.color_attributes.active_color = col
    o.modifiers.clear()
    o.data = me

print("NORMAL_STATS", json.dumps(stats, ensure_ascii=False))
with open(os.path.join(OUT, f"normal_dev{tag}.json"), "w") as f:
    json.dump(stats, f, indent=1)

# 熱圖渲染：Workbench、平光、顯示屬性顏色；鏡頭＝網頁預設角度（機台轉 −0.32 rad → 看到右側面）
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "FLAT"
sh.color_type = "VERTEX"
sh.show_object_outline = True
sh.show_cavity = False
sc.render.resolution_x, sc.render.resolution_y = 800, 1000
for o in bpy.data.objects:
    if o.type == "MESH" and o.name not in OBJS:
        o.hide_render = True
cam_d = bpy.data.cameras.new("C")
cam_d.sensor_fit = "VERTICAL"
cam_d.angle = math.radians(30)
cam = bpy.data.objects.new("C", cam_d)
sc.collection.objects.link(cam)
target = mathutils.Vector((0, -0.05, 0.66))
dirv = mathutils.Vector((0.301, -0.909, 0.287)).normalized()
cam.location = target + dirv * 3.1
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sc.render.filepath = os.path.join(OUT, f"normal_dev{tag}.png")
bpy.ops.render.render(write_still=True)
print("SAVED", sc.render.filepath)
