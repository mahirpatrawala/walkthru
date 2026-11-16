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
SHEETS = arg('--sheets')                 # directory for posed contact-sheet cells (needs --clip-samples)
CLIP_SAMPLES = arg('--clip-samples')     # JSON written by tools/dump-clip-samples.ts
SHEET_TAG = arg('--sheet-tag', '')
CACHE = arg('--cache')                   # directory of body .blend files (the body before any garment); speeds up iterating on clothes
MEASURE = '--measure' in argv           # report how far every garment stays from the body in the clip poses
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
    'man':   dict(gender=1.0, age=0.60, weight=0.58, muscle=0.5, file='person-man',   outfit='shirt', hair='crop',     stoop=0.0, head=1.06),
    'woman': dict(gender=0.0, age=0.57, weight=0.50, muscle=0.5, file='person-woman', outfit='kurti', hair='braid',    stoop=0.0, head=1.06),
    'elder': dict(gender=0.0, age=0.90, weight=0.50, muscle=0.4, file='person-elder', outfit='tunic',  hair='bun',      stoop=1.0, head=1.06),
    'child': dict(gender=0.2, age=0.125, weight=0.42, muscle=0.5, file='person-child', outfit='tee',    hair='pigtails', stoop=0.0, head=1.14),
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
        from mathutils.bvhtree import BVHTree
        self.bvh = BVHTree.FromPolygons([tuple(p) for p in self.V], [tuple(pl.vertices) for pl in me.polygons])   # the skin as it rests, for rays
        self.tree = kdtree.KDTree(len(self.V))
        for i, p in enumerate(self.V):
            self.tree.insert(Vector(p), i)
        self.tree.balance()
        arm = ('upperarm', 'lowerarm', 'hand', 'index', 'middle', 'pinky', 'ring', 'thumb')
        self.is_arm = np.array([d.startswith(arm) for d in self.dom])
        self.is_head = np.array([d == 'head' for d in self.dom])
        self.is_foot = np.array([d.startswith(('foot', 'ball')) for d in self.dom])
        # the trunk as the cloth sees it: not arms, head or feet, but with the shoulder cap (the upper arm's skin on the body side
        # of the shoulder joint), which the torso cloth has to cover or the skin shows through the seam once the arm lowers
        root = np.zeros(len(self.dom), dtype=bool)
        for sd in ('l', 'r'):
            xr = abs(self.bone['upperarm_' + sd][0][0])
            root |= np.array([d == 'upperarm_' + sd for d in self.dom]) & (np.abs(self.V[:, 0]) < xr)
        self.trunk = ~(self.is_arm | self.is_head | self.is_foot) | root
        self.side = {'l': self.sx, 'r': -self.sx}
        self.z_hip = float(self.bone['thigh_l'][0][2])
        self.z_knee = float(self.bone['calf_l'][0][2])
        self.z_ankle = float(self.bone['foot_l'][0][2])
        self.z_shoulder = float(self.bone['upperarm_l'][0][2])
        self.z_neck = float(self.bone['neck_01'][0][2])
        self.z_crotch = self._crotch()
        self.leg_tree = {}
        for sd in ('l', 'r'):
            idx = [i for i, d in enumerate(self.dom) if d.endswith('_' + sd) and d.startswith(('thigh', 'calf', 'foot', 'ball'))]
            t = kdtree.KDTree(len(idx))
            for k, i in enumerate(idx):
                t.insert(Vector(self.V[i]), i)
            t.balance()
            self.leg_tree[sd] = t

    def _crotch(self):
        """Height at which the legs join: searching up from the knee, the first z with skin within 1.2 cm of the midline
        (trunk or legs, not arms). (The first version of this looked only at vertices that are dominantly thigh or calf,
        which never touch the midline, and so always answered with the hip joint's height.)"""
        sel = ~(self.is_arm | self.is_head | self.is_foot)
        z = self.z_knee + 0.05
        while z < self.z_hip + 0.12:
            if (sel & (np.abs(self.V[:, 2] - z) < 0.008) & (np.abs(self.V[:, 0]) < 0.012)).any():
                return z
            z += 0.004
        return self.z_hip

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
        self.shells = []  # (first face, end face) of closed shells whose winding is left to Blender
        self.rc = {}    # vertex -> (fit key, ring row, ring column), for the vertices the clearance fit may move outward
        self.anchor = {}  # vertex -> a point on the skin whose weights the vertex takes (a sleeve's tucked rings: the arm's, not the torso's)

    def ring_loft(self, rings, tag=None, cols=None, close=False, key=None, row0=0):
        """rings: list of (n x 3) arrays, each a closed ring, top to bottom; outward normals when the ring is counter-clockwise from above.
        `cols`: an ordered list of column indices to loft as an arc instead of the whole closed ring; with `close` the arc's two
        ends are joined by a straight wall (a D-shaped tube) instead of being left open."""
        n = len(rings[0]) if cols is None else len(cols)
        base = len(self.v)
        for i, r in enumerate(rings):
            for jj, p in enumerate(r if cols is None else [r[c] for c in cols]):
                if key:
                    self.rc[len(self.v)] = (key, row0 + i, jj if cols is None else cols[jj])
                self.v.append(tuple(p))
                self.tag.append(tag)
        for i in range(len(rings) - 1):
            for j in range(n if (cols is None or close) else n - 1):
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

