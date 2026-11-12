"""Builds the two walkthru bodies (SPEC 16.6.2, route A) with MPFB2 in headless Blender.

    blender -b -P tools/make_people.py -- --out public/characters/src [--assets-zip makehuman_system_assets_cc0.zip]

Needs the MPFB2 add-on (extension id "mpfb", 2.0.18) enabled and MakeHuman's CC0 system asset pack unpacked into MPFB's
user data directory (the script unpacks it from --assets-zip when the folders are missing). MPFB2 is GPL and is only a
tool here: nothing of it ships. The output of this script is raw (large PNG textures, ~40k triangles); the size work
(decimate, resize, meshopt) is done by tools/optimise-people.mjs.

For each body it: creates a default adult (young adult, average weight and muscle, proportions untouched), applies a
MakeHuman system skin, eyes, eyebrows, eyelashes, clothes, shoes and hair from the SYSTEM pack only, adds MPFB's
"game_engine" rig (Unreal-style bone names), deletes the body faces hidden under clothes plus all helper geometry, and
exports Y-up GLB with feet at the origin.
"""
import bpy, sys, os, json, zipfile, math, bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

OUT = os.path.abspath(arg('--out', 'public/characters/src'))
ASSETS_ZIP = arg('--assets-zip')
ONLY = arg('--only')            # 'male' or 'female'
REST_JSON = arg('--mannequin-rest', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mannequin-rest.json'))
FEMALE_CLOTHES = arg('--female-clothes')
FILE_SUFFIX = arg('--suffix', '')
os.makedirs(OUT, exist_ok=True)

EXT = 'bl_ext.user_default.mpfb'
bpy.ops.preferences.addon_enable(module=EXT)
import importlib
svc = importlib.import_module(EXT + '.services')
HumanService, LocationService = svc.HumanService, svc.LocationService
TargetService = svc.TargetService

DATA = LocationService.get_user_data()
if not os.path.isdir(os.path.join(DATA, 'clothes')):
    if not ASSETS_ZIP:
        raise SystemExit('system assets are not installed in %s and --assets-zip was not given' % DATA)
    with zipfile.ZipFile(ASSETS_ZIP) as z:
        z.extractall(DATA)

def asset(kind, name):
    p = os.path.join(DATA, kind, name, name + '.mhclo')
    if not os.path.isfile(p):
        have = sorted(os.listdir(os.path.join(DATA, kind)))
        raise SystemExit('system asset %s/%s is missing. Present in %s: %s' % (kind, name, kind, ', '.join(have)))
    return p

BODIES = {
    'male': dict(
        gender=1.0, skin='young_asian_male', clothes=['male_casualsuit06'], shoes='shoes05', hair='short01',
        eyebrows='eyebrow001', eyelashes='eyelashes01', file='person-m'),
    'female': dict(
        gender=0.0, skin='young_asian_female', clothes=['female_casualsuit01'], shoes='shoes05', hair='long01',
        eyebrows='eyebrow001', eyelashes='eyelashes01', file='person-f'),
}

def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module=EXT)

def build(key, spec):
    clear_scene()
    macro = TargetService.get_default_macro_info_dict()
    macro['gender'] = spec['gender']
    # age 0.5 = 25 years, weight / muscle / proportions / height left at their 0.5 defaults
    base = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True,
                                     feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    base.name = key + '-body'
    rig = HumanService.add_builtin_rig(base, 'game_engine', import_weights=True)
    skin = os.path.join(DATA, 'skins', spec['skin'], spec['skin'] + '.mhmat')
    HumanService.set_character_skin(skin, base, skin_type='GAMEENGINE')
    parts = []
    def add(kind, name, atype):
        o = HumanService.add_mhclo_asset(asset(kind, name), base, asset_type=atype, material_type='GAMEENGINE',
                                         subdiv_levels=0, set_up_rigging=True, interpolate_weights=True, import_weights=True)
        parts.append(o)
        return o
    add('eyes', 'high-poly', 'Eyes')
    add('eyebrows', spec['eyebrows'], 'Eyebrows')
    add('eyelashes', spec['eyelashes'], 'Eyelashes')
    for c in spec['clothes']:
        add('clothes', c, 'Clothes')
    add('clothes', spec['shoes'], 'Clothes')
    add('hair', spec['hair'], 'Hair')
    return base, rig, parts

def finish(key, base, rig, parts):
    """Strip hidden faces and helper geometry, bake shape keys, return the objects to export."""
    # bake the macro shape keys
    bpy.context.view_layer.objects.active = base
    base.select_set(True)
    if base.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(base.modifiers):
        if m.type != 'ARMATURE':
            base.modifiers.remove(m)
    # keep only the visible skin: group "body" minus every Delete.* group (faces under clothes)
    vg = base.vertex_groups
    body_idx = vg['body'].index
    delete_idx = [g.index for g in vg if g.name.startswith('Delete.')]
    bm = bmesh.new()
    bm.from_mesh(base.data)
    dl = bm.verts.layers.deform.verify()
    kill = []
    for v in bm.verts:
        w = v[dl]
        in_body = w.get(body_idx, 0.0) > 0.5
        hidden = any(w.get(i, 0.0) > 0.5 for i in delete_idx)
        if (not in_body) or hidden:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(base.data)
    bm.free()
    base.data.update()
    # drop helper / delete vertex groups so the export is clean
    for g in list(base.vertex_groups):
        if g.name.startswith('Delete.') or g.name.startswith('helper-') or g.name.startswith('joint-') or g.name in ('body', 'Mid', 'Left', 'Right'):
            base.vertex_groups.remove(g)
    for o in parts:
        for m in list(o.modifiers):
            if m.type not in ('ARMATURE',):
                o.modifiers.remove(m)
    return [base] + parts


