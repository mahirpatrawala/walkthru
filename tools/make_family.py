"""Builds the walkthru family (SPEC 16.6, revised 13 Nov 2026): Man, Woman, Elderly parent, Child.

    blender -b -P tools/make_family.py -- --out <dir> [--only man,woman,elder,child] [--preview <dir>]

Needs the MPFB2 add-on (extension id "mpfb", 2.0.18) enabled and MakeHuman's CC0 system asset pack installed (see
people.lock.json). MPFB2 is GPL and is only a tool here: nothing of it ships. The bodies are MakeHuman base meshes
(CC0 for the meshes and the rig weights), made stylised: smooth flat colours with no photographic skin texture, a
slightly larger head, bead eyes, simple brows, and every garment and hairstyle built here from the body's own shape
(measured cross-sections, lofted), so nothing in the clothes is a third-party asset except the shoes (system asset
`shoes05`, CC0) and the eyes and brows (system assets, CC0).

Pipeline per person: macro-shape the MPFB human (age, gender, weight) -> add the game_engine rig -> eyes, brows, shoes
-> clean up helper geometry -> T-pose (the clips are retargeted against a T-pose, see src/look/retarget.ts) with the
head scaled and, for the elder, the spine bent -> ground -> build clothes and hair from the baked skin -> copy skin
weights -> join one mesh per role (skin, eyes, brows, top, bottom, wrap, trim, hair, shoes) -> export a raw GLB.
tools/optimise-people.mjs then decimates and compresses it.
"""
import bpy, sys, os, json, math, bmesh, importlib
import numpy as np
from mathutils import Vector, Matrix, kdtree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

OUT = os.path.abspath(arg('--out', 'public/characters/src'))
PREVIEW = arg('--preview')
THUMBS = arg('--thumbs')
ONLY = arg('--only')
REST_JSON = arg('--mannequin-rest', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mannequin-rest.json'))
os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)

EXT = 'bl_ext.user_default.mpfb'
bpy.ops.preferences.addon_enable(module=EXT)
svc = importlib.import_module(EXT + '.services')
HumanService, LocationService, TargetService = svc.HumanService, svc.LocationService, svc.TargetService
DATA = LocationService.get_user_data()

def asset(kind, name):
    p = os.path.join(DATA, kind, name, name + '.mhclo')
    if not os.path.isfile(p):
        raise SystemExit('system asset %s/%s is missing. Present: %s' % (kind, name, ', '.join(sorted(os.listdir(os.path.join(DATA, kind))))))
    return p

# age macro: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90
PEOPLE = {
    'man':   dict(gender=1.0, age=0.60, weight=0.58, muscle=0.5, file='person-man',   outfit='kurta', hair='crop',     stoop=0.0, head=1.10),
    'woman': dict(gender=0.0, age=0.57, weight=0.50, muscle=0.5, file='person-woman', outfit='salwar', hair='braid',    stoop=0.0, head=1.10),
    'elder': dict(gender=0.0, age=0.90, weight=0.50, muscle=0.4, file='person-elder', outfit='saree',  hair='bun',      stoop=1.0, head=1.10),
    'child': dict(gender=0.2, age=0.125, weight=0.42, muscle=0.5, file='person-child', outfit='kids',   hair='pigtails', stoop=0.0, head=1.22),
}

# ---------------------------------------------------------------- body

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module=EXT)

def build_body(key, spec):
    clear_scene()
    macro = TargetService.get_default_macro_info_dict()
    macro.update(gender=spec['gender'], age=spec['age'], weight=spec['weight'], muscle=spec['muscle'])
    base = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True,
                                     feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    base.name = key + '-body'
    rig = HumanService.add_builtin_rig(base, 'game_engine', import_weights=True)
    parts = []
    def add(kind, name, atype):
        o = HumanService.add_mhclo_asset(asset(kind, name), base, asset_type=atype, material_type='GAMEENGINE',
                                         subdiv_levels=0, set_up_rigging=True, interpolate_weights=True, import_weights=True)
        parts.append(o)
        return o
    add('eyes', 'high-poly', 'Eyes')
    add('eyebrows', 'eyebrow001', 'Eyebrows')
    add('clothes', 'shoes05', 'Clothes')
    return base, rig, parts

def finish_body(base, parts):
    """Bake the macro shape keys, keep only the visible skin (drop helper geometry and the faces under the shoes)."""
    bpy.context.view_layer.objects.active = base
    base.select_set(True)
    if base.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(base.modifiers):
        if m.type != 'ARMATURE':
            base.modifiers.remove(m)
    vg = base.vertex_groups
    body_idx = vg['body'].index
    delete_idx = [g.index for g in vg if g.name.startswith('Delete.')]
    bm = bmesh.new()
    bm.from_mesh(base.data)
    dl = bm.verts.layers.deform.verify()
    kill = []
    for v in bm.verts:
        w = v[dl]
        if w.get(body_idx, 0.0) <= 0.5 or any(w.get(i, 0.0) > 0.5 for i in delete_idx):
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(base.data)
    bm.free()
    for g in list(base.vertex_groups):
        if g.name.startswith(('Delete.', 'helper-', 'joint-')) or g.name in ('body', 'Mid', 'Left', 'Right', 'HelperGeometry', 'JointCubes'):
            base.vertex_groups.remove(g)
    for o in parts:
        for m in list(o.modifiers):
            if m.type != 'ARMATURE':
                o.modifiers.remove(m)

# ---------------------------------------------------------------- T-pose (see tools/make_people.py history for the reasoning)
# Our six clips are authored on the mannequin (a Rigify-style T-pose rig). MPFB's rig rests in an A-pose with a
# different bone roll on every bone. The clips are retargeted at run time by applying each bone's world-space change
# to the target's rest pose (src/look/retarget.ts), which only works when both rigs rest in the same pose. So the body
# is re-posed here: each limb bone is swung (minimal rotation, roll untouched) until it points where the mannequin's
# does, then that pose is baked into the mesh and made the rig's rest pose.
SRC = {
    'spine_01': ('DEF-spine.001', 'DEF-spine.002'), 'spine_02': ('DEF-spine.002', 'DEF-spine.003'),
    'spine_03': ('DEF-spine.003', 'DEF-neck'), 'neck_01': ('DEF-neck', 'DEF-head'), 'head': ('DEF-neck', 'DEF-head'),
}
for side, S in (('l', 'L'), ('r', 'R')):
    for mb, sb, sc in [('upperarm', 'upper_arm', 'forearm'), ('lowerarm', 'forearm', 'hand'), ('hand', 'hand', 'f_middle.01')]:
        SRC['%s_%s' % (mb, side)] = ('DEF-%s.%s' % (sb, S), 'DEF-%s.%s' % (sc, S))
    for f in ('index', 'middle', 'ring', 'pinky'):
        for i in (1, 2):
            SRC['%s_0%d_%s' % (f, i, side)] = ('DEF-f_%s.0%d.%s' % (f, i, S), 'DEF-f_%s.0%d.%s' % (f, i + 1, S))
        SRC['%s_03_%s' % (f, side)] = ('DEF-f_%s.02.%s' % (f, S), 'DEF-f_%s.03.%s' % (f, S))
    for i in (1, 2):
        SRC['thumb_0%d_%s' % (i, side)] = ('DEF-thumb.0%d.%s' % (i, S), 'DEF-thumb.0%d.%s' % (i + 1, S))
    SRC['thumb_03_%s' % side] = ('DEF-thumb.02.%s' % S, 'DEF-thumb.03.%s' % S)
    SRC['thigh_' + side] = ('DEF-thigh.' + S, 'DEF-shin.' + S)
    SRC['calf_' + side] = ('DEF-shin.' + S, 'DEF-foot.' + S)
    SRC['foot_' + side] = ('DEF-foot.' + S, 'DEF-toe.' + S)
    SRC['ball_' + side] = ('DEF-foot.' + S, 'DEF-toe.' + S)