def make_object(mesh, name, recalc=True):
    me = bpy.data.meshes.new(name)
    inv = BASE.matrix_world.inverted() if BASE is not None else Matrix.Identity(4)
    me.from_pydata([tuple(inv @ Vector(v)) for v in mesh.v], [], mesh.f)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if recalc or mesh.shells:   # not for garment lofts: their winding is already outward, and Blender's guess flips open panels
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        faces = bm.faces if recalc else [f for a, b in mesh.shells for f in bm.faces[a:b]]
        bmesh.ops.recalc_face_normals(bm, faces=list(faces))
        bm.to_mesh(me)
        bm.free()
    for p in me.polygons:
        p.use_smooth = True
    shades = [SHADE.get(t, 1.0) for t in mesh.tag] if mesh.role == 'top' else []
    if any(x != 1.0 for x in shades):       # slightly darker collar and seams: a vertex colour the page multiplies into the top's tint
        ca = me.color_attributes.new('shade', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', [c for x in shades for c in (x, x, x, 1.0)])
        me.color_attributes.active_color = ca
    return o

SHADE = {'collar': 0.84, 'placket': 0.88, 'seam': 0.84, 'pleat': 0.88}   # per vertex tag of the top: how much darker than the shirt (linear)

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

def stack_rings(levels, centre_of, points_of, n, off_fn, extra=None, surface_fn=None):
    """levels: z values top to bottom. centre_of(z) -> raw 2D centre, points_of(z) -> Nx2 outline points at that z.
    Centres are smoothed first, then each ring is measured around its smoothed centre."""
    C = smooth_vertical([centre_of(z) for z in levels], 3)
    R = [polar_ring(points_of(z), C[i], n) for i, z in enumerate(levels)]
    if surface_fn is not None:                    # exact skin radii where the caller can measure them (rays), the outline elsewhere
        for i, z in enumerate(levels):
            R[i], C[i] = surface_fn(z, C[i], R[i])
    R = np.maximum(smooth_vertical(R, 2), np.array(R) * 0.985)
    return [circle_ring(C[i], R[i] + off_fn(levels[i]) + (extra[i] if extra is not None else 0.0), z=levels[i]) for i in range(len(levels))]

def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

def fit_cells(extra, key, rows, n):
    """The fitted extra radius for one garment: an array (rows x n), made on first use."""
    if key not in extra or extra[key].shape != (rows, n):
        extra[key] = np.zeros((rows, n))
    return extra[key]

def outline_profile(body, levels, n):
    """Smoothed centre and outline radius (no offset) of the trunk-and-legs outline at each level, as stack_rings measures them."""
    sel = body.trunk
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
    C = smooth_vertical([centre(z) for z in levels], 3)
    R = [polar_ring(pts(z), C[i], n) for i, z in enumerate(levels)]
    R = np.maximum(smooth_vertical(R, 2), np.array(R) * 0.985)
    return C, R, pts

def arc_cols(body, n, side, overlap=0.4):
    """Column indices (in ring order) of the open arc that covers one side of the body and reaches `overlap` past the front and back centre."""
    sgn = body.side[side]
    inc = np.cos(angles(n)) * sgn > -overlap
    start = next(j for j in range(n) if inc[j] and not inc[j - 1])
    return [(start + k) % n for k in range(int(inc.sum()))]

def hull_radii(pts2, centre, n):
    """Distance from `centre` to the boundary of the convex hull of the 2D points, per column of an n-column ring. A hull has no
    concavities: it bridges the cleft between the buttocks, the gap between the thighs and the hollow of the waist."""
    P = sorted(set((round(float(x), 5), round(float(y), 5)) for x, y in pts2))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    H = np.array(lo[:-1] + up[:-1])
    out = np.zeros(n)
    for j, a in enumerate(angles(n)):
        d = np.array([math.cos(a), math.sin(a)])
        best = 0.0
        for k in range(len(H)):             # the ray from the centre against each hull edge
            p, q = H[k] - centre, H[(k + 1) % len(H)] - centre
            e = q - p
            den = d[0] * e[1] - d[1] * e[0]
            if abs(den) < 1e-12:
                continue
            t = (p[0] * e[1] - p[1] * e[0]) / den
            u = (p[0] * d[1] - p[1] * d[0]) / den
            if t > 0 and -1e-9 <= u <= 1 + 1e-9:
                best = max(best, t)
        out[j] = best
    return out

def skirted_rings(body, z_top, hem, step, off_fn, flare, taper=1.0, n=32, z_split=None, extra=None, key='top', slit=0.0, hang=None):
    """Rings for a garment that is a tube down to the hips and hangs below them as a skirt: below `z_split` the outline never
    narrows to the legs' (it keeps the hip outline, tapering to `taper` of it at the hem) and flares by `flare` more at the hem.
    `slit` raises the hem at the two sides by that many metres (a side slit: the cloth is cut up at the hip bone, so the
    legs have room where the cloth bunches), falling off over the front and back. Returns (rings, index of the last ring of the tube, levels)."""
    levels = list(np.arange(z_top, hem - 1e-6, -step))
    C, R, pts = outline_profile(body, levels, n)
    zs = body.z_hip + 0.03 if z_split is None else z_split
    isp = next(i for i, z in enumerate(levels) if z <= zs)
    # below the split the rings hang on the hip's centre, so the outline there has to be measured around that same centre:
    # measured around each level's own centre (the shins are not under the hips) it left skin outside the cloth
    for i, z in enumerate(levels):
        if i > isp:
            R[i] = polar_ring(pts(z), C[isp], n)
    if len(levels) > isp + 1:
        R[isp + 1:] = np.maximum(smooth_vertical(R[isp:], 2)[1:], R[isp + 1:] * 0.985)
    Rf = np.max([R[i] for i, z in enumerate(levels) if zs - 0.16 <= z <= zs + 0.03], axis=0)
    if hang is not None:
        # `hang` = (z where the cloth leaves the body's outline, ease at the hip, ease at the hem): the cloth drops from the widest
        # point of the hips as a straight convex drape. Its outline is the convex hull of the hips and thighs (no buttock cleft, no
        # gap between the thighs), eased out by `ease` metres, and from `z_from` down to the hips it opens out from the body's
        # outline to that hull, so the waist is not traced either.
        z_from, e_hip, e_hem = hang[:3]
        z_w = hang[3] if len(hang) > 3 else body.z_hip - 0.09
        # the rings are placed on a centre that slides from each level's own to the hem's: the body's outline has to be measured about
        # that same centre, or the cloth's front is shifted back by the difference (a dent in the belly) 
        wts = [float(smoothstep((z_from - z) / max(1e-6, z_from - z_w))) for z in levels]
        for i, z in enumerate(levels):
            if i <= isp and wts[i] > 0:
                R[i] = polar_ring(pts(z), (1 - wts[i]) * C[i] + wts[i] * C[isp], n)
        R = np.maximum(smooth_vertical(R, 2), np.array(R) * 0.985)
        bz = hang[4] if len(hang) > 4 else (body.z_hip - 0.12, body.z_hip + 0.04)
        band = body.V[body.trunk & (body.V[:, 2] < bz[1]) & (body.V[:, 2] > bz[0])]
        Rh = hull_radii(band[:, :2], C[isp], n)
        Rf = np.maximum(Rf, Rh)
        rad, cen = [], []
        for i, z in enumerate(levels):
            w = float(smoothstep((z_from - z) / max(1e-6, z_from - z_w)))
            ease = e_hip + (e_hem - e_hip) * float(np.clip((z_w - z) / max(1e-6, z_w - hem), 0, 1))
            body_r = R[i] + off_fn(z)
            r = (1 - w) * body_r + w * np.maximum(body_r, Rh + ease) if z >= z_w else Rh + ease
            rad.append(r)
            cen.append((1 - w) * C[i] + w * C[isp])
    else:
      rad, cen = [], []
    for i, z in enumerate(levels):
        if hang is not None:
            break
        if z < zs:
            t = float(smoothstep((zs - z) / max(1e-6, zs - hem)))
            r = np.maximum(R[i], Rf * (1 - (1 - taper) * t)) + off_fn(z) + flare * t
            cen.append(C[isp])
        else:
            r = R[i] + off_fn(z)
            cen.append(C[i])
        rad.append(r)
    rad = np.array(rad)
    if extra is not None:
        rad = rad + fit_cells(extra, key, len(levels), n)
    sm = smooth_vertical(rad, 2)
    rad = np.maximum(sm, rad * 0.985)
    rings = [circle_ring(cen[i], rad[i], z=levels[i]) for i in range(len(levels))]
    slit = min(slit, 0.6 * (zs - hem))
    if slit > 0:
        lift = slit * np.abs(np.cos(angles(n))) ** 3          # per column: 1 at the sides, 0 at the front and back
        for i, z in enumerate(levels):
            if z < zs:     # below the split the rows are squeezed toward the raised hem, so the hem edge stays a smooth curve
                rings[i][:, 2] = zs - (zs - z) * (1 - lift / (zs - hem))
    return rings, isp, levels

def loft_skirted(body, mesh, rings, isp, n=32, key=None):
    """The tube down to `isp`, then one open panel per leg (each reaching a little past the front and back centre, so the
    two overlap there and slide over each other as the legs part instead of tearing)."""
    mesh.ring_loft(rings[:isp + 1], 'torso', key=key)
    for side in ('l', 'r'):
        # the right panel stands 3 mm proud of the left where they overlap, so the two never z-fight
        rs = rings[max(0, isp - 2):]
        # both panels stand a little off the tube they overlap for their first two rows (0.3 mm growing to 0.8 mm) so the rows never
        # z-fight with it, and the right one a further 0.2 to 1.2 mm: the step where the panels overlap is a hairline, not a ridge
        rs = [inflate(r, 0.0003 + 0.0005 * min(1.0, k / 5)) for k, r in enumerate(rs)]
        if side == 'r':
            rs = [inflate(r, 0.0002 + 0.0010 * min(1.0, k / max(1, len(rs) - 1))) for k, r in enumerate(rs)]
        mesh.ring_loft(rs, 'pan_' + side, cols=arc_cols(body, n, side), close=True, key=key, row0=max(0, isp - 2))

def inflate(ring, d):
    c = np.mean(ring, axis=0)
    v = ring - c
    v[:, 2] = 0
    r = np.linalg.norm(v, axis=1)[:, None]
    return ring + v / np.maximum(r, 1e-6) * d

def torso_levels(body, z_top, z_bot, step, off_fn, mask=None, n=28, extra=None):
    """Rings around the whole body (both legs below the crotch) from z_top down to z_bot."""
    sel = body.trunk
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
    return stack_rings(levels, centre, pts, n, off_fn, extra)

def leg_levels(body, side, z_top, z_bot, step, off_fn, n=24, extra=None, below_skin=False):
    """Rings around one leg from the waist (the half of the hips on that side) down to the ankle."""
    sgn = body.side[side]
    leg = np.array([d.endswith('_' + side) and d.startswith(('thigh', 'calf')) for d in body.dom])
    hipmask = ~(body.is_arm | body.is_head) & (body.V[:, 0] * sgn > -0.004)
    z_low = float(body.V[leg][:, 2].min()) + 0.01        # the lowest ring that still has skin of this leg inside it
    if not below_skin:      # (trousers go on down over the foot's top: the rings there are measured on the foot, then)
        z_bot = max(z_bot, z_low)
    last = {}
    def pts(z):
        if z >= body.z_crotch:
            p = body.pick(z, 0.02, hipmask)
        else:
            p = body.pick(z, 0.03, leg)     # the skin is sparse on the shin (about 15 vertices per 4 cm), so a narrow window gives dips and holes
        if len(p) < 3:
            p = last.get('p', p)
        last['p'] = p
        return p[:, :2]
    levels = list(np.arange(z_top, z_bot - 1e-6, -step))
    def surface(z, c, rp):
        if z >= body.z_crotch - 0.03:       # up in the hips the two legs are one body: rays would leave through the other half
            return rp, c
        rr, o3 = surface_radii(body, (c[0], c[1], z), [(math.cos(t), math.sin(t), 0.0) for t in angles(n)], rp, order=4, bump=0.004)
        return rr, np.array(o3[:2])
    return stack_rings(levels, lambda z: pts(z).mean(axis=0), pts, n, off_fn, None if extra is None else fit_cells(extra, 'leg_' + side, len(levels), n), surface_fn=surface)

def surface_radii(body, origin, axis_dirs, rp, order=3, bump=0.006):
    """Radius of the skin around one section, per column, measured with rays from `origin` (a 3D point inside the section)
    along `axis_dirs` (n unit vectors), then reduced to its smooth part: a low-order Fourier fit plus whatever bump that misses
    (at most `bump` metres). `rp` is the points-only outline (polar_ring), used to reject rays that leave through another part
    and as the answer when most rays miss. The skin is sparse (a vertex every 1.5 cm on an arm or shin), so the outline of its
    points alone is ragged and cuts into the surface in places."""
    n = len(axis_dirs)
    a = angles(n)
    def cast(o):
        out = np.full(n, np.nan)
        for j in range(n):
            hit = body.bvh.ray_cast(Vector(o), Vector(axis_dirs[j]), 0.3)
            if hit[0] is not None and 0.5 * rp[j] < hit[3] < 1.6 * rp[j]:
                out[j] = hit[3]
        return out
    o0 = np.array(origin, dtype=float)
    o = o0
    rr = cast(o)
    for _ in range(2):          # move the origin to the middle of what the rays found
        ok = ~np.isnan(rr)
        if ok.sum() < n // 2:
            return rp, o0
        hp = np.array([o + rr[j] * np.array(axis_dirs[j]) for j in range(n) if ok[j]])
        o = hp.mean(axis=0)
        rr = cast(o)
    ok = ~np.isnan(rr)
    if ok.sum() < n // 2:
        return rp, o0
    M = np.stack([np.ones(n)] + [f(k_ * a) for k_ in range(1, order + 1) for f in (np.cos, np.sin)], axis=1)
    coef, *_ = np.linalg.lstsq(M[ok], rr[ok], rcond=None)
    fit = M @ coef
    return fit + float(np.clip(np.max(np.where(ok, rr - fit, 0.0)), 0.0, bump)), o

def sleeve_rings(body, side, x_end_frac, off0, off1, n=18, step=0.02):
    """Rings along the arm (in T-pose it runs along x) from the shoulder joint to a fraction of the way to the wrist."""
    sgn = body.side[side]
    arm = np.array([d.endswith('_' + side) and d.startswith(('upperarm', 'lowerarm', 'hand')) for d in body.dom])
    x0 = abs(body.bone['upperarm_' + side][0][0]) - 0.035
    x_w = abs(body.bone['hand_' + side][0][0]) - 0.01
    x_elbow = abs(body.bone['lowerarm_' + side][0][0])
    x1 = x0 + (x_w - x0) * x_end_frac
    rings, surf = [], []
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
        taper = 0.84 + 0.16 * float(smoothstep((x - x0) / 0.05))     # the sleeve grows out of the torso over its first 7 cm instead of standing proud of the shoulder
        bump = 0.002 * math.exp(-(((x - x_elbow) / 0.05) ** 2)) + 0.0025 * math.exp(-(((x - x0 - 0.04) / 0.045) ** 2))   # and 5 mm over the deltoid, which the arm's own outline lags in a swing      # 3 mm where the elbow's point presses on the cloth (was 6 mm and a 7 cm lump)
        a = angles(n)
        rp = polar_ring(pts, c, n)
        rr, o3 = surface_radii(body, (sgn * x, c[0], c[1]), [(0.0, math.cos(t), math.sin(t)) for t in a], rp, bump=0.003)
        c = np.array(o3[1:3])
        r = rr * taper + (0.010 if i == 0 else off0 + (off1 - off0) * k + bump)
        ring = np.stack([np.full(n, sgn * x), c[0] + r * np.cos(a), c[1] + r * np.sin(a)], axis=1)
        rings.append(ring)
        surf.append(np.stack([np.full(n, sgn * x), c[0] + rr * np.cos(a), c[1] + rr * np.sin(a)], axis=1))
    return rings, surf

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

def dressed_table(body, ring_sets):
    """The surface the wrap lies on: the skin's outline, pushed out wherever a garment ring (kurta, blouse, skirt) is bigger."""
    t = surface_table(body)
    n = t['n']
    a48 = angles(n)
    R = t['r'].copy()
    for rings in ring_sets:
        zr = np.array([float(r[0][2]) for r in rings])           # top to bottom
        rr = []
        for ring in rings:
            k = int(np.argmin(np.abs(t['z'] - ring[0][2])))
            d = np.asarray(ring)[:, :2] - t['c'][k]
            ang = np.arctan2(d[:, 1], d[:, 0])
            order = np.argsort(ang)
            rr.append(np.interp(a48, ang[order], np.hypot(d[:, 0], d[:, 1])[order], period=2 * np.pi))
        rr = np.array(rr)
        for k, z in enumerate(t['z']):
            if zr[-1] <= z <= zr[0]:
                v = np.array([np.interp(z, zr[::-1], rr[::-1, j]) for j in range(n)])
                R[k] = np.maximum(R[k], v)
    R0 = R
    for _ in range(3):      # fill the steps where a garment's outline takes over from the skin's, never lowering a peak
        R = 0.25 * np.roll(R, 1, axis=1) + 0.5 * R + 0.25 * np.roll(R, -1, axis=1)
    t['r'] = np.maximum(R, R0)
    return t

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

def strip_grid(t, pts, width_fn, off_fn, fold_fn, rows_per=8, cols=9):
    """A band draped over the dressed torso. pts: control points (phi degrees, z) along its centre line. Returns the grid
    of (phi, z, offset) per row and column, row 0 at the first control point, column 0 on one edge."""
    P = np.array(pts, dtype=float)
    dense = []
    for i in range(len(P) - 1):                    # Catmull-Rom through the control points, in (phi, z)
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(rows_per):
            u = k / rows_per
            dense.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    dense.append(P[-1])
    dense = np.array(dense)
    R0 = 0.16
    uv = np.stack([np.radians(dense[:, 0]) * R0, dense[:, 1]], axis=1)   # metres along the surface and up
    N = len(dense)
    grid = []
    for i in range(N):
        d = uv[min(i + 1, N - 1)] - uv[max(i - 1, 0)]
        d /= (np.linalg.norm(d) + 1e-9)
        perp = np.array([-d[1], d[0]])
        w = width_fn(i / (N - 1))
        row = []
        for jj in range(cols):
            v = jj / (cols - 1) * 2 - 1                     # -1 .. 1 across the band
            q = uv[i] + perp * (v * w / 2)
            z = float(q[1])
            row.append((math.degrees(q[0] / R0), z, off_fn(z) + fold_fn(i / (N - 1), v, z)))
        grid.append(row)
    return grid

def emit_strip(mesh, t, grid, r0, r1, thick, extra=0.0, tag='wrap'):
    """The rows r0..r1 of a strip grid as a closed shell `thick` metres thick (outer face `extra` metres proud)."""
    rows = grid[r0:r1 + 1]
    n, m = len(rows), len(rows[0])
    base = len(mesh.v)
    f0 = len(mesh.f)
    for layer in (0.5, -0.5):
        for row in rows:
            for phi, z, o in row:
                mesh.v.append(tuple(table_point(t, phi, z, o + extra + layer * thick)))
                mesh.tag.append(tag)
    inner = base + n * m
    for i in range(n - 1):
        for j in range(m - 1):
            a, b, c, d = i * m + j, i * m + j + 1, (i + 1) * m + j + 1, (i + 1) * m + j
            mesh.f.append((base + a, base + b, base + c, base + d))
            mesh.f.append((inner + d, inner + c, inner + b, inner + a))
    for i in range(n - 1):                              # the two long edges
        for j in (0, m - 1):
            a, b = i * m + j, (i + 1) * m + j
            mesh.f.append((base + a, base + b, inner + b, inner + a) if j == 0 else (base + b, base + a, inner + a, inner + b))
    for i in (0, n - 1):                                # the two ends
        for j in range(m - 1):
            a, b = i * m + j, i * m + j + 1
            mesh.f.append((base + b, base + a, inner + a, inner + b) if i == 0 else (base + a, base + b, inner + b, inner + a))
    mesh.shells.append((f0, len(mesh.f)))

def front_cols(n, half_deg):
    """Boolean per column of an n-column ring: within `half_deg` degrees of the front (-y)."""
    a = angles(n)
    d = np.abs(((a + math.pi / 2 + math.pi) % (2 * math.pi)) - math.pi)
    return d <= math.radians(half_deg)

def open_arc(n, gap):
    """Ordered column indices of a ring without the columns in the boolean `gap` (one contiguous run is assumed)."""
    keep = ~gap
    start = next(j for j in range(n) if keep[j] and not keep[j - 1])
    return [(start + k) % n for k in range(int(keep.sum()))]

def vent_hem(rings, levels, hem, vent, n):
    """Side vents: the hem is raised at the two sides by up to `vent` metres (the rows below hem + vent are squeezed toward the raised
    edge, so the hem stays a smooth curve and is level front and back)."""
    lift = vent * np.abs(np.cos(angles(n))) ** 6
    zv = hem + vent
    for i, z in enumerate(levels):
        if z < zv:
            rings[i][:, 2] = zv - (zv - z) * (1 - lift / (zv - hem))

def shirt_rings(body, z_top, hem, off, hang, vent, extra=None, n=32):
    """A hip-length top as one tube from the neck to a straight hem. Below the waist the outline is the convex hull of the hips and thighs
    eased by `hang` (skirted_rings), so it never traces the cleft between the buttocks and never flares past the hips."""
    k = max(2, int(math.ceil((z_top - hem) / 0.013)))
    rings, isp, levels = skirted_rings(body, z_top, hem, (z_top - hem) / k, off, 0.0, 1.0, n=n, z_split=hem + 1e-4, extra=extra, key='top', hang=hang)
    if vent > 0:
        vent_hem(rings, levels, hem, vent, n)
    return rings, levels

def roll_cuff(rings, grow):
    """Grow the last rings of a sleeve (a rolled cuff, or a turned hem), in the plane of the ring."""
    for ring, g in zip(rings[-len(grow):], grow):
        c = ring[:, 1:].mean(axis=0)
        v = ring[:, 1:] - c
        ring[:, 1:] = ring[:, 1:] + v / np.maximum(np.linalg.norm(v, axis=1)[:, None], 1e-6) * g

def collar_mesh(body, z_c, n=32):
    """A shirt collar: a stand that closes around the neck and a fold that lies over it and down on the shoulders, open at the front in a V.
    Built from the neck's own outline, so it follows the neck."""
    m = Mesh('top')
    stand = torso_levels(body, z_c + 0.018, z_c - 0.004, 0.0055, lambda z: 0.0072, n=n)
    m.ring_loft(stand, 'collar')
    # the fold: the stand's own outline (smooth, round) grown outward and lowered in four steps, a shallow cone lying on the shoulders
    base = np.array(stand[-1])
    c = base[:, :2].mean(axis=0)
    fold = []
    for dz, k in ((0.011, 1.06), (0.005, 1.17), (-0.004, 1.29), (-0.013, 1.40)):
        ring = base.copy()
        ring[:, :2] = c + (base[:, :2] - c) * k
        ring[:, 2] = z_c + dz
        fold.append(ring)
    gap = front_cols(n, 12)
    m.ring_loft(fold, 'collar', cols=open_arc(n, gap))
    return m

def ring_strip(rings, z_hi, z_lo, half_w, lift, edge_lift, phi0=-math.pi / 2, tag='placket'):
    """A narrow raised strip down a ring stack (a button placket at the front, phi0 = -pi/2, or a pleat at the back, +pi/2): rings between z_hi and
    z_lo, `half_w` either side of the centre line, `lift` proud in the middle and `edge_lift` at the edges."""
    m = Mesh('top')
    rows = []
    for ring in rings:
        z = float(ring[:, 2].mean())
        if not (z_lo <= z <= z_hi):
            continue
        c = ring[:, :2].mean(axis=0)
        d = ring[:, :2] - c
        ang = np.arctan2(d[:, 1], d[:, 0])
        rad = np.hypot(d[:, 0], d[:, 1])
        o = np.argsort(ang)
        at = lambda phi, up: c + (np.interp(phi, ang[o], rad[o], period=2 * math.pi) + up) * np.array([math.cos(phi), math.sin(phi)])
        r0 = float(np.interp(phi0, ang[o], rad[o], period=2 * math.pi))
        dphi = half_w / r0
        rows.append(np.array([[*at(phi0 - dphi, edge_lift), z], [*at(phi0, lift), z], [*at(phi0 + dphi, edge_lift), z]]))
    if len(rows) >= 2:
        m.ring_loft(rows, tag, cols=[0, 1, 2])
    return m

def band_across(rings, z_c, half_h, phi_a, phi_b, lift, tag='seam'):
    """A band across part of a ring stack (a yoke seam across the upper back): the rings within `half_h` of `z_c`, from angle phi_a to phi_b (going
    counter-clockwise), `lift` proud of the cloth."""
    m = Mesh('top')
    rows = []
    for ring in rings:
        z = float(ring[:, 2].mean())
        if abs(z - z_c) > half_h:
            continue
        c = ring[:, :2].mean(axis=0)
        d = ring[:, :2] - c
        ang = np.arctan2(d[:, 1], d[:, 0])
        rad = np.hypot(d[:, 0], d[:, 1])
        o = np.argsort(ang)
        row = []
        for k in range(13):
            phi = phi_a + (phi_b - phi_a) * k / 12
            r = float(np.interp(phi, ang[o], rad[o], period=2 * math.pi)) + lift * (0.4 + 0.6 * math.sin(math.pi * k / 12))
            row.append([c[0] + r * math.cos(phi), c[1] + r * math.sin(phi), z])
        rows.append(np.array(row))
    if len(rows) >= 2:
        m.ring_loft(rows, tag, cols=list(range(13)))
    return m

def append_mesh(dst, src):
    """Adds the vertices and faces of Mesh `src` to Mesh `dst`."""
    n0 = len(dst.v)
    dst.v.extend(src.v); dst.tag.extend(src.tag)
    dst.f.extend(tuple(i + n0 for i in f) for f in src.f)

def buttons_mesh(rings, zs, lift, r=0.0058, rz=None):
    """Small flattened discs on the front centre line of a ring stack, at heights `zs` (role wrap: the page paints them pearl)."""
    m = Mesh('wrap')
    for z in zs:
        best = min(rings, key=lambda ring: abs(float(ring[:, 2].mean()) - z))
        c = best[:, :2].mean(axis=0)
        d = best[:, :2] - c
        ang = np.arctan2(d[:, 1], d[:, 0])
        rad = np.hypot(d[:, 0], d[:, 1])
        o = np.argsort(ang)
        y = c[1] - (float(np.interp(-math.pi / 2, ang[o], rad[o], period=2 * math.pi)) + lift)
        rs = sphere_rings((c[0], y, float(best[:, 2].mean())), (r, 0.0022 if rz is None else 0.003, r if rz is None else rz), 8 if rz is None else 12, 5)
        nn = 8 if rz is None else 12
        b = m.ring_loft(rs, 'button')
        m.cap(b, nn, top=True)
        m.cap(b + (len(rs) - 1) * nn, nn, top=False)
    m.shells.append((0, len(m.f)))
    return m

def build_garments(key, spec, body, extra=None):
    """Returns a list of Mesh parts. Roles: top (the shirt, kurti, T-shirt or blouse: takes the tint), bottom (trousers, shorts or the saree's
    skirt: never the tint), wrap (shirt buttons, the pallu), trim (collar band, belt, hem border), hair.
    Man: a collared shirt over straight trousers. Woman: a hip-length kurti over straight trousers. Child: a T-shirt and shorts. Elder: a longer,
    looser tunic over straight trousers ('tunic'). The 'saree' outfit (a blouse, a skirt of two panels, one per leg, and a sash over the shoulder) is
    kept as an option for PEOPLE[...]['outfit'] but no one wears it since SPEC 16.6.11b.
    Trouser and short legs are tubes down each leg, weighted to their own leg (SPEC 16.6.11)."""
    out = []
    H = body.H
    outfit = spec['outfit']
    zh = body.z_hip                         # (the first version called this z_crotch, which was in fact the hip joint's height)
    zk, za = body.z_knee, body.z_ankle
    zsh = body.z_shoulder
    z_collar = body.z_neck + 0.012 * H / 1.7 * 1.0
    zw = zh + 0.05 * H                  # waist: where trousers and skirts start
    u = H / {'man': 1.75, 'woman': 1.60, 'elder': 1.50, 'child': 1.20}[key]     # model metres per real metre (the rig is scaled to the chosen height at run time)
    top = Mesh('top')
    trim = Mesh('trim')
    extras = []                          # more parts (buttons)
    # Offsets are metres outside the skin's outline (SPEC 16.6.9): about 1 to 1.5 cm at the shoulders and chest, so a garment is 8 to 12 % longer
    # around than the body at the chest. Nothing flares: the hem hangs straight down from the hip.
    if outfit == 'saree':          # a blouse with elbow sleeves (the saree itself is the skirt and the pallu)
        hem = zh + 0.055 * H
        off = lerp_off([(z_collar, 0.008), (zsh, 0.010), (zsh - 0.10 * H, 0.013), (hem, 0.014)])
        sleeve = (0.52, 0.009, 0.007)
        top_rings = torso_levels(body, z_collar, hem, 0.013, off)
        levels_top = [r[0][2] for r in top_rings]
        top.ring_loft(top_rings, 'torso')
    else:
        tucked = outfit == 'shirt'
        if outfit == 'shirt':        # a man's collared shirt, tucked in: it ends under the trousers' waistband, the belt shows all round
            hem = zw - 0.008
            off = lerp_off([(z_collar, 0.0075), (zsh, 0.0085), (zsh - 0.15 * H, 0.0075), (zw + 0.03, 0.0050), (zw, 0.0040), (hem, 0.0040)])
            sleeve = (0.70, 0.0065, 0.0055)
        elif outfit == 'kurti':      # a woman's kurti: a hip-length top, three-quarter sleeves, round neck, 4 cm side vents
            hem = zh - 0.02 * u
            off = lerp_off([(z_collar, 0.0075), (zsh, 0.0085), (zsh - 0.10 * H, 0.0075), (zh + 0.14 * H, 0.0075), (zw, 0.0085), (zh, 0.0105), (hem, 0.0115)])
            sleeve = (0.78, 0.0065, 0.0050)
            hang, vent = (zsh - 0.12 * H, 0.0040, 0.0050, hem, (hem - 0.03, hem + 0.07)), 0.04 * u
        elif outfit == 'tunic':      # an elderly woman's tunic: a little longer and looser than the woman's kurti, hem at mid-hip, three-quarter sleeves, round neck with piping
            hem = zh - 0.045 * u
            off = lerp_off([(z_collar, 0.0080), (zsh, 0.0095), (zsh - 0.10 * H, 0.0105), (zh + 0.14 * H, 0.0110), (zw, 0.0120), (zh, 0.0140), (hem, 0.0150)])
            sleeve = (0.80, 0.0075, 0.0060)
            hang, vent = (zsh - 0.12 * H, 0.0050, 0.0070, hem, (hem - 0.03, hem + 0.07)), 0.05 * u
        else:                        # tee: a child's T-shirt, to the hip, short sleeves, crew neck
            hem = zh - 0.005 * H
            off = lerp_off([(z_collar, 0.0065), (zsh, 0.0065), (zw, 0.0075), (zh, 0.0100), (hem, 0.0110)])
            sleeve = (0.25, 0.0060, 0.0050)
            hang, vent = (zw, 0.0080, 0.0110, hem, (hem - 0.03, hem + 0.07)), 0.0
        if tucked:
            rings = torso_levels(body, z_collar, hem, 0.013, off, n=32)
            levels_top = [r[0][2] for r in rings]
            top.ring_loft(rings, 'torso')
        else:
            rings, levels_top = shirt_rings(body, z_collar, hem, off, hang, vent, extra=extra)
            top.ring_loft(rings, 'torso', key='top')
        top_rings = rings
    for side in ('l', 'r'):
        srings, ssurf = sleeve_rings(body, side, sleeve[0], sleeve[1], sleeve[2])
        if outfit == 'shirt':
            roll_cuff(srings, (0.001, 0.004, 0.004))       # sleeves rolled to the forearm: a turned band at the end
        elif outfit == 'tee':
            roll_cuff(srings, (0.0, 0.003))                # a turned hem
        b0 = top.ring_loft(srings, 'sleeve_' + side)
        for i, ring in enumerate(ssurf):
            for j in range(len(ring)):
                top.anchor[b0 + i * len(ring) + j] = tuple(ring[j])
    out.append(top)
    z_yoke = zsh - 0.06 * H                  # the yoke seam across the upper back, level with the shoulder blades
    if outfit == 'shirt':
        append_mesh(top, collar_mesh(body, z_collar))
        append_mesh(top, ring_strip(top_rings, z_collar - 0.03, hem + 0.012, 0.0125, 0.0042, 0.0018))
        zs_b = np.linspace(z_collar - 0.075, hem + 0.045, 5)
        extras.append(buttons_mesh(top_rings, zs_b, 0.0058))
    if outfit in ('shirt', 'kurti', 'tunic'):
        append_mesh(top, band_across(top_rings, z_yoke, 0.0075, math.pi / 2 - 1.05, math.pi / 2 + 1.05, 0.0012))
    if outfit == 'shirt':                    # a box pleat down the centre of the back, from the yoke to the hem
        append_mesh(top, ring_strip(top_rings, z_yoke - 0.008, hem + 0.01, 0.0065, 0.0026, 0.0008, phi0=math.pi / 2, tag='pleat'))

    # ---- trousers / shorts / skirt
    bottom = Mesh('bottom')
    z_waist = zw
    if outfit == 'shirt':       # straight trousers: close at the thigh, a straight leg to a hem that breaks at the shoe; the waistband stands over the tucked shirt
        z_waist = zw + 0.006
        boff = lerp_off([(zw + 0.006, 0.0125), (zw - 0.04, 0.0125), (zh, 0.0125), (zh - 0.12, 0.0125), (zk + 0.16, 0.0105), (zk + 0.06, 0.0090), (zk - 0.02, 0.0085), (zk - 0.09, 0.0115), (za + 0.12, 0.016), (za + 0.01, 0.022), (za - 0.05, 0.024)])
        z_bot = za - 0.045
    elif outfit == 'tunic':     # straight, comfortable trousers: a little fuller than the woman's, the same hem on the shoe
        boff = lerp_off([(zw, 0.003), (zw - 0.04, 0.0035), (zw - 0.07, 0.007), (zh, 0.0125), (zh - 0.12, 0.0135), (zk + 0.16, 0.0125), (zk + 0.06, 0.0110), (zk - 0.02, 0.0105), (zk - 0.09, 0.0130), (za + 0.12, 0.0170), (za + 0.01, 0.0215), (za - 0.05, 0.0235)])
        z_bot = za - 0.045
    elif outfit == 'kurti':     # straight trousers, a little closer than the man's
        boff = lerp_off([(zw, 0.003), (zw - 0.04, 0.0035), (zw - 0.07, 0.006), (zh, 0.0105), (zh - 0.12, 0.0115), (zk + 0.16, 0.0095), (zk + 0.06, 0.0080), (zk - 0.02, 0.0080), (zk - 0.09, 0.0105), (za + 0.12, 0.0150), (za + 0.01, 0.020), (za - 0.05, 0.022)])
        z_bot = za - 0.045
    elif outfit == 'tee':       # shorts to just above the knee, easy at the leg opening
        boff = lerp_off([(zw, 0.003), (zw - 0.04, 0.0035), (zh, 0.0055), (zh - 0.10, 0.0080), (zk + 0.05, 0.0125), (zk + 0.03, 0.0125)])
        z_bot = zk + 0.035
    if outfit != 'saree':
        for side in ('l', 'r'):
            lv = leg_levels(body, side, z_waist, z_bot, 0.015, boff, extra=extra, below_skin=outfit != 'tee')
            bottom.ring_loft(lv, 'leg_' + side, key='leg_' + side)
    else:
        sk_top = zh + 0.11 * H
        boff = lerp_off([(sk_top, 0.010), (zh + 0.02, 0.014), (zk, 0.016), (za + 0.02, 0.018), (za, 0.018)])
        sk_rings, sk_isp, sk_levels = skirted_rings(body, sk_top, za + 0.012, 0.015, boff, 0.0, 0.45, extra=extra, key='skirt')
        loft_skirted(body, bottom, sk_rings, sk_isp, key='skirt')
    out.append(bottom)

    # ---- trim: a neckline band on the woman's kurti, the child's crew neck and the elder's blouse, a belt on the man, a hem border on the saree
    if outfit in ('kurti', 'tunic'):
        trim.ring_loft(torso_levels(body, z_collar + 0.002, z_collar - 0.020, 0.008, lambda z: off(z) + 0.004), 'collar')
    elif outfit == 'tee':
        trim.ring_loft(torso_levels(body, z_collar + 0.0, z_collar - 0.016, 0.0055, lambda z: off(z) + 0.0045), 'collar')
    elif outfit == 'saree':
        trim.ring_loft(torso_levels(body, z_collar + 0.002, z_collar - 0.022, 0.008, lambda z: off(z) + 0.004), 'collar')
    if outfit == 'shirt':                 # a belt round the waist over the waistband, with a buckle at the front (role wrap, pearl)
        belt = torso_levels(body, zw + 0.004, zw - 0.030, 0.0057, lerp_off([(zw + 0.004, 0.0185), (zw - 0.030, 0.0185)]), n=32)
        trim.ring_loft(belt, 'belt')
        extras.append(buttons_mesh(belt, [zw - 0.013], 0.0045, r=0.019, rz=0.0125))
    def hem_band(rings, levels, z_lo, z_hi, grow):
        band = [inflate(r, grow) for r, z in zip(rings, levels) if z_lo - 1e-6 <= z <= z_hi + 1e-6]
        for side in ('l', 'r'):
            rs = [inflate(r, 0.003) for r in band] if side == 'r' else band
            trim.ring_loft(rs, 'pan_' + side, cols=arc_cols(body, len(band[0]), side), close=True)
    if outfit == 'saree':
        hem_band(sk_rings, sk_levels, za + 0.012, za + 0.05, 0.004)
    # ---- wrap: the pallu (elder), a draped band with thickness and soft folds
    if outfit == 'saree':
        assert body.sx > 0, 'the wrap path assumes +x is the character\'s left'
        wrap = Mesh('wrap')
        table = dressed_table(body, [top_rings, sk_rings])
        zs_ = zsh
        # 1.4 cm above the dressed surface, and a further 3.4 cm over the shoulders so the band clears the sleeve caps
        wo = lambda z: 0.014 + 0.034 * float(smoothstep((z - (zs_ - 0.07)) / 0.05))
        hangf = lambda z, z0, span: float(smoothstep((z0 - z) / span))     # 0 on the shoulders, 1 well down the body
        z0, z1 = sk_top - 0.02, zs_ + 0.01      # the sash starts at the skirt's waist and is tucked into it
        pts = [(-30, z0), (-2, z0 + 0.30 * (z1 - z0)), (38, z0 + 0.68 * (z1 - z0)), (84, z1), (110, zs_ - 0.035), (136, zs_ - 0.12 * H),
               (154, zs_ - 0.28 * H), (162, zk + 0.10)]
        grid = strip_grid(table, pts, lambda u: 0.115 + 0.04 * smoothstep((u - 0.45) / 0.55),
                          lambda z: wo(z) + 0.008 * hangf(z, zs_ - 0.12, 0.35),
                          lambda u, v, z: (0.0025 + 0.008 * smoothstep((u - 0.4) / 0.4)) * math.sin(math.pi * (2.0 + 2.0 * smoothstep((u - 0.45) / 0.4)) * v + 2.0 * u) - 0.003 * v * v - 0.035 * (1 - float(smoothstep(u / 0.08))),
                          rows_per=9)
        emit_strip(wrap, table, grid, 0, len(grid) - 1, 0.006)
        out.append(wrap)       # no gold border on the pallu: its thin closed shell shows as teeth once skinned and simplified
    out.extend(extras)
    out.append(trim)
    return out


# ---------------------------------------------------------------- fit report (garment against body, rest pose)

def _perimeter(pts2, centre, n=48):
    """Length of the smoothed outline of 2D points around `centre` (polar_ring's outline), metres."""
    r = polar_ring(pts2, centre, n)
    a = angles(n)
    P = np.stack([centre[0] + r * np.cos(a), centre[1] + r * np.sin(a)], axis=1)
    return float(np.linalg.norm(P - np.roll(P, 1, axis=0), axis=1).sum())

def _slice_perimeter(body, origin, dirs):
    """Length of the skin's true section (rays from `origin` along the unit vectors `dirs`), metres; None if a ray misses."""
    pts = []
    for d in dirs:
        hit = body.bvh.ray_cast(Vector(origin), Vector(d), 0.4)
        if hit[0] is None:
            return None
        pts.append(np.array(hit[0]))
    P = np.array(pts)
    return float(np.linalg.norm(P - np.roll(P, 1, axis=0), axis=1).sum())

def fit_report(key, body, meshes, say=print):
    """Circumference of each garment against the skin under it at chest, waist, hip, hem and upper arm and forearm, in the
    T-pose (cm and ratio). A ratio of 1.10 means the garment is 10 % longer around than the body, about 1.6 cm of offset all
    round at the chest. Prints one FITM line per measure and returns {name: (body_cm, garment_cm)}."""
    H = body.H
    res = {}
    def band(V, z, dz=0.012):
        return V[np.abs(V[:, 2] - z) < dz]
    def torso_pair(role, tags, z, dz=0.012, skin_mask=None):
        m = meshes.get(role)
        if m is None:
            return
        V = np.array(m.v)
        sel = np.array([t in tags for t in m.tag])
        g = band(V[sel], z, dz)
        sk = band(body.V[skin_mask if skin_mask is not None else body.trunk], z, dz)
        if len(g) < 3 or len(sk) < 3:
            return
        c = np.array([0.0, (sk[:, 1].min() + sk[:, 1].max()) / 2])
        return 100 * _perimeter(sk[:, :2], c), 100 * _perimeter(g[:, :2], c)
    zw = body.z_hip + 0.05 * H
    top_tags = ('torso', 'pan_l', 'pan_r')
    zhip = max(np.arange(body.z_hip - 0.14, body.z_hip + 0.02, 0.01), key=lambda z: _perimeter(band(body.V[body.trunk], z)[:, :2], np.array([0.0, (band(body.V[body.trunk], z)[:, 1].min() + band(body.V[body.trunk], z)[:, 1].max()) / 2]))) if True else 0
    for name, z, role, tags in (('chest', body.z_shoulder - 0.10 * H, 'top', top_tags), ('waist', zw, 'top', top_tags), ('hip', zhip, 'top', top_tags)):
        r = torso_pair(role, tags, z)
        if r:
            res[name] = r
    # the hem: the top's lowest ring against the widest part of the skin (hips and thighs together)
    m = meshes.get('top')
    if m is not None:
        V = np.array(m.v)
        sel = np.array([t in top_tags for t in m.tag])
        zlow = V[sel][:, 2].min()
        g = band(V[sel], zlow + (0.17 if any(t == 'pan_l' for t in m.tag) else 0.03), 0.01)         # above the longest side slit (or vent), where the ring is whole
        sk = band(body.V[body.trunk], zhip, 0.012)
        if len(g) > 3 and len(sk) > 3:
            c = np.array([0.0, (sk[:, 1].min() + sk[:, 1].max()) / 2])
            res['hem above slit'] = (100 * _perimeter(sk[:, :2], c), 100 * _perimeter(g[:, :2], c))
    # sleeves: x runs along the arm in the T-pose
    for side in ('l',):
        sgn = body.side[side]
        arm = np.array([d.endswith('_' + side) and d.startswith(('upperarm', 'lowerarm', 'hand')) for d in body.dom]) & (body.V[:, 0] * sgn > 0)
        x0 = abs(body.bone['upperarm_' + side][0][0])
        xe = abs(body.bone['lowerarm_' + side][0][0])
        xw = abs(body.bone['hand_' + side][0][0])
        sm = meshes.get('top')
        if sm is None:
            continue
        V = np.array(sm.v)
        sel = np.array([t == 'sleeve_' + side for t in sm.tag])
        xmax = np.abs(V[sel][:, 0]).max()
        xs = np.unique(np.round(np.abs(V[sel][:, 0]), 4))          # the sleeve's rings run along x
        for name, x in (('upperarm', x0 + 0.40 * (xe - x0)), ('elbow', xe), ('forearm', xe + 0.55 * (xw - xe))):
            if x > xmax - 0.005:
                continue
            xr = xs[np.argmin(np.abs(xs - x))]
            g = V[sel & (np.abs(np.abs(V[:, 0]) - xr) < 0.001)][:, 1:3]
            sk = body.V[arm & (np.abs(np.abs(body.V[:, 0]) - xr) < 0.012)][:, 1:3]
            if len(g) < 3 or len(sk) < 3:
                continue
            c = sk.mean(axis=0)
            dirs = [(0.0, math.cos(t), math.sin(t)) for t in angles(72)]
            pk = _slice_perimeter(body, (sgn * xr, c[0], c[1]), dirs)
            res['sleeve ' + name] = (100 * (pk if pk else _perimeter(sk, c, 36)), 100 * _perimeter(g, c, 36))
    bm = meshes.get('bottom')
    if bm is not None and any(t == 'torso' for t in bm.tag):       # a skirt (the saree): both legs inside one outline
        V = np.array(bm.v)
        sel = np.array([t in top_tags for t in bm.tag])
        zlow = V[sel][:, 2].min()
        for name, z in (('skirt hip', zhip), ('skirt knee', body.z_knee), ('skirt hem', zlow + 0.01)):
            g = band(V[sel], z, 0.01)
            sk = band(body.V[body.trunk], min(z, body.z_ankle + 0.1) if name == 'skirt hem' else z, 0.012)
            if len(g) > 3 and len(sk) > 3:
                c = np.array([0.0, (sk[:, 1].min() + sk[:, 1].max()) / 2])
                res[name] = (100 * _perimeter(sk[:, :2], c), 100 * _perimeter(g[:, :2], c))
    elif bm is not None and body.sx:
        # trousers: one leg, thigh / knee / ankle

        sd = 'l'
        leg = np.array([d.endswith('_' + sd) and d.startswith(('thigh', 'calf')) for d in body.dom])
        V = np.array(bm.v)
        sel = np.array([t in ('leg_' + sd, 'pan_' + sd, 'torso') for t in bm.tag])
        for name, z in (('thigh', body.z_crotch - 0.05), ('knee', body.z_knee), ('calf', body.z_knee - 0.5 * (body.z_knee - body.z_ankle)), ('ankle', body.z_ankle + 0.06)):
            g = band(V[sel], z, 0.01)
            sk = band(body.V[leg], z, 0.012)
            if len(g) < 3 or len(sk) < 3:
                continue
            g = g[g[:, 0] * body.side[sd] > -0.02]
            c = sk[:, :2].mean(axis=0)
            dirs = [(math.cos(t), math.sin(t), 0.0) for t in angles(72)]
            pk = _slice_perimeter(body, (c[0], c[1], z), dirs)
            res['bottom ' + name] = (100 * (pk if pk else _perimeter(sk[:, :2], c, 36)), 100 * _perimeter(g[:, :2], c, 36))
    for name, (b, g) in res.items():
        say('FITM %s %-16s body %6.1f cm  garment %6.1f cm  ratio %.3f  (+%.1f cm radius)' % (key, name, b, g, g / b, (g - b) / (2 * math.pi)))
    return res

# ---------------------------------------------------------------- weights

CALF_LEAD = float(arg('--calf-lead', '0'))
PANEL_THIGH_ONLY = '--panel-thigh-only' in argv   # panels of a kurta or kameez hang from the thigh alone (they end above the knee)
SLEEVE_PASSES = int(arg('--sleeve-passes', '3'))
LEG_PASSES = int(arg('--leg-passes', '16'))   # smoothing passes of the trousers' weights: fewer follow the skin more closely at the knee
HAND_HI = float(arg('--hand-hi', '0.17'))      # trousers: the legs' weights take over from the body's this far above the crotch ...
HAND_SPAN = float(arg('--hand-span', '0.10'))   # ... over this distance
LEG_SHARE = float(arg('--leg-share', '0.55'))   # how much of its leg's motion a panel takes below the hip (the rest stays with the pelvis, as hanging cloth lags)

def skin_copy(p, body, tree=None, k=4):
    """Skin weights at point p: the nearest k skin vertices' weights, weighted by inverse distance."""
    ws, tot = {}, 0.0
    for co, idx, dist in (tree or body.tree).find_n(p, k):
        w = 1.0 / (dist + 0.01)
        for bw, bn in body.weights[idx]:
            ws[bn] = ws.get(bn, 0.0) + bw * w
        tot += w
    return {n: x / tot for n, x in ws.items()}

def leg_weights(p, body, side, share=1.0, thigh_only=False, hand=None, shoe_free=False):
    """Cloth that hangs on one leg (a trouser leg, one panel of a kurta or skirt): above the hip joint it takes the body's
    weights, below it the weights of the nearest skin of that leg only, with a smooth hand-over across 12 cm, so it moves as
    the leg's own skin does and never takes the other leg's motion."""
    z_hi, span = hand or (body.z_hip + 0.05, 0.12)
    t = float(smoothstep((z_hi - p.z) / span))
    a = skin_copy(p, body)
    if t <= 0:
        return a
    b = skin_copy(p, body, body.leg_tree[side])
    if thigh_only:
        for n in ('calf_' + side, 'foot_' + side, 'ball_' + side):
            if n in b:
                b['thigh_' + side] = b.get('thigh_' + side, 0.0) + b.pop(n)
    if shoe_free:       # a trouser leg's hem hangs from the calf: it does not swing with the foot, the shoe moves inside it
        for n in ('foot_' + side, 'ball_' + side):
            if n in b:
                b['calf_' + side] = b.get('calf_' + side, 0.0) + b.pop(n)
    k = share
    b = {n: b.get(n, 0.0) * k + (1 - k if n == 'pelvis' else 0.0) for n in set(b) | {'pelvis'}}
    return {n: a.get(n, 0.0) * (1 - t) + b.get(n, 0.0) * t for n in set(a) | set(b)}

def weight_garment(obj, body, mesh, spec, passes=16):
    """Skin weights for a garment: panels and trouser legs follow their own leg (leg_weights), everything else copies the
    nearest skin; then smoothed over the garment's own surface so neighbouring vertices move together."""
    me = obj.data
    obj.vertex_groups.clear()
    n = len(me.vertices)
    W = []
    MW = BASE.matrix_world.copy()
    for i, v in enumerate(me.vertices):
        p = MW @ Vector(v.co)
        if i in mesh.anchor:
            p = Vector(mesh.anchor[i])
        tag = mesh.tag[i] if i < len(mesh.tag) else None
        if tag and tag.startswith(('leg_', 'pan_')):
            ws = leg_weights(p, body, tag[-1], LEG_SHARE if (tag.startswith('pan_') and mesh.role == 'top') else 1.0, tag.startswith('pan_') and mesh.role != 'bottom' and PANEL_THIGH_ONLY,
                             hand=(body.z_crotch + HAND_HI, HAND_SPAN) if tag.startswith('leg_') else None, shoe_free=tag.startswith('leg_') and mesh.role == 'bottom')   # trousers follow the body above the crotch, each leg's own skin below it
        else:
            ws = skin_copy(p, body)
        W.append(ws)
    nbr = [set() for _ in range(n)]
    for poly in me.polygons:
        vs = list(poly.vertices)
        for a in vs:
            for b in vs:
                if a != b:
                    nbr[a].add(b)
    # sleeves take the skin's own weights almost as they are (3 passes): the more they are smoothed the further their hand-over
    # at the elbow lags the skin's, and the skin shows through the inside of the bend
    frozen_after = {i: SLEEVE_PASSES for i in range(n) if i < len(mesh.tag) and mesh.tag[i] and mesh.tag[i].startswith('sleeve_')}
    for it in range(passes):
        W2 = []
        for i in range(n):
            if it >= frozen_after.get(i, passes):
                W2.append(W[i])
                continue
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
    # The crown. The loft above ends in a flat disc at z_top - 4 mm, which is BELOW the skull's summit: the scalp came through it
    # as a bald spot (SPEC 16.6.9). Close the top with a dome over the whole skull instead, at least 0.9 of the hair's thickness
    # clear of the skin everywhere, then fan it to one apex vertex.
    z0 = z_top - 0.004
    Rd = rows[0][:, :2] - np.array([centre[0], centre[1]])
    Rd = np.hypot(Rd[:, 0], Rd[:, 1])                       # the loft's first ring, per column (already skin outline + hair thickness)
    for _ in range(3):                                       # the skin's outline is a little ragged: a smooth crown, never inside it
        Rd = np.maximum(0.25 * np.roll(Rd, 1) + 0.5 * Rd + 0.25 * np.roll(Rd, -1), Rd * 0.99)
    need = 0.012
    px = pts[:, 0] - centre[0]
    py = pts[:, 1] - centre[1]
    pr = np.hypot(px, py)
    pa = np.arctan2(py, px)
    cols = ((pa + math.pi) / (2 * math.pi) * n).astype(int) % n
    for v in range(len(pts)):
        if pts[v, 2] < z0 - 0.03:
            continue
        rr = min(pr[v] / Rd[cols[v]], 0.985)
        need = max(need, (pts[v, 2] + 0.9 * thick - z0) / math.sqrt(1 - rr * rr))
    dome = []
    for ph in (80, 66, 52, 38, 24, 11):
        c, sn = math.cos(math.radians(ph)), math.sin(math.radians(ph))
        dome.append(np.array([(centre[0] + Rd[j] * c * math.cos(a[j]), centre[1] + Rd[j] * c * math.sin(a[j]), z0 + need * sn) for j in range(n)]))
    m = Mesh('hair')
    base_i = m.ring_loft(dome + rows, 'cap')
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
        out.append((hair_cap(body, ze, sc, 0.010, front=0.06, side=0.012, back=-0.05), 'head'))
    elif style == 'braid':
        out.append((hair_cap(body, ze, sc, 0.010, front=0.063, side=0.0, back=-0.075), 'head'))
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
        out.append((hair_cap(body, ze, sc, 0.010, front=0.06, side=0.012, back=-0.06), 'head'))
        pts = body.V[body.is_head]
        out.append((sphere_mesh((0.0, float(pts[:, 1].max()) + 0.015 * sc, ze + 0.045 * sc), (0.062 * sc, 0.055 * sc, 0.05 * sc), 'bun'), 'head'))
    elif style == 'pigtails':
        out.append((hair_cap(body, ze, sc, 0.010, front=0.06, side=0.02, back=-0.04), 'head'))
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

TOP_TINT = {'man': '#7FA7D8', 'woman': '#4FA3A0', 'elder': '#B2A3D1', 'child': '#3BAA5C'}   # the tint of each person's default height (TOP_TINTS in src/look/people-materials.ts)
OUTFIT = {  # keep in step with OUTFITS in src/look/people-materials.ts
    'man': dict(bottom='#565C68', wrap='#EFEBE0', trim='#2B1D15', hair='#1D1815', brows='#1A1512', shoes='#4B3A2E'),
    'woman': dict(bottom='#CBB994', wrap='#9A2E4C', trim='#EDE4CF', hair='#1A1513', brows='#1A1512', shoes='#5A4232'),
    'elder': dict(bottom='#3E4A6B', wrap='#3E4A6B', trim='#E8E0D0', hair='#D9D5CD', brows='#B9B4AB', shoes='#4B3A2E'),
    'child': dict(bottom='#3F5F8F', wrap='#E3DAC4', trim='#F2F0EA', hair='#1D1815', brows='#1A1512', shoes='#C0563A'),
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

# ---------------------------------------------------------------- posed contact sheets (verification only, nothing ships from here)
# The runtime moves the bodies with the mannequin clips retargeted by world-space rotation change (src/look/retarget.ts).
# This does the same in Blender from samples of the clips (tools/dump-clip-samples.ts), so the garments can be looked at
# in the real walk, jog, idle and sit frames, side and back, before anything is opened in the app.

def def_key(name):
    """Target bone -> the mannequin node name three's loader gives it (dots stripped), or None."""
    fixed = {'pelvis': 'DEF-hips', 'spine_01': 'DEF-spine001', 'spine_02': 'DEF-spine002', 'spine_03': 'DEF-spine003', 'neck_01': 'DEF-neck', 'head': 'DEF-head'}
    if name in fixed:
        return fixed[name]
    sd = {'clavicle': 'shoulder', 'upperarm': 'upper_arm', 'lowerarm': 'forearm', 'hand': 'hand', 'thigh': 'thigh', 'calf': 'shin', 'foot': 'foot', 'ball': 'toe'}
    parts = name.split('_')
    if len(parts) == 2 and parts[0] in sd and parts[1] in ('l', 'r'):
        return 'DEF-%s%s' % (sd[parts[0]], parts[1].upper())
    if len(parts) == 3 and parts[2] in ('l', 'r') and parts[0] in ('index', 'middle', 'ring', 'pinky'):
        return 'DEF-f_%s%s%s' % (parts[0], parts[1].replace('_', ''), parts[2].upper())
    if len(parts) == 3 and parts[2] in ('l', 'r') and parts[0] == 'thumb':
        return 'DEF-thumb%s%s' % (parts[1], parts[2].upper())
    return None

CM = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))   # Blender -> glTF axes

