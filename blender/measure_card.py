# 量 clatter-1（轉卡機）的各部位：先把 Maya 群組的變換套用到網格（公尺、Z 向上、正面朝 −Y），
# 再把機身的面依「朝向＋深度」分群，印出每群的範圍 → 找窗、投幣板、出卡口、下段內縮面
#   blender -b D:/ai/clatter-1.blend --python D:/ai/gacha-web/blender/measure_card.py
import bpy, mathutils, math
from collections import defaultdict

for o in list(bpy.data.objects):
    if o.type != 'MESH':
        continue
    mw = o.matrix_world.copy()
    o.parent = None
    o.data = o.data.copy()
    o.data.transform(mw)
    o.matrix_world = mathutils.Matrix.Identity(4)

def bbox(vs):
    mn = [min(v[i] for v in vs) for i in range(3)]
    mx = [max(v[i] for v in vs) for i in range(3)]
    return tuple(round(a, 3) for a in mn), tuple(round(b, 3) for b in mx)

for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    vs = [v.co for v in o.data.vertices]
    print(f"OBJ {o.name:16s} bbox {bbox(vs)} faces {len(o.data.polygons)}")
    by_mat = defaultdict(list)
    for f in o.data.polygons:
        by_mat[f.material_index].extend([o.data.vertices[i].co for i in f.vertices])
    for mi, pts in by_mat.items():
        mname = o.data.materials[mi].name if o.data.materials[mi] else None
        print(f"   mat {mi} {mname}: {bbox(pts)}")

body = bpy.data.objects['pTorus2']
me = body.data
dirs = {'-Y(front)': mathutils.Vector((0, -1, 0)), '+Y(back)': mathutils.Vector((0, 1, 0)), '+X': mathutils.Vector((1, 0, 0)), '-X': mathutils.Vector((-1, 0, 0)), '+Z(up)': mathutils.Vector((0, 0, 1)), '-Z(down)': mathutils.Vector((0, 0, -1))}
groups = defaultdict(list)
for f in me.polygons:
    n = f.normal
    best = max(dirs, key=lambda k: n.dot(dirs[k]))
    if n.dot(dirs[best]) < 0.9:
        best = 'slanted'
    axis = {'-Y(front)': 1, '+Y(back)': 1, '+X': 0, '-X': 0, '+Z(up)': 2, '-Z(down)': 2}.get(best)
    depth = round(f.center[axis], 3) if axis is not None else round(f.center.y, 2)
    groups[(best, depth)].append(f)
print("=== face clusters (direction, depth) → bbox, area ===")
for (d, depth), fs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    pts = [me.vertices[i].co for f in fs for i in f.vertices]
    area = sum(f.area for f in fs)
    if area < 1e-4:
        continue
    print(f"{d:10s} depth {depth:7.3f}  n={len(fs):3d} area={area:.4f} bbox={bbox(pts)}")

knob = bpy.data.objects['pCylinder18']
vs = [v.co for v in knob.data.vertices]
print("KNOB bbox", bbox(vs))
c = mathutils.Vector([(min(v[i] for v in vs) + max(v[i] for v in vs)) / 2 for i in range(3)])
print("KNOB center", tuple(round(x, 4) for x in c))
glass = bpy.data.objects['polySurface32']
print("GLASS bbox", bbox([v.co for v in glass.data.vertices]), "normal", tuple(round(x, 3) for x in glass.data.polygons[0].normal))