def to_blender(v):  # glTF (x, y, z) Y-up, +Z forward  ->  Blender (x, -z, y)
    return Vector((v[0], -v[2], v[1]))

def depth(b):
    d = 0
    while b.parent:
        b, d = b.parent, d + 1
    return d

def swing(rig, pb, q):
    m = pb.matrix.copy()
    loc = m.translation.copy()
    rot = q.to_matrix().to_4x4() @ m
    rot.translation = loc
    pb.matrix = rot

def tpose(rig, meshes, spec):
    rest = json.load(open(REST_JSON))
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for pb in sorted(rig.pose.bones, key=depth):
        if pb.name not in SRC:
            continue
        a, b = SRC[pb.name]
        want = (to_blender(rest[b]) - to_blender(rest[a])).normalized()
        bpy.context.view_layer.update()
        cur = ((rig.matrix_world @ pb.tail) - (rig.matrix_world @ pb.head)).normalized()
        swing(rig, pb, cur.rotation_difference(want))
    # stoop: bend the spine forward about the world X axis (forward is -Y, so +X rotation pitches the torso forward),
    # and give the neck and head back part of it so the elder still looks ahead
    st = spec['stoop']
    if st:
        for name, deg in (('spine_01', 5), ('spine_02', 7), ('spine_03', 6), ('neck_01', -6), ('head', -6)):
            bpy.context.view_layer.update()
            swing(rig, rig.pose.bones[name], Matrix.Rotation(math.radians(deg * st), 3, 'X').to_quaternion())
    # the mannequin's neck leans 11 degrees forward; give the face back 7 of them so people look ahead, not down
    for name, deg in (('neck_01', -3), ('head', -4)):
        bpy.context.view_layer.update()
        swing(rig, rig.pose.bones[name], Matrix.Rotation(math.radians(deg), 3, 'X').to_quaternion())
    if spec['head'] != 1.0:
        bpy.context.view_layer.update()
        pb = rig.pose.bones['head']
        pb.scale = (spec['head'],) * 3
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            if m.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        m = o.modifiers.new('Armature', 'ARMATURE')
        m.object = rig