def pose_sample(rig, frame, hips_scale, legs_straight=False):
    from mathutils import Quaternion
    rot = {}
    heads = {}
    mats = {}
    ident = Matrix.Identity(3)
    for pb in sorted(rig.pose.bones, key=depth):
        b = pb.bone
        dn = def_key(pb.name)
        dq = frame['dq'].get(pb.name) or (frame['dq'].get(dn) if dn else None)   # samples of the shipped clips are keyed by our own bone names, the old mannequin ones by DEF- names
        if legs_straight and pb.name.startswith(('thigh', 'calf', 'foot', 'ball')):
            dq = [0, 0, 0, 1]
        if dq is not None:
            q = Quaternion((dq[3], dq[0], dq[1], dq[2]))
            D = CM.transposed() @ q.to_matrix() @ CM
        else:
            D = rot[pb.parent.name] if pb.parent else ident
        rot[pb.name] = D
        head = Vector(b.head_local)
        if pb.parent:
            head = heads[pb.parent.name] + rot[pb.parent.name] @ (head - Vector(pb.parent.bone.head_local))
        if pb.name == 'pelvis' and frame.get('hips'):
            h = frame['hips']
            head = head + Vector((h[0], -h[2], h[1])) * hips_scale
        heads[pb.name] = head
        M = (D @ b.matrix_local.to_3x3()).to_4x4()
        M.translation = head
        mats[pb.name] = M
        # the channels that give this pose matrix, worked out here (pb.matrix = would read the parent's stale pose matrix)
        if pb.parent:
            base = mats[pb.parent.name] @ pb.parent.bone.matrix_local.inverted() @ b.matrix_local
        else:
            base = b.matrix_local
        loc = base.inverted() @ M
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = loc.to_quaternion()
        pb.location = loc.to_translation()
    bpy.context.view_layer.update()