# ---------------------------------------------------------------- T-pose
# Our six clips are authored on the mannequin (a Rigify-style T-pose rig). MPFB's rig rests in an A-pose with a
# different bone roll on every bone. The clips are retargeted at run time by applying each bone's world-space change
# to the target's rest pose (src/look/retarget.ts), which only works when both rigs rest in the same pose. So the body
# is re-posed here: each limb bone is swung (minimal rotation, roll untouched) until it points where the mannequin's
# does, then that pose is baked into the mesh and made the rig's rest pose.
SRC = {  # MPFB bone -> (mannequin bone, mannequin bone the direction points at)
    'spine_01': ('DEF-spine.001', 'DEF-spine.002'), 'spine_02': ('DEF-spine.002', 'DEF-spine.003'),
    'spine_03': ('DEF-spine.003', 'DEF-neck'), 'neck_01': ('DEF-neck', 'DEF-head'), 'head': ('DEF-neck', 'DEF-head'),
}
for side, S in (('l', 'L'), ('r', 'R')):
    chain = [('upperarm', 'upper_arm', 'forearm'), ('lowerarm', 'forearm', 'hand'), ('hand', 'hand', 'f_middle.01')]
    for mb, sb, sc in chain:
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

def tpose(rig, parts, base):
    rest = json.load(open(REST_JSON))
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    for pb in sorted(rig.pose.bones, key=lambda b: depth(b)):
        if pb.name not in SRC:
            continue
        a, b = SRC[pb.name]
        want = (to_blender(rest[b]) - to_blender(rest[a])).normalized()
        bpy.context.view_layer.update()
        head = rig.matrix_world @ pb.head
        tail = rig.matrix_world @ pb.tail
        cur = (tail - head).normalized()
        q = cur.rotation_difference(want)
        m = pb.matrix.copy()
        loc = m.translation.copy()
        rot = q.to_matrix().to_4x4() @ m
        rot.translation = loc
        pb.matrix = rot
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    # bake the pose into every mesh, then make it the rest pose
    meshes = [base] + parts
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


def split_clothes(parts):
    """casualsuit meshes are two loose pieces, the top and the trousers: make them two objects so each gets its own colour."""
    out = []
    for o in parts:
        if 'casualsuit' not in o.name:
            out.append(o)
            continue
        stem = o.name
        before = set(bpy.data.objects)
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        pieces = [o] + [x for x in bpy.data.objects if x not in before]
        if len(pieces) != 2:
            raise SystemExit('expected the suit to have two loose pieces, got %d' % len(pieces))
        pieces.sort(key=lambda x: -max(v.co.z for v in x.data.vertices))
        pieces[0].name = pieces[0].data.name = stem + '.top'
        pieces[1].name = pieces[1].data.name = stem + '.bottom'
        out += pieces
    return out


def ground(rig, objs):
    """Put the lowest point of any mesh (the shoe soles) on z = 0, so the body stands exactly on the floor."""
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
    return low

def tri_count(objs):
    n = 0
    for o in objs:
        dg = bpy.context.evaluated_depsgraph_get()
        mesh = o.evaluated_get(dg).to_mesh()
        mesh.calc_loop_triangles()
        n += len(mesh.loop_triangles)
    return n

def export(key, spec, objs, rig):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs + [rig]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, spec['file'] + '.raw.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_animations=False, export_skins=True, export_morph=False, export_cameras=False, export_lights=False,
        export_image_format='AUTO', export_materials='EXPORT', export_extras=False, export_texcoords=True,
        export_normals=True, export_tangents=False, export_vertex_color='NONE')
    return path

report = {}
for key, spec in BODIES.items():
    if ONLY and ONLY != key:
        continue
    if key == 'female' and FEMALE_CLOTHES:
        spec['clothes'] = FEMALE_CLOTHES.split(',')
    spec['file'] += FILE_SUFFIX
    base, rig, parts = build(key, spec)
    objs = finish(key, base, rig, parts)
    parts = split_clothes(parts)
    objs = [base] + parts
    tpose(rig, parts, base)
    print('GROUND lifted by', ground(rig, objs))
    info = {o.name: {'tris': tri_count([o]), 'mats': [m.name for m in o.data.materials]} for o in objs}
    dims = {o.name: [round(c, 3) for c in o.dimensions] for o in objs}
    report[key] = {'objects': info, 'dims': dims, 'total_tris': tri_count(objs), 'bones': [b.name for b in rig.data.bones]}
    if '--save-blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, spec['file'] + '.blend'))
    report[key]['glb'] = export(key, spec, objs, rig)
    print('BUILT', key, json.dumps(report[key]['total_tris']))

with open(os.path.join(OUT, 'build-report.json'), 'w') as f:
    json.dump(report, f, indent=1)
print('DONE')