def ground(rig, objs):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    low = 1e9
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        low = min(low, min((mw @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
    rig.location.z -= low
    bpy.context.view_layer.update()

# ---------------------------------------------------------------- measuring the body

class Body:
    """World-space skin vertices with their dominant bone, and the bone landmarks the garments are measured from."""
    def __init__(self, base, rig):
        self.base, self.rig = base, rig
        me = base.data
        mw = base.matrix_world
        self.V = np.array([tuple(mw @ v.co) for v in me.vertices])
        names = {g.index: g.name for g in base.vertex_groups if g.name in rig.data.bones}
        self.dom = []
        self.weights = []
        for v in me.vertices:
            ws = sorted(((g.weight, names[g.group]) for g in v.groups if g.group in names), reverse=True)
            self.weights.append(ws[:4])
            self.dom.append(ws[0][1] if ws else '')
        self.dom = np.array(self.dom)
        self.bone = {}
        for b in rig.data.bones:
            self.bone[b.name] = (np.array(rig.matrix_world @ b.head_local), np.array(rig.matrix_world @ b.tail_local))
        self.zmin, self.zmax = float(self.V[:, 2].min()), float(self.V[:, 2].max())
        self.H = self.zmax - self.zmin
        # which side of x is "l": the bone's own side
        self.sx = 1.0 if self.bone['thigh_l'][0][0] > 0 else -1.0
        self.tree = kdtree.KDTree(len(self.V))
        for i, p in enumerate(self.V):
            self.tree.insert(Vector(p), i)
        self.tree.balance()
        arm = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'pinky', 'ring', 'thumb')
        self.is_arm = np.array([d.startswith(arm) for d in self.dom])
        self.is_head = np.array([d == 'head' for d in self.dom])
        self.is_foot = np.array([d.startswith(('foot', 'ball')) for d in self.dom])
        self.side = {'l': self.sx, 'r': -self.sx}
        self.z_hip = float(self.bone['thigh_l'][0][2])
        self.z_knee = float(self.bone['calf_l'][0][2])
        self.z_ankle = float(self.bone['foot_l'][0][2])
        self.z_shoulder = float(self.bone['upperarm_l'][0][2])
        self.z_neck = float(self.bone['neck_01'][0][2])
        self.z_crotch = self._crotch()

    def _crotch(self):
        """Highest z at which the two legs are still apart (no vertex within 1.5 cm of the midline)."""
        leg = np.array([d.startswith(('thigh', 'calf')) for d in self.dom])
        z = self.z_hip
        while z > self.z_knee:
            sel = leg & (np.abs(self.V[:, 2] - z) < 0.01)
            if sel.any() and np.abs(self.V[sel, 0]).min() > 0.012:
                return z
            z -= 0.005
        return self.z_knee

    def pick(self, z, dz, mask=None):
        m = np.abs(self.V[:, 2] - z) < dz
        if mask is not None:
            m &= mask
        return self.V[m]

def polar_ring(pts, centre, n=28, floor=0.0):
    """Radius of the outline of 2D points around `centre`, per angular bin, smoothed so it stays on or outside every point."""
    d = pts - centre
    ang = np.arctan2(d[:, 1], d[:, 0])
    rad = np.hypot(d[:, 0], d[:, 1])
    b = ((ang + math.pi) / (2 * math.pi) * n).astype(int) % n
    raw = np.zeros(n)
    for i in range(len(rad)):
        if rad[i] > raw[b[i]]:
            raw[b[i]] = rad[i]
    if not raw.any():
        raw[:] = max(floor, 0.05)
    for _ in range(3):  # fill empty bins from their neighbours
        empty = raw <= 0
        if not empty.any():
            break
        nb = (np.roll(raw, 1) + np.roll(raw, -1)) / 2
        raw = np.where(empty & (nb > 0), nb, raw)
    raw = np.maximum(raw, floor)
    wide = np.maximum(raw, np.maximum(np.roll(raw, 1), np.roll(raw, -1)) * 0.96)
    blur = 0.25 * np.roll(wide, 1) + 0.5 * wide + 0.25 * np.roll(wide, -1)
    return np.maximum(blur, raw * 0.98)

def angles(n):
    return -math.pi + (np.arange(n) + 0.5) * 2 * math.pi / n

# ---------------------------------------------------------------- mesh building

class Mesh:
    """Accumulates vertices and quads for one garment part; `verts` may be given weights later by `Skin`."""
    def __init__(self, role):
        self.role = role
        self.v = []
        self.f = []
        self.tag = []   # per vertex: free-form tag used by the weight rules

    def ring_loft(self, rings, tag=None):
        """rings: list of (n x 3) arrays, each a closed ring, top to bottom; outward normals when the ring is counter-clockwise from above."""
        n = len(rings[0])
        base = len(self.v)
        for r in rings:
            for p in r:
                self.v.append(tuple(p))
                self.tag.append(tag)
        for i in range(len(rings) - 1):
            for j in range(n):
                j2 = (j + 1) % n
                a, b = base + i * n + j, base + i * n + j2
                c, d = base + (i + 1) * n + j2, base + (i + 1) * n + j
                self.f.append((a, d, c, b))
        return base

    def cap(self, ring_index_base, n, top=True):
        centre = np.mean([self.v[ring_index_base + j] for j in range(n)], axis=0)
        ci = len(self.v)
        self.v.append(tuple(centre))
        self.tag.append(None)
        for j in range(n):
            j2 = (j + 1) % n
            self.f.append((ring_index_base + j, ring_index_base + j2, ci) if top else (ring_index_base + j2, ring_index_base + j, ci))

BASE = None   # the skin object: every part made here takes its transform, so all parts share one bind space

def make_object(mesh, name):
    me = bpy.data.meshes.new(name)
    inv = BASE.matrix_world.inverted() if BASE is not None else Matrix.Identity(4)
    me.from_pydata([tuple(inv @ Vector(v)) for v in mesh.v], [], mesh.f)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return o

# ---------------------------------------------------------------- garments

def circle_ring(centre, radii, plane='xy', z=None):
    n = len(radii)
    a = angles(n)
    if plane == 'xy':
        return np.stack([centre[0] + radii * np.cos(a), centre[1] + radii * np.sin(a), np.full(n, z)], axis=1)
    raise ValueError(plane)

def smooth_vertical(A, passes=2):
    A = np.array(A, dtype=float)
    for _ in range(passes):
        P = np.vstack([A[:1], A, A[-1:]])
        A = 0.25 * P[:-2] + 0.5 * P[1:-1] + 0.25 * P[2:]
    return A

def smooth_levels(centres, radii, passes=2):
    """Vertical smoothing of ring stacks so the loft has no banding; the radii never go inside the raw outline."""
    R0 = np.array(radii, dtype=float)
    return smooth_vertical(centres, passes), np.maximum(smooth_vertical(R0, passes), R0 * 0.985)

def stack_rings(levels, centre_of, points_of, n, off_fn):
    """levels: z values top to bottom. centre_of(z) -> raw 2D centre, points_of(z) -> Nx2 outline points at that z.
    Centres are smoothed first, then each ring is measured around its smoothed centre."""
    C = smooth_vertical([centre_of(z) for z in levels], 3)
    R = [polar_ring(points_of(z), C[i], n) for i, z in enumerate(levels)]
    R = np.maximum(smooth_vertical(R, 2), np.array(R) * 0.985)
    return [circle_ring(C[i], R[i] + off_fn(levels[i]), z=levels[i]) for i in range(len(levels))]

def torso_levels(body, z_top, z_bot, step, off_fn, mask=None, n=28):
    """Rings around the whole body (both legs below the crotch) from z_top down to z_bot."""
    sel = ~(body.is_arm | body.is_head | body.is_foot)
    if mask is not None:
        sel &= mask
    last = {}
    def pts(z):
        p = body.pick(z, 0.02, sel)
        if len(p) < 3:
            p = body.pick(z, 0.04, sel)
        if len(p) < 3:
            p = last.get('p', p)
        last['p'] = p
        return p[:, :2]
    def centre(z):
        xy = pts(z)
        return np.array([0.0, (xy[:, 1].min() + xy[:, 1].max()) / 2]) if len(xy) else np.zeros(2)
    levels = list(np.arange(z_top, z_bot - 1e-6, -step))
    return stack_rings(levels, centre, pts, n, off_fn)

def leg_levels(body, side, z_top, z_bot, step, off_fn, n=24):
    """Rings around one leg from the waist (the half of the hips on that side) down to the ankle."""
    sgn = body.side[side]
    leg = np.array([d.endswith('_' + side) and d.startswith(('thigh', 'calf')) for d in body.dom])
    hipmask = ~(body.is_arm | body.is_head) & (body.V[:, 0] * sgn > -0.004)
    z_low = float(body.V[leg][:, 2].min()) + 0.01        # the lowest ring that still has skin of this leg inside it
    z_bot = max(z_bot, z_low)
    last = {}
    def pts(z):
        if z >= body.z_crotch:
            p = body.pick(z, 0.02, hipmask)
        else:
            p = body.pick(z, 0.02, leg)
            if len(p) < 3:
                p = body.pick(z, 0.04, leg)
        if len(p) < 3:
            p = last.get('p', p)
        last['p'] = p
        return p[:, :2]
    levels = list(np.arange(z_top, z_bot - 1e-6, -step))
    return stack_rings(levels, lambda z: pts(z).mean(axis=0), pts, n, off_fn)

def sleeve_rings(body, side, x_end_frac, off0, off1, n=18, step=0.03):
    """Rings along the arm (in T-pose it runs along x) from the shoulder joint to a fraction of the way to the wrist."""
    sgn = body.side[side]
    arm = np.array([d.endswith('_' + side) and d.startswith(('upperarm', 'lowerarm', 'hand')) for d in body.dom])
    x0 = abs(body.bone['upperarm_' + side][0][0]) - 0.025
    x_w = abs(body.bone['hand_' + side][0][0]) - 0.01
    x1 = x0 + (x_w - x0) * x_end_frac
    rings = []
    x = x0
    count = max(2, int((x1 - x0) / step) + 1)
    for i in range(count):
        x = x0 + (x1 - x0) * i / (count - 1)
        m = np.abs(np.abs(body.V[:, 0]) - x) < 0.012
        m &= arm & (body.V[:, 0] * sgn > 0)
        pts = body.V[m][:, 1:3]
        if len(pts) < 3:
            m = (np.abs(np.abs(body.V[:, 0]) - x) < 0.03) & arm & (body.V[:, 0] * sgn > 0)
            pts = body.V[m][:, 1:3]
        c = pts.mean(axis=0)
        k = i / (count - 1)
        taper = min(1.0, 0.80 + 0.10 * i)          # the first rings sit tucked into the shoulder instead of standing proud of it
        r = polar_ring(pts, c, n) * taper + (0.012 if i == 0 else off0 + (off1 - off0) * k)
        a = angles(n)
        ring = np.stack([np.full(n, sgn * x), c[0] + r * np.cos(a), c[1] + r * np.sin(a)], axis=1)
        rings.append(ring)
    return rings

def lerp_off(points):
    """points: [(z, offset), ...] sorted from high z to low z -> function z -> offset."""
    zs = [p[0] for p in points][::-1]
    os_ = [p[1] for p in points][::-1]
    return lambda z: float(np.interp(z, zs, os_))

def tube_along(path, radius, n=10, taper=None):
    """Rings around a polyline of 3D points (a braid or a pigtail). Returns rings top to bottom."""
    rings = []
    P = [np.array(p) for p in path]
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)])
        t = t / (np.linalg.norm(t) + 1e-9)
        u = np.cross(t, np.array([1.0, 0, 0]))
        if np.linalg.norm(u) < 1e-3:
            u = np.cross(t, np.array([0, 1.0, 0]))
        u /= np.linalg.norm(u)
        w = np.cross(t, u)
        r = radius * (taper(i / (len(P) - 1)) if taper else 1.0)
        a = angles(n)
        ring = np.array([p + r * (math.cos(x) * u + math.sin(x) * w) for x in a])
        rings.append(ring)
    return rings