def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()

def sheet_scene(res):
    scn = bpy.context.scene
    scn.view_settings.view_transform = 'Standard'
    scn.render.image_settings.file_format = 'PNG'
    try:
        scn.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scn.render.engine = 'BLENDER_EEVEE_NEXT'
    scn.render.resolution_x, scn.render.resolution_y = res
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
    world = scn.world or bpy.data.worlds.new('w')
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*srgb_lin('#C9C2B6'), 1)
    bg.inputs['Strength'].default_value = 1.0
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scn.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.sensor_fit = 'VERTICAL'
    scn.camera = cam
    for loc, energy, col in (((2.0, -3.0, 3.0), 2.6, (1, 0.96, 0.9)), ((-3, -2, 1.5), 1.2, (0.9, 0.93, 1.0)), ((0, 3, 2), 1.6, (1, 1, 1)), ((3, 2, 1.0), 1.0, (1, 1, 1))):
        ld = bpy.data.lights.new('l', 'SUN')
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new('l', ld)
        lo.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scn.collection.objects.link(lo)
    return cam

def point_cam(cam, target, yaw_deg, elev_deg, dist, scale):
    yaw, el = math.radians(yaw_deg), math.radians(elev_deg)
    cam.location = (target[0] + math.sin(yaw) * math.cos(el) * dist, target[1] - math.cos(yaw) * math.cos(el) * dist, target[2] + math.sin(el) * dist)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale

