# おみくじ箱（D:/_bg/omikuji.blend，使用者 2026-11-21 從 Maya 匯出）量尺寸
#   blender -b D:/_bg/omikuji.blend --python D:/ai/gacha-web/blender/measure_omikuji.py
# 印出：每個零件的世界座標外框、材質、面的分群（法線方向 × 位置），再用射線找洞、格柵、內部空間
import bpy, mathutils, math
from mathutils import Vector

dg = bpy.context.evaluated_depsgraph_get()
objs = [o for o in bpy.data.objects if o.type == 'MESH']
print('=== parts (world, Blender Z-up, front = -Y) ===')
for o in objs:
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    mn = Vector([min(w[i] for w in ws) for i in range(3)])
    mx = Vector([max(w[i] for w in ws) for i in range(3)])
    print(f"{o.name:16s} f={len(o.data.polygons):4d} mats={[m.name for m in o.data.materials]} min={tuple(round(v,4) for v in mn)} max={tuple(round(v,4) for v in mx)}")

# 每個零件：朝上的面（法線 z > 0.9）列出高度與範圍
for o in objs:
    mw = o.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    ups = {}
    for p in o.data.polygons:
        n = (nm @ p.normal).normalized()
        c = mw @ p.center
        key = None
        if n.z > 0.9: key = ('up', round(c.z, 3))
        elif n.z < -0.9: key = ('down', round(c.z, 3))
        elif n.y < -0.9: key = ('front', round(c.y, 3))
        elif n.y > 0.9: key = ('back', round(c.y, 3))
        elif n.x < -0.9: key = ('left', round(c.x, 3))
        elif n.x > 0.9: key = ('right', round(c.x, 3))
        else: key = ('slant', round(n.x, 2), round(n.y, 2), round(n.z, 2))
        vs = [mw @ o.data.vertices[i].co for i in p.vertices]
        b = ups.setdefault(key, [Vector((9, 9, 9)), Vector((-9, -9, -9)), 0, 0.0])
        for v in vs:
            for i in range(3):
                b[0][i] = min(b[0][i], v[i]); b[1][i] = max(b[1][i], v[i])
        b[2] += 1
        b[3] += p.area * mw.median_scale ** 2
    print(f'--- {o.name}')
    for k, (a, b, n, area) in sorted(ups.items(), key=lambda kv: str(kv[0])):
        print(f"  {str(k):34s} n={n:3d} area={area:.4f} x {a.x:.3f}..{b.x:.3f}  y {a.y:.3f}..{b.y:.3f}  z {a.z:.3f}..{b.z:.3f}")


def ray(o, d, maxd=10):
    hit, loc, nor, idx, ob, _ = bpy.context.scene.ray_cast(dg, Vector(o), Vector(d).normalized(), distance=maxd)
    return (ob.name, tuple(round(v, 4) for v in loc), tuple(round(v, 2) for v in nor)) if hit else None

print('=== rays straight down ===')
for x in (-0.55, -0.4, -0.3, -0.2, -0.13, -0.1, 0.0, 0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55):
    for y in (-0.3, -0.1, 0.0, 0.1, 0.2, 0.3):
        r = ray((x, y, 3), (0, 0, -1))
        print(f"  ({x:+.2f},{y:+.2f}) -> {r}")
print('=== rays from the front (-Y) ===')
for x in (-0.55, -0.3, 0.0, 0.2, 0.3, 0.45, 0.55):
    for z in (0.05, 0.3, 0.6, 0.78, 1.0, 1.3):
        print(f"  x {x:+.2f} z {z:.2f} -> {ray((x, -3, z), (0, 1, 0))}")
print('=== rays from the side (+X) inside slats ===')
for y in (-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3):
    print(f"  y {y:+.2f} -> {ray((0.6, y, 0.80), (-1, 0, 0))}")