def sphere_rings(centre, radii, n=12, rows=7):
    rings = []
    for i in range(1, rows):
        th = math.pi * i / rows
        z = centre[2] + radii[2] * math.cos(th)
        r = math.sin(th)
        a = angles(n)
        rings.append(np.stack([centre[0] + radii[0] * r * np.cos(a), centre[1] + radii[1] * r * np.sin(a), np.full(n, z)], axis=1))
    return rings

def surface_table(body, n=48):
    """Radius of the dressed torso at (z, phi): phi = 0 at the front, + toward the character's left, measured by polar_ring."""
    zs = np.arange(body.zmin + 0.4 * body.H, body.z_neck + 0.03, 0.01)[::-1]
    rows, cs = [], []
    sel = ~(body.is_arm | body.is_head)
    for z in zs:
        pts = body.pick(z, 0.02, sel)
        if len(pts) < 3:
            pts = body.pick(z, 0.04, sel)
        xy = pts[:, :2]
        c = np.array([0.0, (xy[:, 1].min() + xy[:, 1].max()) / 2])
        # polar_ring bins are measured from +x counter-clockwise; resample to phi (0 = -y, the front) around the ring
        r = polar_ring(xy, c, n)
        cs.append(c)
        rows.append(r)
    C, R = smooth_levels(cs, rows, passes=2)
    return {'z': zs, 'c': C, 'r': R, 'n': n, 'sx': body.sx}

def table_point(t, phi_deg, z, off):
    """3D point on the surface at phi (degrees from the front), height z, `off` outside it."""
    zs = t['z']
    i = float(np.clip(np.interp(z, zs[::-1], np.arange(len(zs))[::-1]), 0, len(zs) - 1))
    i0 = int(math.floor(i)); i1 = min(i0 + 1, len(zs) - 1); f = i - i0
    # direction in the xy plane: the front is -y; + phi toward +x (the left)
    ph = math.radians(phi_deg)
    dx, dy = math.sin(ph), -math.cos(ph)
    ang = math.atan2(dy, dx)
    n = t['n']
    pos = (ang + math.pi) / (2 * math.pi) * n - 0.5
    j0 = int(math.floor(pos)) % n; j1 = (j0 + 1) % n; g = pos - math.floor(pos)
    def rad(k):
        return t['r'][k][j0] * (1 - g) + t['r'][k][j1] * g
    r = rad(i0) * (1 - f) + rad(i1) * f
    c = t['c'][i0] * (1 - f) + t['c'][i1] * f
    return np.array([c[0] + (r + off) * dx, c[1] + (r + off) * dy, z])

def wrap_ribbon(mesh, t, pts, width_fn, off_fn, rows_per=6):
    """A ribbon along control points (phi degrees, z), width in metres across the path, draped over the dressed torso."""
    P = np.array(pts, dtype=float)
    # densify with a Catmull-Rom spline in (phi, z)
    dense = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(rows_per):
            u = k / rows_per
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    dense.append(P[-1])
    dense = np.array(dense)
    R0 = 0.16
    uv = np.stack([np.radians(dense[:, 0]) * R0, dense[:, 1]], axis=1)   # metres along the surface and up
    strips = []
    for i, (ph, z) in enumerate(dense):
        d = uv[min(i + 1, len(uv) - 1)] - uv[max(i - 1, 0)]
        d /= (np.linalg.norm(d) + 1e-9)
        perp = np.array([-d[1], d[0]])
        w = width_fn(i / (len(dense) - 1)) / 2
        a = uv[i] - perp * w
        b = uv[i] + perp * w
        pa = table_point(t, math.degrees(a[0] / R0), a[1], off_fn(a[1]))
        pb = table_point(t, math.degrees(b[0] / R0), b[1], off_fn(b[1]))
        strips.append((pa, pb))
    base = len(mesh.v)
    for pa, pb in strips:
        mesh.v.append(tuple(pa)); mesh.tag.append('wrap')
        mesh.v.append(tuple(pb)); mesh.tag.append('wrap')
    for i in range(len(strips) - 1):
        a0, b0, a1, b1 = base + 2 * i, base + 2 * i + 1, base + 2 * i + 2, base + 2 * i + 3
        mesh.f.append((a0, a1, b1, b0))