def render_sheets(key, rig, body, objs, final):
    """Cells are written as <SHEETS>/<tag><key>__<sheet>__<view>__<NN>.png; tools/compose-sheets.mjs tiles them."""
    samples = json.load(open(CLIP_SAMPLES))
    thumb_colours(key, final)
    cam = sheet_scene(tuple(int(v) for v in (arg('--res') or '300x400').split('x')))
    if '--fast' in argv:    # Workbench with flat studio light: seconds instead of minutes, for iterating on the hems
        scn0 = bpy.context.scene
        scn0.render.engine = 'BLENDER_WORKBENCH'
        scn0.display.shading.light = 'STUDIO'
        scn0.display.shading.color_type = 'MATERIAL'
        scn0.display.shading.show_cavity = True
        scn0.view_settings.view_transform = 'Standard'
        for o in final.values():
            for m in o.data.materials:
                m.diffuse_color = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
    for role in (arg('--hide') or '').split(','):
        if role in final:
            final[role].hide_render = True
    H = body.H
    hips_scale = float(rig.data.bones['pelvis'].head_local[2]) / (samples['restPos'].get('pelvis') or samples['restPos']['DEF-hips'])[1]
    os.makedirs(SHEETS, exist_ok=True)
    scn = bpy.context.scene
    lower = (0.31 * H, 0.66 * H, 0.0)          # crop centre z, vertical extent, centre y
    upper = (0.72 * H, 0.50 * H, 0.0)
    def run(sheet, clip, frames, views, crop, straight=False, lie=False):
        data = samples[clip]['frames']
        for i, fi in enumerate(frames):
            reset_pose(rig)
            pose_sample(rig, data[fi], hips_scale, legs_straight=straight)
            if lie:
                rig.rotation_euler = (math.radians(-90), 0, 0)
                ground(rig, objs)
            for view, yaw, el in views:
                point_cam(cam, (0.0, crop[2], crop[0]), yaw, el, 6.0, crop[1])
                scn.render.filepath = os.path.join(SHEETS, '%s%s__%s__%s__%02d.png' % (SHEET_TAG, key, sheet, view, i))
                bpy.ops.render.render(write_still=True)
            if lie:
                rig.rotation_euler = (0, 0, 0)
                ground(rig, objs)
    SIDE, BACK, F34, B34 = ('side', 270, 0), ('back', 180, 0), ('front34', 330, 8), ('back34', 215, 8)
    which = (argv[argv.index('--sheet-set') + 1] if '--sheet-set' in argv else 'walk,jog,upper,idle,sit,lie').split(',')
    if 'rest' in which:
        reset_pose(rig)
        if '--rest-pose' in argv:        # e.g. --rest-pose Walk_Loop 3: the 'rest' views at a clip frame instead of the T-pose
            rp = argv.index('--rest-pose')
            pose_sample(rig, samples[argv[rp + 1]]['frames'][int(argv[rp + 2])], hips_scale)
        for i, (view, yaw, el) in enumerate([('side', 270, 0), ('back', 180, 0), ('front34', 330, 8), ('back34', 215, 8)]):
            zoom = [float(x) for x in argv[argv.index('--zoom') + 1:argv.index('--zoom') + 4]] if '--zoom' in argv else None
            point_cam(cam, (zoom[2] if zoom else 0.0, 0.0, zoom[0] if zoom else lower[0]), yaw, el, 6.0, zoom[1] if zoom else lower[1])
            scn.render.filepath = os.path.join(SHEETS, '%s%s__rest__%s__%02d.png' % (SHEET_TAG, key, view, 0))
            bpy.ops.render.render(write_still=True)
    if 'head' in which:      # the head from every side, above included: where a bald spot would show
        reset_pose(rig)
        zt = body.zmax - 0.11 * H / 1.7
        for i, (view, yaw, el) in enumerate([('top', 180, 87), ('backhigh', 180, 40), ('back', 180, 5), ('side', 270, 5), ('front34', 330, 10), ('sidehigh', 250, 45)]):
            point_cam(cam, (0.0, 0.0, zt), yaw, el, 6.0, 0.62 * H / 1.7)
            scn.render.filepath = os.path.join(SHEETS, '%s%s__head__v__%02d.png' % (SHEET_TAG, key, i))
            bpy.ops.render.render(write_still=True)
    if 'follow' in which:    # the whole body from behind and above (the follow camera's angle), the side and the front, standing and mid-stride
        run('follow', 'Idle_Loop', [0], [('behindhigh', 180, 38), ('side', 270, 8), ('front', 0, 12)], (0.5 * H, 1.04 * H, 0.0))
        run('followwalk', 'Walk_Loop', [0, 3, 6, 9], [('behindhigh', 180, 38), ('side', 270, 8)], (0.5 * H, 1.04 * H, 0.0))
    if 'walk' in which:
        run('walk', 'Walk_Loop', list(range(12)), [SIDE, BACK], lower)
    if 'jog' in which:
        run('jog', 'Jog_Fwd_Loop', list(range(8)), [SIDE, BACK], lower)
    if 'upper' in which:
        run('upper', 'Walk_Loop', [0, 3, 6, 9], [F34, B34, SIDE], upper)
    if 'idle' in which:
        run('idle', 'Idle_Loop', [0], [SIDE, BACK, F34], (0.5 * H, 1.04 * H, 0.0))
    if 'sit' in which:
        run('sit', 'Sitting_Idle_Loop', [0], [SIDE, BACK, F34], (0.5 * H, 1.04 * H, 0.0))
        run('sitenter', 'Sitting_Enter', [0, 1, 2, 3], [SIDE, BACK], (0.5 * H, 1.04 * H, 0.0))
    if 'fold' in which:
        run('fold', 'Idle_FoldArms_Loop', [0, 1, 2], [F34, BACK, SIDE], (0.5 * H, 1.04 * H, 0.0))
    if 'turn' in which:
        run('turn', 'Turn_Step', [0, 1, 2, 3], [F34, BACK], (0.4 * H, 0.9 * H, 0.0))
    if 'formal' in which:
        run('formal', 'Walk_Formal_Loop', [0, 3, 6, 9], [SIDE, BACK], lower)
    if 'lie' in which:
        run('lie', 'Idle_Loop', [0], [('side', 270, 0), ('above', 270, 80)], (0.1 * H, 1.45 * H, 0.5 * H), straight=True, lie=True)
    reset_pose(rig)

# ---------------------------------------------------------------- clearance measurement (verification and fitting)
# For each garment vertex, in every pose of the clips: its signed distance to the skin minus the thickest inner layer
# (trousers, then the top) within 4 cm of it. Below zero = the body or the layer under it has come through the cloth.

from mathutils.bvhtree import BVHTree

def all_poses(samples):
    """(label, clip, frame, legs_straight, lie): every pose the checks and the sheets use."""
    out = [('rest', None, 0, False, False)]
    for i in range(len(samples['Walk_Loop']['frames'])):
        out.append(('walk%02d' % i, 'Walk_Loop', i, False, False))
    for i in range(len(samples['Jog_Fwd_Loop']['frames'])):
        out.append(('jog%02d' % i, 'Jog_Fwd_Loop', i, False, False))
    out.append(('idle', 'Idle_Loop', 0, False, False))
    out.append(('sit', 'Sitting_Idle_Loop', 0, False, False))
    for i in range(len(samples['Sitting_Enter']['frames'])):
        out.append(('sitin%d' % i, 'Sitting_Enter', i, False, False))
    out.append(('lie', 'Idle_Loop', 0, True, True))
    for clip, tag in (('Walk_Formal_Loop', 'formal'), ('Idle_FoldArms_Loop', 'fold'), ('Turn_Step', 'turn')):
        for i in range(len(samples.get(clip, {}).get('frames', []))):
            out.append(('%s%02d' % (tag, i), clip, i, False, False))
    return out