def build_garments(key, spec, body):
    """Returns a list of Mesh parts. Roles: top (the kurta or blouse, takes the tint), bottom, wrap (dupatta, pallu), trim, hair."""
    out = []
    H = body.H
    outfit = spec['outfit']
    zc, zk, za = body.z_crotch, body.z_knee, body.z_ankle
    z_collar = body.z_neck + 0.012 * H / 1.7 * 1.0
    # ---- kurta / kameez / blouse
    top = Mesh('top')
    zw = zc + 0.05 * H                  # waist: where trousers and skirts start
    if outfit == 'kurta':          # a man's kurta: knee length, full sleeves, loose
        hem = zk + 0.03
        off = lerp_off([(z_collar, 0.014), (body.z_shoulder, 0.024), (body.z_shoulder - 0.15 * H, 0.034), (zw, 0.044), (zc, 0.054), (zc - 0.1, 0.060), (hem, 0.068)])
        sleeve = (1.0, 0.028, 0.022)
    elif outfit == 'salwar':       # a woman's kameez: below the hip, three-quarter sleeves, slightly fitted at the waist
        hem = zk + 0.10
        off = lerp_off([(z_collar, 0.012), (body.z_shoulder, 0.020), (body.z_shoulder - 0.10 * H, 0.030), (zc + 0.14 * H, 0.040), (zc + 0.10 * H, 0.050), (zw, 0.056), (zc, 0.062), (zc - 0.08, 0.064), (hem, 0.072)])
        sleeve = (0.78, 0.022, 0.016)
    elif outfit == 'saree':        # a blouse with elbow sleeves (the saree itself is the skirt and the pallu)
        hem = zc + 0.055 * H
        off = lerp_off([(z_collar, 0.012), (body.z_shoulder, 0.020), (body.z_shoulder - 0.10 * H, 0.032), (hem, 0.034)])
        sleeve = (0.52, 0.018, 0.014)
    else:                          # kids: a kurta to the thigh, short-ish sleeves
        hem = zc - 0.02 * H
        off = lerp_off([(z_collar, 0.014), (body.z_shoulder, 0.020), (zw, 0.030), (hem, 0.040)])
        sleeve = (0.75, 0.022, 0.016)
    rings = torso_levels(body, z_collar, hem, 0.013, off)
    top.ring_loft(rings, 'torso')
    for side in ('l', 'r'):
        top.ring_loft(sleeve_rings(body, side, sleeve[0], sleeve[1], sleeve[2]), 'sleeve_' + side)
    out.append(top)

    # ---- trousers / salwar / skirt
    bottom = Mesh('bottom')
    if outfit in ('kurta', 'kids'):
        boff = lerp_off([(zw, 0.010), (zc, 0.030), (zk + 0.05, 0.036), (zk - 0.05, 0.034), (za + 0.05, 0.018), (za + 0.01, 0.014)])
        for side in ('l', 'r'):
            bottom.ring_loft(leg_levels(body, side, zw, za + 0.012, 0.015, boff), 'leg_' + side)
    elif outfit == 'salwar':
        boff = lerp_off([(zw, 0.012), (zc + 0.01, 0.050), (zc - 0.08, 0.058), (zk, 0.046), (za + 0.14, 0.022), (za + 0.04, 0.012), (za + 0.01, 0.012)])
        for side in ('l', 'r'):
            bottom.ring_loft(leg_levels(body, side, zw, za + 0.012, 0.015, boff), 'leg_' + side)
    elif outfit == 'saree':
        sk_top = zc + 0.11 * H
        boff = lerp_off([(sk_top, 0.022), (zc + 0.02, 0.038), (zk, 0.050), (za + 0.02, 0.055), (za, 0.056)])
        bottom.ring_loft(torso_levels(body, sk_top, za + 0.012, 0.015, boff), 'skirt')
    out.append(bottom)

    # ---- trim: a neckline band on every top, a hem border on the saree and the kameez
    trim = Mesh('trim')
    trim.ring_loft(torso_levels(body, z_collar + 0.002, z_collar - 0.022, 0.008, lambda z: off(z) + 0.004), 'collar')
    if outfit == 'saree':
        ho = lerp_off([(sk_top, 0.022), (zc + 0.02, 0.038), (zk, 0.050), (za + 0.02, 0.055), (za, 0.056)])
        trim.ring_loft(torso_levels(body, za + 0.05, za + 0.012, 0.008, lambda z: ho(z) + 0.004), 'hem')
    if outfit == 'salwar':
        trim.ring_loft(torso_levels(body, hem + 0.04, hem + 0.012, 0.008, lambda z: off(z) + 0.004), 'hem')
    out.append(trim)

    # ---- wrap: the dupatta (woman) and the pallu (elder)
    if outfit in ('salwar', 'saree'):
        wrap = Mesh('wrap')
        table = surface_table(body)
        wo = lambda z: off(z) + 0.030
        if outfit == 'salwar':
            zs_ = body.z_shoulder
            for sg in (-1, 1):     # the two tails of the dupatta hang down the front from the shoulders
                pts = [(sg * 80, zs_ + 0.014), (sg * 52, zs_ - 0.07), (sg * 34, zs_ - 0.20 * H), (sg * 30, zc + 0.03)]
                wrap_ribbon(wrap, table, pts, lambda t: 0.085 + 0.02 * t, wo)
            back = [(-84, zs_ + 0.012), (-125, zs_ - 0.025), (180, zs_ - 0.05), (125, zs_ - 0.025), (84, zs_ + 0.012)]
            wrap_ribbon(wrap, table, back, lambda t: 0.09, wo)
        else:
            zs_ = body.z_shoulder
            front = [(-40, zc + 0.14 * H), (84, zs_ + 0.01)]
            wrap_ribbon(wrap, table, front, lambda t: 0.10, wo, rows_per=14)
            back = [(82, zs_ + 0.012), (112, zs_ - 0.04), (134, zs_ - 0.20 * H), (142, zk + 0.10)]
            wrap_ribbon(wrap, table, back, lambda t: 0.10 + 0.07 * t, wo)
        out.append(wrap)
    return out


# ---------------------------------------------------------------- weights

def skirt_weights(p, body):
    """Weights for cloth that hangs around both legs: the pelvis holds the top, the thighs and calves take over toward the
    hem, shared smoothly across the midline so the cloth does not tear when the legs swing apart."""
    z = p.z
    f = float(np.clip((body.z_crotch + 0.03 - z) / max(0.05, body.z_crotch - body.z_ankle), 0, 1))
    leg = min(0.78, f * 1.1)
    s = float(np.clip((p.x * body.sx + 0.15) / 0.30, 0, 1))
    s = s * s * (3 - 2 * s)  # smoothstep: 1 on the l side
    c = float(np.clip((body.z_knee - z) / max(0.05, body.z_knee - body.z_ankle), 0, 1))
    return {'pelvis': 1 - leg, 'thigh_l': leg * s * (1 - c), 'calf_l': leg * s * c, 'thigh_r': leg * (1 - s) * (1 - c), 'calf_r': leg * (1 - s) * c}

def leg_weights(p, body, side):
    """One trouser leg: the pelvis holds the waist, the thigh the upper leg, the calf the lower, each handing over smoothly
    (a 12 cm blend at the hip and at the knee), so the cloth bends with the joint instead of tearing."""
    def sm(x):
        x = float(np.clip(x, 0, 1))
        return x * x * (3 - 2 * x)
    z = p.z
    wp = sm((z - (body.z_hip - 0.06)) / 0.12)
    c = sm((body.z_knee + 0.06 - z) / 0.12)
    return {'pelvis': wp, 'thigh_' + side: (1 - wp) * (1 - c), 'calf_' + side: (1 - wp) * c}

def weight_garment(obj, body, mesh, spec, skirt_from=None, passes=16):
    """Skin weights copied from the nearest body vertices (cloth below `skirt_from` and the saree skirt use the skirt rule),
    then smoothed over the garment's own surface so neighbouring vertices move together."""
    me = obj.data
    obj.vertex_groups.clear()
    n = len(me.vertices)
    W = []
    MW = BASE.matrix_world.copy()
    for i, v in enumerate(me.vertices):
        p = MW @ Vector(v.co)
        tag = mesh.tag[i] if i < len(mesh.tag) else None
        if tag and tag.startswith('leg_'):
            ws = leg_weights(p, body, tag[4:])
        elif tag == 'skirt' or (skirt_from is not None and tag == 'torso' and p.z < skirt_from):
            ws = skirt_weights(p, body)
        else:
            ws = {}
            tot = 0.0
            for co, idx, dist in body.tree.find_n(p, 4):
                w = 1.0 / (dist + 0.01)
                for bw, bn in body.weights[idx]:
                    ws[bn] = ws.get(bn, 0.0) + bw * w
                tot += w
            ws = {k: x / tot for k, x in ws.items()}
        W.append(ws)
    nbr = [set() for _ in range(n)]
    for poly in me.polygons:
        vs = list(poly.vertices)
        for a in vs:
            for b in vs:
                if a != b:
                    nbr[a].add(b)
    for _ in range(passes):
        W2 = []
        for i in range(n):
            acc = {k: 0.5 * x for k, x in W[i].items()}
            if nbr[i]:
                share = 0.5 / len(nbr[i])
                for j in nbr[i]:
                    for k, x in W[j].items():
                        acc[k] = acc.get(k, 0.0) + x * share
            W2.append(acc)
        W = W2
    groups = {}
    for i, ws in enumerate(W):
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:4]
        t = sum(w for _, w in top) or 1.0
        for name, w in top:
            if w / t > 0.02:
                if name not in groups:
                    groups[name] = obj.vertex_groups.new(name=name)
                groups[name].add([i], w / t, 'REPLACE')

def weight_rigid(obj, assign):
    """assign: {group: weight} for every vertex, or a callable (vertex co) -> dict."""
    obj.vertex_groups.clear()
    groups = {}
    for i, v in enumerate(obj.data.vertices):
        ws = assign(BASE.matrix_world @ Vector(v.co)) if callable(assign) else assign
        for n, w in ws.items():
            if w <= 0.01:
                continue
            if n not in groups:
                groups[n] = obj.vertex_groups.new(name=n)
            groups[n].add([i], w, 'REPLACE')

# ---------------------------------------------------------------- materials