def eval_world(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    P = a.reshape(-1, 3)
    mw = np.array(ev.matrix_world)
    P = P @ mw[:3, :3].T + mw[:3, 3]
    polys = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return P, polys

def skin_distance(bvh, P):
    d = np.empty(len(P))
    for i, p in enumerate(P):
        loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
        d[i] = dist if (Vector(p) - loc).dot(nrm) >= 0 else -dist
    return d

LAYERS = {'bottom': [], 'top': ['bottom'], 'wrap': ['bottom', 'top']}
RESTPOS = {}
ARM_MASK = None
IS_HEAD = None
SLEEVE_IDX = []
SLEEVE_X = []
LEG_MASK = None
HIDDEN_ABOVE = {}   # role -> height above which the layer is covered by the garment over it, so is not checked

def measure_clearance(rig, final, samples, hips_scale, radius=0.04):
    """Returns {role: array(n_vertices, n_poses)} of clearance in metres and the pose labels."""
    poses = all_poses(samples)
    res = {r: np.zeros((len(final[r].data.vertices), len(poses))) for r in LAYERS if r in final}
    for k, (label, clip, fi, straight, lie) in enumerate(poses):
        reset_pose(rig)
        if clip:
            pose_sample(rig, samples[clip]['frames'][fi], hips_scale, legs_straight=straight)
        if lie:
            rig.rotation_euler = (math.radians(-90), 0, 0)
            bpy.context.view_layer.update()
        Ps, polys = eval_world(final['skin'])
        # only the legs are the reference: a hand against the hip is not the cloth's business here, and cloth sinking into the belly
        # is hidden by the tube above it (the sheets show both)
        polys = [pl for pl in polys if any(ARM_MASK[v] for v in pl) is False and sum(1 for v in pl if LEG_MASK[v]) >= 2]
        bvh = BVHTree.FromPolygons([tuple(p) for p in Ps], polys)
        ds = {}
        pos = {}
        for r in LAYERS:
            if r in final:
                pos[r], _ = eval_world(final[r])
                ds[r] = skin_distance(bvh, pos[r])
        if label == 'rest':
            RESTPOS.update({r: p.copy() for r, p in pos.items()})
        for r, inner in LAYERS.items():
            if r not in final:
                continue
            need = np.full(len(pos[r]), 0.0)
            for q in inner:
                if q not in final:
                    continue
                kd = kdtree.KDTree(len(pos[q]))
                for i, p in enumerate(pos[q]):
                    kd.insert(Vector(p), i)
                kd.balance()
                for i, p in enumerate(pos[r]):
                    near = kd.find_range(Vector(p), radius)
                    if near:
                        need[i] = max(need[i], max(ds[q][j] for _, j, _ in near))
            res[r][:, k] = ds[r] - need
        if lie:
            rig.rotation_euler = (0, 0, 0)
    reset_pose(rig)
    return res, [p[0] for p in poses]

def adjusted(A, key_role, body, margin=0.004):
    """Clearance per vertex and pose relative to the rest pose (vertices that are buried by design, like the inner half of a
    trouser's hip ring, only count when they get worse than at rest), with the vertices where the two leg panels meet masked out:
    there one panel is meant to slide inside the other, and the outer one hides it."""
    rest = A[:, 0]
    adj = A[:, 1:] - np.minimum(rest, margin)[:, None]
    P = RESTPOS[key_role]
    # only below the hip joint is checked here: above it the arms hang against the trunk cloth and the armpit overlap is by design
    skip = (P[:, 2] > HIDDEN_ABOVE.get(key_role, 9.0)) | ~(P[:, 2] < body.z_hip + 0.02) | ((np.abs(P[:, 0]) < 0.13) & (P[:, 2] < body.z_hip + 0.05) & (key_role != 'bottom'))
    return adj, skip

def report_clearance(key, res, labels, body, margin=0.004, final=None):
    if '--debug-rest' in argv:
        for r, A in res.items():
            w = A[:, 0]
            for i in np.argsort(w)[:12]:
                print('REST', r, i, '%.1f mm' % (w[i] * 1000), tuple(round(float(x), 3) for x in RESTPOS[r][i]))
    for r, A in res.items():
        adj, skip = adjusted(A, r, body, margin)
        adj = adj[~skip]
        if not len(adj):
            print('CLEAR %s %-6s nothing below the hip to check' % (key, r))
            continue
        worst = adj.min(axis=1)
        bad = int((worst < 0).sum())
        k = int(adj.min(axis=0).argmin())
        print('CLEAR %s %-6s verts %5d (checked %5d)  under %.0f mm margin: %4d  worst %.1f mm (%s)' % (key, r, len(skip), len(worst), margin * 1000, bad, (worst.min() - 0) * 1000 - margin * 1000 * 0, labels[1:][k]))
        per = adj.min(axis=0)
        print('       per pose min (mm vs margin):', ' '.join('%s:%.0f' % (labels[1:][i], per[i] * 1000) for i in range(len(per))))
        if '--debug-pose' in argv:
            lab = argv[argv.index('--debug-pose') + 1]
            col = labels[1:].index(lab)
            idx = np.where(~skip)[0]
            ok = (RESTPOS[r][idx][:, 2] > body.z_ankle + 0.12) & (np.abs(RESTPOS[r][idx][:, 0]) > 0.05)     # (the hem's own rows are measured against the foot, the midline's against the other leg: leave them out)
            for q in np.argsort(np.where(ok, adj[:, col], 9.0))[:6]:
                i = idx[q]
                print('   POSE', lab, r, i, '%.0f mm' % (adj[q, col] * 1000), 'rest', tuple(round(float(x), 3) for x in RESTPOS[r][i]))
        if final is not None and '--debug-worst' in argv:
            idx = np.where(~skip)[0]
            for q in np.argsort(worst)[:6]:
                i = idx[q]
                print('   WORST', r, i, '%.0f mm' % (worst[q] * 1000), labels[1:][int(adj[q].argmin())], 'rest', tuple(round(float(x), 3) for x in RESTPOS[r][i]))

def measure_hands(rig, final, samples, hips_scale, body, say=print):
    """Hands against the trousers: how far (mm) the deepest hand or finger vertex sits inside the bottom cloth, per sitting and idle pose."""
    hand = np.array([d.startswith(('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')) for d in body.dom])
    idx = np.where(hand)[0]
    for label, clip, fi, straight, lie in all_poses(samples):
        if not label.startswith(('sit', 'idle', 'walk')):
            continue
        reset_pose(rig)
        pose_sample(rig, samples[clip]['frames'][fi], hips_scale, legs_straight=straight)
        Ps, spolys = eval_world(final['skin'])
        if '--hands-vs-skin' in argv:      # against the legs' own skin instead of the trousers: how far the hand sinks into the thigh
            lp = [pl for pl in spolys if sum(1 for v in pl if LEG_MASK[v]) >= 3]
            Pb, polys = Ps, lp
        else:
            Pb, polys = eval_world(final['bottom'])
        bvh = BVHTree.FromPolygons([tuple(p) for p in Pb], polys)
        worst, wi = 0.0, -1
        for i in idx:
            loc, nrm, _, dist = bvh.find_nearest(Vector(Ps[i]))
            if loc is None:
                continue
            d = dist if (Vector(Ps[i]) - loc).dot(nrm) >= 0 else -dist
            if d < worst:
                worst, wi = d, i
        say('HANDS %s deepest inside the trousers %.1f mm (vertex %d, %s)' % (label, -worst * 1000, wi, body.dom[wi] if wi >= 0 else '-'))
    reset_pose(rig)

def measure_sleeves(rig, final, samples, hips_scale, body, say=print):
    """Signed distance of every sleeve vertex to the skin of the arms (outside positive) in every clip pose, worst per distance
    along the arm: where the skin comes through the sleeve."""
    poses = [p for p in all_poses(samples) if p[0].startswith(('walk', 'idle', 'sit'))]
    top = final['top']
    tags = None
    worst = {}
    for label, clip, fi, straight, lie in poses:
        reset_pose(rig)
        pose_sample(rig, samples[clip]['frames'][fi], hips_scale, legs_straight=straight)
        Ps, polys = eval_world(final['skin'])
        polys = [pl for pl in polys if sum(1 for v in pl if ARM_MASK[v] and not IS_HEAD[v]) >= 3]
        bvh = BVHTree.FromPolygons([tuple(p) for p in Ps], polys)
        Pt, _ = eval_world(top)
        for i in SLEEVE_IDX:
            loc, nrm, idx, dist = bvh.find_nearest(Vector(Pt[i]))
            d = dist if (Vector(Pt[i]) - loc).dot(nrm) >= 0 else -dist
            xb = int(round(abs(SLEEVE_X[i]) / 0.04))
            if d < worst.get(xb, (9, ''))[0]:
                worst[xb] = (d, label)
            if d < -0.02 and '--debug-sleeve' in argv:
                g = {top.vertex_groups[ge.group].name: round(ge.weight, 2) for ge in top.data.vertices[i].groups}
                say('  SLV %s v%d x %.3f d %.0f mm weights %s' % (label, i, SLEEVE_X[i], d * 1000, g))
    reset_pose(rig)
    say('SLEEVE bones x: shoulder %.2f elbow %.2f wrist %.2f' % tuple(abs(body.bone[b + '_l'][0][0]) for b in ('upperarm', 'lowerarm', 'hand')))
    say('SLEEVE worst clearance by distance along the arm (4 cm bins, mm): ' + ' '.join('%d:%.0f(%s)' % (k, v[0] * 1000, v[1]) for k, v in sorted(worst.items())))

# ---------------------------------------------------------------- fitting: grow the cloth only where a pose would push the body through it

FIT_ITERS = int(arg('--fit-iters', '3'))
FIT_POSES = ('walk', 'idle', 'lie', 'sit')   # the poses the cloth is fitted to; jog is measured and looked at, not fitted ('sitin' is the same legs in transit)
FIT_CAP = {'top': 0.025, 'skirt': 0.02, 'leg_l': 0.006, 'leg_r': 0.006}   # most the fit may add: the trouser legs get 6 mm at most (more is a pad behind the knee)

def make_garment_objs(key, spec, body, extra):
    """The garment parts as weighted Blender objects, [(role, object)], and their Mesh data by role."""
    made, meshes = [], {}
    for mesh in build_garments(key, spec, body, extra):
        o = make_object(mesh, mesh.role, recalc=False)
        weight_garment(o, body, mesh, spec, passes=LEG_PASSES if mesh.role == 'bottom' else 16)
        made.append((mesh.role, o))
        meshes[mesh.role] = mesh
    return made, meshes

def smooth_cells(E, a):
    """Turn per-cell growth into a smooth bell: each row's largest growth spread around the ring as |sin(angle)|^1.5 (most at
    the front and back, where the legs swing into the cloth, none at the sides), never below what a cell already needed,
    then blurred between rows. A fit per cell alone gives lumps on the hem."""
    w = np.abs(np.sin(a)) ** 1.5
    E = np.maximum(E, E.max(axis=1, keepdims=True) * w[None, :])
    up = np.vstack([E[:1], E[:-1]])
    dn = np.vstack([E[1:], E[-1:]])
    return np.maximum(E, 0.25 * up + 0.5 * E + 0.25 * dn)

def fit_garments(key, spec, body, rig, skin, smp, hs, say=print):
    """Builds the garments, measures them in every clip pose, and adds to the radius of every ring cell whose cloth was
    pushed through, then builds again; returns the extra radii (SPEC 16.6.7: hems that never tear through the legs)."""
    extra = {}
    for it in range(FIT_ITERS + 1):
        made, meshes = make_garment_objs(key, spec, body, extra)
        roles = {}
        for role, o in made:
            roles.setdefault(role, []).append(o)
        final = {'skin': skin}
        for role, objs in roles.items():
            final[role] = join_role(objs, role)
            assign_material(final[role], role)
            parent_to(final[role], rig)
        bpy.context.view_layer.update()
        HIDDEN_ABOVE.clear()
        if spec['outfit'] != 'saree':
            HIDDEN_ABOVE['bottom'] = body.z_hip - 0.005
        res, labels = measure_clearance(rig, final, smp, hs)
        worst = {}
        grew = 0
        for role in ('top', 'bottom'):
            if role not in res:
                continue
            adj, skip = adjusted(res[role], role, body)
            cols = [i for i, l in enumerate(labels[1:]) if l.startswith(FIT_POSES)]
            a = adj[:, cols].min(axis=1)
            worst[role] = float(a[~skip].min()) if (~skip).any() else 0.0
            need = np.where(skip, 0.0, np.maximum(0.0, -a) + (0.003 if it < FIT_ITERS else 0.0))
            need = np.where(a < 0, need, 0.0)
            if it == FIT_ITERS:
                continue
            for vi, (k, row, col) in meshes[role].rc.items():
                if need[vi] > 0 and k in extra and k in FIT_CAP:
                    cell = extra[k]
                    cell[row, col] = min(FIT_CAP[k], cell[row, col] + need[vi])
                    grew += 1
        for k in [k for k in extra if k in FIT_CAP]:
            extra[k] = np.minimum(FIT_CAP[k], smooth_cells(extra[k], angles(extra[k].shape[1])))
        say('FIT %s iteration %d: worst clearance vs margin %s, cells grown %d, largest extra %s' % (
            key, it, {r: round(v * 1000) for r, v in worst.items()}, grew, {k: round(float(v.max()) * 1000) for k, v in extra.items() if k in FIT_CAP}))
        for o in list(final.values()):
            if o is not skin:
                me = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                bpy.data.meshes.remove(me)
        if not grew:
            break
    bpy.ops.outliner.orphans_purge(do_recursive=True)    # so the real parts get their plain names ('bottom', not 'bottom.004')
    return extra

report = {}
for key, spec in PEOPLE.items():
    if ONLY and key not in ONLY.split(','):
        continue
    blend = os.path.join(CACHE, key + '-body.blend') if CACHE else None
    if blend and os.path.isfile(blend) and '--rebuild-body' not in argv:
        bpy.ops.wm.open_mainfile(filepath=blend)
        base = bpy.data.objects[key + '-body']
        rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
        parts = [o for o in bpy.data.objects if o.type == 'MESH' and o is not base]
        meshes = [base] + parts
    else:
        base, rig, parts = build_body(key, spec)
        finish_body(base, parts)
        meshes = [base] + parts
        face_work(base, rig, find(parts, 'high-poly'), None, 1.0)
        tpose(rig, meshes, spec)
        ground(rig, meshes)
        if blend:
            os.makedirs(CACHE, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=blend)
    body = Body(base, rig)
    BASE = base
    eyes, brows, shoes = find(parts, 'high-poly'), find(parts, 'eyebrow'), find(parts, 'shoes05')
    skin = base

    ARM_MASK = body.is_arm | body.is_head
    IS_HEAD = body.is_head
    LEG_MASK = np.array([d.startswith(('thigh', 'calf', 'foot', 'ball')) for d in body.dom])
    smp = json.load(open(CLIP_SAMPLES)) if CLIP_SAMPLES else None
    hs = float(rig.data.bones['pelvis'].head_local[2]) / (smp['restPos'].get('pelvis') or smp['restPos']['DEF-hips'])[1] if smp else 1.0
    extra = fit_garments(key, spec, body, rig, skin, smp, hs) if (smp and '--no-fit' not in argv) else {}
    made, gmeshes = make_garment_objs(key, spec, body, extra)   # (role, object)
    fit_report(key, body, gmeshes)
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
    report[key]['landmarks'] = {k: round(float(getattr(body, k)), 3) for k in ('z_hip', 'z_crotch', 'z_knee', 'z_ankle', 'z_shoulder', 'z_neck')}
    HIDDEN_ABOVE.clear()
    if spec['outfit'] != 'saree':
        HIDDEN_ABOVE['bottom'] = body.z_hip - 0.005
    if '--measure-sleeves' in argv and smp:
        tm = gmeshes['top']
        SLEEVE_IDX = [i for i, t in enumerate(tm.tag) if t and t.startswith('sleeve')]
        SLEEVE_X = [v[0] for v in tm.v]
        measure_sleeves(rig, final, smp, hs, body)
    if '--measure-hands' in argv and smp:
        measure_hands(rig, final, smp, hs, body)
    if MEASURE:
        res, labels = measure_clearance(rig, final, smp, hs)
        report_clearance(key, res, labels, body, final=final)
    if PREVIEW:
        render_preview(os.path.join(PREVIEW, key + '-front.png'), body.H, 30)
        render_preview(os.path.join(PREVIEW, key + '-back.png'), body.H, 200)
        render_preview(os.path.join(PREVIEW, key + '-side.png'), body.H, 90)
        render_preview(os.path.join(PREVIEW, key + '-head.png'), body.H, 20, (520, 520), focus=ze - 0.035)
    if SHEETS:
        render_sheets(key, rig, body, objs, final)
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