def material(name, rgb, rough=0.8, metal=0.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.use_backface_culling = not double
    return m

PALETTE = {  # linear-ish placeholders: the page recolours every role at run time, these are what the thumbnails use
    'skin': (0.40, 0.21, 0.11), 'eyes': (0.85, 0.83, 0.80), 'pupil': (0.012, 0.008, 0.007), 'brows': (0.02, 0.015, 0.012),
    'top': (0.05, 0.32, 0.34), 'bottom': (0.78, 0.74, 0.62), 'wrap': (0.40, 0.04, 0.08), 'trim': (0.75, 0.55, 0.12),
    'hair': (0.03, 0.025, 0.02), 'shoes': (0.05, 0.04, 0.035),
}

def assign_material(obj, role):
    obj.data.materials.clear()
    obj.data.materials.append(material(role, PALETTE[role], 0.55 if role in ('skin', 'eyes') else 0.85, double=role in ('top', 'bottom', 'wrap', 'trim', 'hair')))
    if role in ('eyes', 'pupil'):
        obj.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.12

# ---------------------------------------------------------------- hair

def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

def hair_cap(body, ze, sc, thick, back_drop=0.0, front=0.065, side=0.02, back=-0.07, K=10, n=40):
    """A solid cap over the skull. Each column of the loft ends on a smooth hairline: high on the forehead, over the
    ears at the sides, at the nape behind. `sc` scales the hairline offsets (a child's head is smaller)."""
    pts = body.V[body.is_head]
    z_top = float(pts[:, 2].max())
    yc = float((pts[:, 1].min() + pts[:, 1].max()) / 2)
    centre = np.array([0.0, yc])
    levels = np.arange(z_top - 0.004, ze - 0.14 * sc / 1.0 - 0.02, -0.007)
    table = []
    for z in levels:
        sel = pts[np.abs(pts[:, 2] - z) < 0.012]
        table.append(polar_ring(sel[:, :2], centre, n) if len(sel) > 2 else np.zeros(n))
    table = np.array(table)
    # fill levels that had no points (above the crown) with the last good one, and smooth vertically
    for i in range(len(table)):
        if not table[i].any():
            table[i] = table[i - 1] if i else 0.01
    C, table = smooth_levels([centre] * len(levels), table, passes=2)
    a = angles(n)
    f = (1 + np.sin(a)) / 2                       # 0 at the front (-y), 1 at the back
    cut = np.where(f < 0.5, front - (front - side) * (f / 0.5), side + (back - side) * ((f - 0.5) / 0.5)) * sc + ze - back_drop
    rows = []
    for k in range(K):
        t = k / (K - 1)
        ring = []
        for j in range(n):
            z = (z_top - 0.004) + (cut[j] - (z_top - 0.004)) * t ** 0.9
            zi = np.clip((z_top - 0.004 - z) / 0.007, 0, len(levels) - 1)
            i0 = int(np.floor(zi)); i1 = min(i0 + 1, len(levels) - 1)
            r = table[i0, j] * (1 - (zi - i0)) + table[i1, j] * (zi - i0)
            lift = thick * (1.0 if k < K - 2 else (0.5 if k == K - 2 else 0.05))
            ring.append((centre[0] + (r + lift) * math.cos(a[j]), centre[1] + (r + lift) * math.sin(a[j]), z))
        rows.append(np.array(ring))
    m = Mesh('hair')
    base_i = m.ring_loft(rows, 'cap')
    m.cap(base_i, n, top=True)
    return m

def sphere_mesh(centre, radii, tag, n=14, rows=8):
    m = Mesh('hair')
    rings = sphere_rings(centre, radii, n, rows)
    b = m.ring_loft(rings, tag)
    m.cap(b, n, top=True)
    m.cap(b + (len(rings) - 1) * n, n, top=False)
    return m

def tube_mesh(path, radius, tag, n=10, taper=None):
    m = Mesh('hair')
    rings = tube_along(path, radius, n, taper)
    b = m.ring_loft(rings, tag)
    m.cap(b, n, top=True)
    m.cap(b + (len(rings) - 1) * n, n, top=False)
    return m

def build_hair_parts(key, spec, body, ze):
    """Returns [(Mesh, weight rule)] for the hairstyle. Rule: 'head' or ('spine', from_z, to_z) blend head -> spine_03."""
    style = spec['hair']
    hl = float(np.linalg.norm(body.bone['head'][1] - body.bone['head'][0]))
    sc = hl / 0.22
    out = []
    if style == 'crop':
        out.append((hair_cap(body, ze, sc, 0.012, front=0.06, side=0.012, back=-0.05), 'head'))
    elif style == 'braid':
        out.append((hair_cap(body, ze, sc, 0.012, front=0.063, side=0.0, back=-0.075), 'head'))
        pts = body.V[body.is_head]
        yb = float(pts[:, 1].max())
        z0 = ze - 0.06 * sc
        torso = ~(body.is_arm | body.is_head)
        path = []
        zs = np.linspace(z0, z0 - 0.42 * body.H / 1.7, 9)
        for z in zs:
            tp = body.V[torso & (np.abs(body.V[:, 2] - z) < 0.03)]
            yy = max(float(tp[:, 1].max()) if len(tp) else yb, yb if z > body.z_neck else -9) + 0.02 + (0.0 if z > body.z_neck else 0.012)
            path.append((0.0, yy, z))
        out.append((tube_mesh(path, 0.026 * sc, 'braid', 10, lambda t: 1.0 - 0.55 * t * t), ('spine', zs[0], zs[-1])))
    elif style == 'bun':
        out.append((hair_cap(body, ze, sc, 0.012, front=0.06, side=0.012, back=-0.06), 'head'))
        pts = body.V[body.is_head]
        out.append((sphere_mesh((0.0, float(pts[:, 1].max()) + 0.015 * sc, ze + 0.045 * sc), (0.062 * sc, 0.055 * sc, 0.05 * sc), 'bun'), 'head'))
    elif style == 'pigtails':
        out.append((hair_cap(body, ze, sc, 0.012, front=0.06, side=0.02, back=-0.04), 'head'))
        pts = body.V[body.is_head]
        for sgn in (-1, 1):
            path = [(sgn * 0.10 * sc, float(pts[:, 1].min() * 0.25 + pts[:, 1].max() * 0.75) + 0.02 * i * 0.3, ze + 0.045 * sc - 0.034 * sc * i) for i in range(6)]
            out.append((tube_mesh(path, 0.034 * sc, 'tail', 10, lambda t: 1.0 - 0.6 * t), 'head'))
            out.append((sphere_mesh(path[0], (0.042 * sc, 0.04 * sc, 0.04 * sc), 'knot'), 'head'))
    return out


# ---------------------------------------------------------------- face

def face_work(base, rig, eyes, body, sc):
    """A gentle smile (the mouth corners lift), darker lips as a vertex colour, and bigger bead-and-white eyes.
    Returns the pupil Mesh pieces (built after the head is scaled and baked, so they sit on the final eyes)."""
    me = base.data
    lips_idx = base.vertex_groups['lips'].index if 'lips' in base.vertex_groups else None
    mw = base.matrix_world
    lips = []
    for v in me.vertices:
        if lips_idx is not None and any(g.group == lips_idx and g.weight > 0.5 for g in v.groups):
            lips.append(v.index)
    if lips:
        P = np.array([tuple(mw @ me.vertices[i].co) for i in lips])
        mc = P.mean(axis=0)
        half = (P[:, 0].max() - P[:, 0].min()) / 2
        for v in me.vertices:
            w = mw @ v.co
            dx, dy, dz = w.x - mc[0], w.y - mc[1], w.z - mc[2]
            if dy > 0.04 * sc:           # behind the face
                continue
            d = math.hypot(dx / (1.9 * half), dz / (1.6 * half))
            if d >= 1:
                continue
            fall = (1 - d) ** 2
            lift = 0.0125 * sc * (abs(dx) / half) ** 1.5 * fall
            v.co.z += lift / max(1e-6, mw.to_scale().z)
        # lip colour as a vertex colour (multiplies the skin tone at run time)
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        lipset = set(lips)
        for v in me.vertices:
            attr.data[v.index].color = (0.80, 0.55, 0.52, 1) if v.index in lipset else (1, 1, 1, 1)
    # bigger eyes: scale each eyeball about its own centre
    ev = eyes.data
    pts = np.array([tuple(eyes.matrix_world @ v.co) for v in ev.vertices])
    for sg in (-1, 1):
        sel = [i for i in range(len(pts)) if pts[i, 0] * sg > 0]
        c = pts[sel].mean(axis=0)
        for i in sel:
            wv = Vector(pts[i])
            ev.vertices[i].co = eyes.matrix_world.inverted() @ (Vector(c) + (wv - Vector(c)) * 1.22 + Vector((0, -0.003, 0)))
    ev.update()

def pupils_for(eyes, sc):
    """Dark pupil discs on the front of each eyeball (the eyeball itself is white)."""
    pts = np.array([tuple(eyes.matrix_world @ v.co) for v in eyes.data.vertices])
    out = []
    for sg in (-1, 1):
        P = pts[pts[:, 0] * sg > 0]
        c = P.mean(axis=0)
        r = (P[:, 0].max() - P[:, 0].min()) / 2
        centre = (c[0], P[:, 1].min() + r * 0.28, c[2])
        out.append(sphere_mesh(centre, (r * 0.52, r * 0.30, r * 0.52), 'pupil', 14, 8))
    return out

# ---------------------------------------------------------------- preview render

def render_preview(path, height, yaw_deg=35, res=(520, 760), focus=None):
    scn = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
    try:
        scn.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scn.render.engine = 'BLENDER_EEVEE_NEXT'
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.film_transparent = False
    world = bpy.data.worlds.new('w') if not scn.world else scn.world
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.82, 0.78, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.9
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = 70 if not focus else 85
    tz = height * 0.5 if not focus else focus
    dist = height * 3.0 if not focus else 0.8
    yaw = math.radians(yaw_deg)
    cam.location = (math.sin(yaw) * dist, -math.cos(yaw) * dist, tz + (height * 0.04 if not focus else 0.0))
    d = Vector((0, 0, tz)) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    for loc, energy, col in (((2.5, -3.0, 3.5), 3.0, (1, 0.95, 0.88)), ((-3, -2, 2), 1.2, (0.85, 0.9, 1.0))):
        ld = bpy.data.lights.new('l', 'SUN')
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new('l', ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(lo)
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)

# ---------------------------------------------------------------- main

def find(parts, sub):
    for o in parts:
        if sub in o.name:
            return o
    raise SystemExit('part %s not found in %s' % (sub, [o.name for o in parts]))

def join_role(objs, role):
    objs = [o for o in objs if o]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = role
    return o

def parent_to(o, rig):
    o.parent = rig
    o.matrix_parent_inverse = BASE.matrix_parent_inverse.copy()
    o.matrix_basis = BASE.matrix_basis.copy()
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig

def solidify(o, thickness, offset=1.0):
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('solid', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    bpy.ops.object.modifier_apply(modifier=m.name)


# ---------------------------------------------------------------- thumbnails for the picker

TOP_TINT = {'man': '#E8823A', 'woman': '#1FA3A3', 'elder': '#1FA3A3', 'child': '#E8823A'}   # the tint of each person's default height
OUTFIT = {  # keep in step with OUTFITS in src/look/people-materials.ts
    'man': dict(bottom='#E8E0CC', wrap='#E8E0CC', trim='#C9A24A', hair='#1D1815', brows='#1A1512', shoes='#4B3A2E'),
    'woman': dict(bottom='#D9CDB6', wrap='#9A2E4C', trim='#C9A24A', hair='#1A1513', brows='#1A1512', shoes='#5A4232'),
    'elder': dict(bottom='#A4453C', wrap='#A4453C', trim='#D2AE5C', hair='#D9D5CD', brows='#B9B4AB', shoes='#4B3A2E'),
    'child': dict(bottom='#E3DAC4', wrap='#E3DAC4', trim='#C9A24A', hair='#1D1815', brows='#1A1512', shoes='#C0563A'),
}

def srgb_lin(hexs):
    c = [int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

def thumb_colours(key, objs):
    cols = dict(OUTFIT[key])
    cols['skin'] = '#B07F5C'
    cols['top'] = TOP_TINT[key]
    cols['eyes'] = '#F3F0EA'
    cols['pupil'] = '#1B1311'
    for role, o in objs.items():
        if role in cols and o.data.materials:
            o.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb_lin(cols[role]), 1)

def relax_arms(rig, body):
    """Lower the arms out of the T for the thumbnail: upper arms down and a little out, forearms slightly forward."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for side, sg in (('l', body.sx), ('r', -body.sx)):
        for name, want in (('upperarm_' + side, Vector((sg * 0.30, 0.0, -0.95))), ('lowerarm_' + side, Vector((sg * 0.16, -0.30, -0.94))), ('hand_' + side, Vector((sg * 0.10, -0.25, -0.96)))):
            bpy.context.view_layer.update()
            pb = rig.pose.bones[name]
            cur = ((rig.matrix_world @ pb.tail) - (rig.matrix_world @ pb.head)).normalized()
            swing(rig, pb, cur.rotation_difference(want.normalized()))
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')

def render_thumb(path, height, ze):
    scn = bpy.context.scene
    scn.view_settings.view_transform = 'Standard'
    scn.render.image_settings.file_format = 'JPEG'
    scn.render.image_settings.quality = 88
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
    try:
        scn.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scn.render.engine = 'BLENDER_EEVEE_NEXT'
    scn.render.resolution_x, scn.render.resolution_y = 240, 300
    world = scn.world or bpy.data.worlds.new('w')
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*srgb_lin('#F1E6D6'), 1)
    bg.inputs['Strength'].default_value = 1.0
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = 60
    top = ze + 0.15 * height / 1.6
    span = (top - 0.0) * 1.12
    dist = span * (60.0 / 45.0) * 1.0   # sensor 36 mm wide, lens 60, 4:5 frame: the vertical field is 45 mm
    yaw = math.radians(22)
    tz = top * 0.5
    cam.location = (math.sin(yaw) * dist, -math.cos(yaw) * dist, tz + 0.05)
    cam.rotation_euler = (Vector((0, 0, tz)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    for loc, energy, col in (((2.0, -3.0, 3.0), 2.6, (1, 0.96, 0.9)), ((-3, -2, 1.5), 1.1, (0.9, 0.93, 1.0)), ((0, 3, 2), 0.8, (1, 1, 1))):
        ld = bpy.data.lights.new('l', 'SUN')
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new('l', ld)
        lo.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(lo)
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)

report = {}
for key, spec in PEOPLE.items():
    if ONLY and key not in ONLY.split(','):
        continue
    base, rig, parts = build_body(key, spec)
    finish_body(base, parts)
    meshes = [base] + parts
    face_work(base, rig, find(parts, 'high-poly'), None, 1.0)
    tpose(rig, meshes, spec)
    ground(rig, meshes)
    body = Body(base, rig)
    BASE = base
    eyes, brows, shoes = find(parts, 'high-poly'), find(parts, 'eyebrow'), find(parts, 'shoes05')
    skin = base

    made = []   # (role, object)
    for mesh in build_garments(key, spec, body):
        o = make_object(mesh, mesh.role)
        weight_garment(o, body, mesh, spec, skirt_from=(body.z_crotch + 0.03 if mesh.role == 'top' and spec['outfit'] in ('kurta', 'salwar', 'kids') else None))
        made.append((mesh.role, o))
    ze = float(np.array([tuple(eyes.matrix_world @ v.co) for v in eyes.data.vertices])[:, 2].mean())
    for mesh in pupils_for(eyes, 1.0):
        o = make_object(mesh, 'pupil')
        weight_rigid(o, {'head': 1.0})
        made.append(('pupil', o))
    for mesh, rule in build_hair_parts(key, spec, body, ze):
        o = make_object(mesh, 'hair')
        if rule == 'head':
            weight_rigid(o, {'head': 1.0})
        else:
            _, z0, z1 = rule
            weight_rigid(o, lambda p, z0=z0, z1=z1: {'head': float(np.clip((p.z - z1) / (z0 - z1), 0, 1)) ** 2, 'spine_03': 1 - float(np.clip((p.z - z1) / (z0 - z1), 0, 1)) ** 2})
        made.append(('hair', o))

    roles = {}
    for role, o in made:
        roles.setdefault(role, []).append(o)
    final = {'skin': skin, 'eyes': eyes, 'brows': brows, 'shoes': shoes}
    for role, objs in roles.items():
        final[role] = join_role(objs, role)
    for role, o in final.items():
        if role in ('skin', 'eyes', 'brows', 'shoes'):
            o.name = o.data.name = role
        assign_material(o, role)
        if role not in ('skin', 'eyes', 'brows', 'shoes'):   # the MPFB parts keep the parenting MPFB gave them (ground() moved the rig under them)
            parent_to(o, rig)
    objs = list(final.values())
    bpy.context.view_layer.update()
    report[key] = {r: len(o.data.polygons) for r, o in final.items()}
    report[key]['H'] = body.H
    if PREVIEW:
        render_preview(os.path.join(PREVIEW, key + '-front.png'), body.H, 30)
        render_preview(os.path.join(PREVIEW, key + '-back.png'), body.H, 200)
        render_preview(os.path.join(PREVIEW, key + '-side.png'), body.H, 90)
        render_preview(os.path.join(PREVIEW, key + '-head.png'), body.H, 20, (520, 520), focus=ze - 0.035)
    if THUMBS:
        os.makedirs(THUMBS, exist_ok=True)
        thumb_colours(key, final)
        relax_arms(rig, body)
        render_thumb(os.path.join(THUMBS, 'thumb-%s.jpg' % key), body.H, ze)
    if '--save-blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, spec['file'] + '.blend'))
    if '--export' in argv:
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs + [rig]:
            o.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(OUT, spec['file'] + '.raw.glb'), export_format='GLB', use_selection=True, export_yup=True,
            export_apply=False, export_animations=False, export_skins=True, export_morph=False, export_cameras=False,
            export_lights=False, export_image_format='AUTO', export_materials='EXPORT', export_extras=False,
            export_texcoords=False, export_normals=True, export_tangents=False, export_vertex_color='ACTIVE')
    print('BUILT', key, json.dumps(report[key]))

with open(os.path.join(OUT, 'build-report.json'), 'w') as f:
    json.dump(report, f, indent=1)
print('DONE')
