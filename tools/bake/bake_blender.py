# Walkthru offline lighting bake (SPEC 16.13). Runs inside Blender, headless:
#   Blender -b --factory-startup -P tools/bake/bake_blender.py -- <workdir>/job.json
# Nothing here knows a scene, a room or a piece of furniture. It receives meshes (world space, with the lightmap UVs made by
# src/look/baked/unwrap.ts), emitters, sun directions and probe positions, and writes:
#   <out>/<tier>/<kind>-<component>.webp   lightmap pictures (kind: static = the room, dyn = per-object AO of movable pieces)
#   <out>/probes.bin                        Float32 SH L2 per probe per component (the light-probe grid, section 16.13)
#   <out>/results.json                      gains, timings, parity, calibration
# Units (see SPEC 16.13): a baked pixel is the irradiance a surface of albedo 1 would receive, in three.js light units, for a UNIT light:
#   sky   = one unit of hemisphere light (sky radiance 1/pi)       sun = three DirectionalLight intensity 1
#   lamps / cove = scaled so the mean floor irradiance of a lit room equals the job's target at level 1.
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

T0 = time.time()
PI = math.pi


def log(*a):
    print('[bake %6.1fs]' % (time.time() - T0), *a, flush=True)


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
JOB = json.load(open(argv[0]))
WORK = os.path.dirname(os.path.abspath(argv[0]))
OUT = JOB['outDir']
os.makedirs(OUT, exist_ok=True)

SCN_BIN = np.fromfile(os.path.join(WORK, 'scene.bin'), dtype=np.uint8)
UV_BIN = np.fromfile(os.path.join(WORK, 'uv.bin'), dtype=np.float32)
REMAP_BIN = np.fromfile(os.path.join(WORK, 'remap.bin'), dtype=np.uint32)


def f32(offset, count):
    return np.frombuffer(SCN_BIN.tobytes(), dtype=np.float32, count=count, offset=offset) if False else SCN_BIN[offset:offset + 4 * count].view(np.float32)


def u32(offset, count):
    return SCN_BIN[offset:offset + 4 * count].view(np.uint32)


def to_b(a):
    """three (x, y up, z) -> blender (x, -z, y up). A proper rotation, so winding is kept."""
    a = np.asarray(a, dtype=np.float64).reshape(-1, 3)
    return np.stack([a[:, 0], -a[:, 2], a[:, 1]], axis=1)


# ------------------------------------------------------------------ scene setup
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.samples = int(JOB['samples'])
cy.max_bounces = 6
cy.diffuse_bounces = 5
cy.glossy_bounces = 0
cy.transmission_bounces = 0
cy.transparent_max_bounces = 0
cy.sample_clamp_indirect = 8.0
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.use_adaptive_sampling = False
cy.use_denoising = bool(JOB.get('denoise', True))
if JOB.get('gpu'):
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        cy.device = 'GPU'
        log('Cycles on Metal GPU')
    except Exception as e:  # noqa
        log('GPU not usable, CPU:', e)
        cy.device = 'CPU'
else:
    cy.device = 'CPU'
sc.render.threads_mode = 'AUTO'
sc.view_settings.view_transform = 'Raw'
sc.display_settings.display_device = 'sRGB'

world = bpy.data.worlds.new('W')
sc.world = world
world.use_nodes = True
wn = world.node_tree
for n in list(wn.nodes):
    wn.nodes.remove(n)
w_out = wn.nodes.new('ShaderNodeOutputWorld')
w_bg = wn.nodes.new('ShaderNodeBackground')
wn.links.new(w_bg.outputs['Background'], w_out.inputs['Surface'])
# the sky: radiance 1 above the horizon, `groundSky` below it (the glow of the ground), as a small latitude-only equirect picture
GROUND = float(JOB.get('groundSky', 0.38))
_H, _W = 64, 128
_z = np.sin((np.arange(_H) + 0.5) / _H * PI - PI / 2)
_wgt = GROUND + (1 - GROUND) * np.clip((_z + 0.12) / 0.24, 0, 1)
_px = np.ones((_H, _W, 4), dtype=np.float32)
_px[:, :, :3] = _wgt[:, None, None]
_env = bpy.data.images.new('sky_env', _W, _H, float_buffer=True)
_env.colorspace_settings.name = 'Non-Color'
_env.pixels.foreach_set(_px.ravel())
w_env = wn.nodes.new('ShaderNodeTexEnvironment')
w_env.image = _env
wn.links.new(w_env.outputs['Color'], w_bg.inputs['Color'])


def set_world(on):
    w_bg.inputs['Strength'].default_value = 1.0 if on else 0.0


def sky_dir_weight(z):
    """the same ground-to-sky ramp as the world shader, for rays that escape in the probe pass"""
    t = min(1.0, max(0.0, (z + 0.12) / 0.24))
    return GROUND + (1.0 - GROUND) * t


# ------------------------------------------------------------------ meshes
MESHES = JOB['meshes']
mats = {}
bake_images = {}


def get_material(m):
    key = (tuple(round(c, 3) for c in m['albedo']), bool(m['hasColors']), tuple(round(c, 3) for c in m['emissive']) if m.get('emissive') else None)
    if key in mats:
        return mats[key]
    mat = bpy.data.materials.new('wt%d' % len(mats))
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*m['albedo'], 1.0)
    bsdf.inputs['Roughness'].default_value = 1.0
    for name in ('Specular IOR Level', 'Specular'):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.0
    if m['hasColors']:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['A'].default_value = (*m['albedo'], 1.0)
        nt.links.new(attr.outputs['Color'], mix.inputs['B'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    if m.get('emissive'):
        bsdf.inputs['Emission Color'].default_value = (*m['emissive'], 1.0)
        bsdf.inputs['Emission Strength'].default_value = 0.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.name = 'BAKE'
    nt.nodes.active = tex
    mats[key] = (mat, bsdf, tex)
    return mats[key]


class Obj:
    pass


objs = []
for i, m in enumerate(MESHES):
    nv = m['verts']
    pos = f32(m['posOffset'], nv * 3).reshape(nv, 3)
    col = f32(m['colOffset'], nv * 3).reshape(nv, 3) if m.get('colOffset') is not None else None
    if m['indexed']:
        tri = u32(m['idxOffset'], m['tris'] * 3).astype(np.int64)
    else:
        tri = np.arange(nv, dtype=np.int64)
    uvc = m['uvCount']
    uvs = UV_BIN[m['uvFloatOffset']:m['uvFloatOffset'] + uvc * 2].reshape(uvc, 2)
    if uvc > nv:
        extra = REMAP_BIN[m['remapOffset']:m['remapOffset'] + (uvc - nv)].astype(np.int64)
        src = np.concatenate([np.arange(nv), extra])
        pos = pos[src]
        if col is not None:
            col = col[src]
        tri = REMAP_BIN[m['indexOffset']:m['indexOffset'] + m['tris'] * 3].astype(np.int64)
    pb = to_b(pos)
    nt = len(tri) // 3
    me = bpy.data.meshes.new('m%d' % i)
    me.from_pydata(pb.tolist(), [], tri.reshape(nt, 3).tolist())
    uvl = me.uv_layers.new(name='LM')
    loops_v = np.empty(nt * 3, dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops_v)
    uv_loop = uvs[loops_v].copy()
    uv_loop[:, 1] = 1.0 - uv_loop[:, 1]
    uvl.data.foreach_set('uv', uv_loop.ravel().astype(np.float32))
    if col is not None:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        rgba = np.concatenate([col, np.ones((len(col), 1), dtype=np.float32)], axis=1)
        ca.data.foreach_set('color', rgba.ravel().astype(np.float32))
    mat, bsdf, tex = get_material(m)
    me.materials.append(mat)
    ob = bpy.data.objects.new(m['key'], me)
    sc.collection.objects.link(ob)
    o = Obj()
    o.ob, o.me, o.m, o.bsdf, o.tex, o.i = ob, me, m, bsdf, tex, i
    o.pos_b, o.tri, o.col, o.uv = pb, tri.reshape(nt, 3), col, uvs
    objs.append(o)
log('built', len(objs), 'meshes,', sum(len(o.tri) for o in objs), 'triangles')

# parity (SPEC 16.13): the mesh Blender holds must be the mesh the page dumped, to the millimetre
worst = (0.0, '')
for o in objs:
    co = np.empty(len(o.me.vertices) * 3, dtype=np.float64)
    o.me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mn = np.array([co[:, 0].min(), co[:, 2].min(), -co[:, 1].max()])  # back to three: x, y=z_b, z=-y_b
    mx = np.array([co[:, 0].max(), co[:, 2].max(), -co[:, 1].min()])
    bb = o.m['bbox']
    d = max(np.abs(mn - np.array(bb[:3])).max(), np.abs(mx - np.array(bb[3:])).max()) * 1000.0
    if d > worst[0]:
        worst = (d, o.m['key'])
log('parity worst %.4f mm (%s)' % worst)

static = [o for o in objs if o.m['cls'] == 'static']
static_baked = [o for o in static if not o.m.get('noBake')]  # the rest only shade and bounce (fine detail: bars, plates)
dyn = [o for o in objs if o.m['cls'] == 'dyn']
for o in objs:
    o.ob.hide_render = False


# ------------------------------------------------------------------ lights
sun_data = bpy.data.lights.new('SUN', 'SUN')
sun_data.energy = 0.0
sun_data.angle = math.radians(float(JOB.get('sunAngleDeg', 1.6)))
sun_ob = bpy.data.objects.new('SUN', sun_data)
sc.collection.objects.link(sun_ob)

portals = []
for p in JOB.get('portals', []):
    ld = bpy.data.lights.new('P', 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = p['w'], p['h']
    ld.cycles.is_portal = True
    ob = bpy.data.objects.new('P', ld)
    sc.collection.objects.link(ob)
    c = to_b([p['center']])[0]
    n = to_b([p['normal']])[0]  # pointing into the room
    up = Vector((0, 0, 1))
    ob.location = Vector(c)
    # area lights emit along -Z local: point it into the room
    ob.rotation_euler = Vector((0, 0, -1)).rotation_difference(Vector(n)).to_euler()
    portals.append(ob)

downs = []
for d in JOB.get('downlights', []):
    ld = bpy.data.lights.new('D', 'SPOT')
    ld.spot_size = math.radians(float(JOB.get('downlightCone', 105)))
    ld.spot_blend = 0.6
    ld.shadow_soft_size = d.get('radius', 0.05)
    ld.energy = 0.0
    ld.color = tuple(JOB.get('downlightColour', [1.0, 0.82, 0.62]))
    ob = bpy.data.objects.new('D', ld)
    sc.collection.objects.link(ob)
    ob.location = Vector(to_b([d['position']])[0])
    ob.rotation_euler = (0, 0, 0)  # points down (-Z in blender = -y in three)
    downs.append(ob)


def lights_off():
    sun_data.energy = 0.0
    set_world(False)
    for p in portals:
        p.hide_render = True
    for d in downs:
        d.data.energy = 0.0
    for o in objs:
        if o.m.get('emissive'):
            o.bsdf.inputs['Emission Strength'].default_value = 0.0


def select(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0].ob


def make_image(name, size, rgba=(0, 0, 0, 0)):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = rgba
    return img


def bake_diffuse(objects, img, pad, kind='DIFFUSE'):
    for o in objects:
        o.tex.image = img
        o.me.uv_layers.active = o.me.uv_layers['LM']
        o.me.uv_layers['LM'].active_render = True
    select(objects)
    if kind == 'AO':
        bpy.ops.object.bake(type='AO', margin=pad, margin_type='EXTEND', use_clear=True)
    else:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=pad, margin_type='EXTEND', use_clear=True)
    a = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[::-1].copy()  # top row first = v 0


_DN = {'n': 0}


def denoise_rgb(rgb, hdr=True):
    """OpenImageDenoise through the compositor. The lightmap is smooth by nature, so this keeps the sun's edges and removes the grain."""
    n = rgb.shape[0]
    _DN['n'] += 1
    tag = _DN['n']
    img = bpy.data.images.new('dn_in%d' % tag, n, n, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.concatenate([rgb.astype(np.float32), np.ones((n, n, 1), np.float32)], axis=2).ravel())
    s2 = bpy.data.scenes.new('dn%d' % tag)
    s2.render.resolution_x = n
    s2.render.resolution_y = n
    s2.render.resolution_percentage = 100
    s2.view_settings.view_transform = 'Raw'
    g = bpy.data.node_groups.new('dng%d' % tag, 'CompositorNodeTree')
    s2.compositing_node_group = g
    ni = g.nodes.new('CompositorNodeImage')
    ni.image = img
    nd = g.nodes.new('CompositorNodeDenoise')
    nd.inputs['HDR'].default_value = bool(hdr)
    g.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    go = g.nodes.new('NodeGroupOutput')
    g.links.new(ni.outputs['Image'], nd.inputs['Image'])
    g.links.new(nd.outputs['Image'], go.inputs[0])
    s2.render.use_compositing = True
    s2.render.image_settings.file_format = 'OPEN_EXR'
    s2.render.image_settings.color_depth = '32'
    s2.render.image_settings.color_mode = 'RGB'
    path = os.path.join(OUT, 'dn_tmp%d.exr' % tag)
    s2.render.filepath = path
    cam = bpy.data.objects.new('dc%d' % tag, bpy.data.cameras.new('dc%d' % tag))
    s2.collection.objects.link(cam)
    s2.camera = cam
    bpy.ops.render.render(scene=s2.name, write_still=True)
    out = bpy.data.images.load(path)
    a = np.empty(len(out.pixels), np.float32)
    out.pixels.foreach_get(a)
    res = np.maximum(a.reshape(n, n, 4)[:, :, :3], 0)
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    bpy.data.scenes.remove(s2)
    os.remove(path)
    return res


SIZE = JOB['atlas']['static']['size']
PAD = JOB['atlas']['static']['pad']
comps = {}  # component -> float (N, N, 3) in "E units" (before gain)
results = {'timings': {}}


def component_sky():
    lights_off()
    set_world(True)
    for p in portals:
        p.hide_render = False
    return 1.0 / PI  # g


def component_sun(k):
    def f():
        lights_off()
        s = JOB['suns'][k]
        t = Vector(to_b([s['toSun']])[0]).normalized()
        sun_ob.rotation_euler = Vector((0, 0, -1)).rotation_difference(-t).to_euler()
        sun_data.energy = 1.0
        return 1.0
    return f


def component_lamps():
    lights_off()
    for o in static:
        if o.m.get('light') in ('tube', 'fan', 'lamp'):
            o.bsdf.inputs['Emission Strength'].default_value = JOB['tubeStrength'] if o.m['light'] == 'tube' else JOB['tubeStrength'] * 0.5
    for d in downs:
        d.data.energy = JOB['downlightWatts']
    return 1.0


def component_cove():
    lights_off()
    for o in static:
        if o.m.get('light') == 'cove':
            o.bsdf.inputs['Emission Strength'].default_value = JOB['coveStrength']
    return 1.0


def run_static():
    if not static_baked:
        return
    img = make_image('lm_static', SIZE)
    for name in JOB['components']:
        t = time.time()
        if name == 'ao':
            lights_off()
            sc.world.light_settings.distance = float(JOB.get('aoStaticDistance', 1.1))
            for o in dyn:
                o.ob.hide_render = True
            a = bake_diffuse(static_baked, img, PAD, 'AO')
            for o in dyn:
                o.ob.hide_render = False
            v = a[:, :, :3]
            if JOB.get('denoise', True):
                v = denoise_rgb(v, hdr=False)
            comps['ao'] = {'v': np.clip(v, 0, 1), 'g': 1.0 / PI, 'alpha': a[:, :, 3]}
            results['timings']['ao'] = time.time() - t
            log('baked ao in %.1fs' % (time.time() - t))
            continue
        if name == 'sky':
            g = component_sky()
        elif name.startswith('sun'):
            g = component_sun(int(name[3:]))()
        elif name == 'lamps':
            g = component_lamps()
        elif name == 'cove':
            has = any(o.m.get('light') == 'cove' for o in static)
            if not has:
                continue
            g = component_cove()
        else:
            continue
        for o in dyn:
            o.ob.hide_render = True
        a = bake_diffuse(static_baked, img, PAD)
        for o in dyn:
            o.ob.hide_render = False
        v = a[:, :, :3]
        if JOB.get('denoise', True):
            td = time.time()
            v = denoise_rgb(v)
            log('denoised', name, 'in %.1fs' % (time.time() - td))
        comps[name] = {'v': v, 'g': g, 'alpha': a[:, :, 3]}
        results['timings'][name] = time.time() - t
        log('baked', name, 'mean %.4f' % float(v[v.sum(axis=2) > 0].mean()) if (v.sum(axis=2) > 0).any() else 'empty', 'in %.1fs' % (time.time() - t))


run_static()
lights_off()


# ------------------------------------------------------------------ denoise, calibrate
def floor_mask(rects):
    """texels of floor charts of rooms (not balconies): the area lamps are calibrated on"""
    m = np.zeros((SIZE, SIZE), dtype=bool)
    for o in static:
        if o.m['surface'] != 'floor' or o.m.get('balcony'):
            continue
        for (x, y, w, h) in rects.get(o.m['key'], []):
            m[y + PAD:y + h - PAD, x + PAD:x + w - PAD] = True
    return m


RECTS = JOB.get('rects', {})
fmask = floor_mask(RECTS)
results['calibration'] = {}
for name, c in comps.items():
    tex = c['v'] * (PI * c['g'])  # E units for a unit light (for ao: g = 1/pi, so the value itself)
    if name == 'sky':
        # exposure: the 80th percentile of the floor's sky irradiance (the lit part of the rooms) is what one unit of hemisphere light gave
        # every up-facing surface before the bake; the rest falls off as the light really does (corners, far from windows, corridors)
        sel = (tex.sum(axis=2) > 0) & fmask
        p80 = float(np.percentile(tex[sel].mean(axis=1), 80)) if sel.any() else 1.0
        f = (JOB['skyTargetE'] / p80) if p80 > 1e-6 else 1.0
        tex = tex * f
        c['g'] = c['g'] * f
        results['calibration']['sky'] = {'p80Before': p80, 'scale': f, 'target': JOB['skyTargetE']}
        log('calibrated sky p80 floor E %.4f -> %.2f (x%.2f)' % (p80, JOB['skyTargetE'], f))
    if name in ('lamps', 'cove'):
        sel = tex.sum(axis=2) > 0
        sel &= fmask
        mean_e = float(tex[sel].mean()) if sel.any() else 0.0
        target = JOB['lampTargetE'] if name == 'lamps' else JOB['coveTargetE']
        f = (target / mean_e) if mean_e > 1e-9 else 1.0
        tex = tex * f
        c['g'] = c['g'] * f
        results['calibration'][name] = {'meanBefore': mean_e, 'scale': f, 'target': target}
        log('calibrated', name, 'mean floor E %.4f -> %.3f (x%.2f)' % (mean_e, target, f))
    c['tex'] = tex


# ------------------------------------------------------------------ light probes (SH L2) from the baked room
def sh_basis(d):
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    return np.stack([
        0.282095 * np.ones_like(x),
        0.488603 * y, 0.488603 * z, 0.488603 * x,
        1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y),
    ], axis=1)


def run_probes():
    pr = JOB.get('probes')
    if not pr or not static or not comps:
        return
    t = time.time()
    P = np.fromfile(os.path.join(WORK, 'probes_in.bin'), dtype=np.float32).reshape(-1, 3)
    verts, tris, tri_uv, tri_alb, tri_emit = [], [], [], [], []
    base = 0
    emit_names = {}
    for o in static:
        verts.append(o.pos_b)
        tris.append(o.tri + base)
        base += len(o.pos_b)
        uvt = o.uv[o.tri]  # (nt, 3, 2)
        tri_uv.append(uvt)
        alb = np.tile(np.array(o.m['albedo'], dtype=np.float64), (len(o.tri), 1))
        if o.col is not None:
            alb = alb * o.col[o.tri].mean(axis=1)
        if o.m.get('noBake'):
            alb = alb * 0.0  # no lightmap, no bounce: an occluder only
        tri_alb.append(alb)
        e = np.zeros((len(o.tri), 3))
        k = o.m.get('light')
        if k and o.m.get('emissive'):
            e[:] = np.array(o.m['emissive'])
        tri_emit.append(e)
        emit_names.update({len(emit_names): k})
    V = np.concatenate(verts)
    T = np.concatenate(tris)
    TU = np.concatenate(tri_uv)
    TA = np.concatenate(tri_alb)
    TE = np.concatenate(tri_emit)
    # which component an emitting triangle belongs to
    tri_kind = []
    for o in static:
        tri_kind.extend([o.m.get('light') or ''] * len(o.tri))
    tri_kind = np.array(tri_kind)
    bvh = BVHTree.FromPolygons(V.tolist(), T.tolist(), epsilon=1e-6)
    log('probe BVH over', len(T), 'triangles; probes', len(P))
    names = [n for n in JOB['components'] if n in comps and n != 'ao']
    nrays = int(pr.get('rays', 96))
    i = np.arange(nrays) + 0.5
    phi = np.arccos(1 - 2 * i / nrays)
    th = PI * (1 + 5 ** 0.5) * i
    dirs = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], axis=1)  # blender frame
    dirs_three = np.stack([dirs[:, 0], dirs[:, 2], -dirs[:, 1]], axis=1)  # back to y-up three for the SH basis
    B = sh_basis(dirs_three)  # (nrays, 9)
    Pb = to_b(P)
    out = np.zeros((len(P), len(names), 9, 3), dtype=np.float32)
    tex_arrays = [comps[n]['tex'] for n in names]
    gains = [comps[n]['g'] for n in names]
    S = SIZE

    def sample(arr, uv):
        x = np.clip(uv[0] * S - 0.5, 0, S - 1.001)
        y = np.clip(uv[1] * S - 0.5, 0, S - 1.001)
        x0, y0 = int(x), int(y)
        fx, fy = x - x0, y - y0
        return (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x0 + 1] * fx * (1 - fy) + arr[y0 + 1, x0] * (1 - fx) * fy + arr[y0 + 1, x0 + 1] * fx * fy)

    # the lamps' DIRECT light, analytically. A 5 cm tube or a 9 cm downlight covers a thousandth of a probe's sphere, so rays all but never find it,
    # and the light the lamps give a bed or a sofa would be missing. Each emitting triangle and each spot is added as a point of light with
    # its true irradiance (visibility by one ray), projected into the same SH. g is the calibrated scale of the component (tex = g * blender E).
    src_pos, src_kind, src_cos_axis, src_E, src_n, src_spot = [], [], [], [], [], []
    for o in static:
        k = o.m.get('light')
        if not k or not o.m.get('emissive'):
            continue
        st = JOB['coveStrength'] if k == 'cove' else (JOB['tubeStrength'] if k == 'tube' else JOB['tubeStrength'] * 0.5)
        for tr in o.tri:
            a_, b_, c_ = o.pos_b[tr[0]], o.pos_b[tr[1]], o.pos_b[tr[2]]
            cr = np.cross(b_ - a_, c_ - a_)
            area = np.linalg.norm(cr) / 2.0
            if area < 1e-9:
                continue
            src_pos.append((a_ + b_ + c_) / 3.0)
            src_n.append(cr / (2.0 * area))
            src_E.append(np.array(o.m['emissive']) * st * area)  # radiance * area: E0 = this * cos / d^2
            src_kind.append('cove' if k == 'cove' else 'lamps')
            src_spot.append(False)
    for d_ in JOB.get('downlights', []):
        src_pos.append(np.array(to_b([d_['position']])[0]))
        src_n.append(np.array([0.0, 0.0, -1.0]))
        src_E.append(np.array(JOB.get('downlightColour', [1.0, 0.82, 0.62])) * JOB['downlightWatts'] / (4 * PI))  # radiant intensity, W/sr
        src_kind.append('lamps')
        src_spot.append(True)
    cos_half = math.cos(math.radians(float(JOB.get('downlightCone', 105))) / 2.0)
    smooth = (1.0 - cos_half) * 0.6
    names_idx = {n: i for i, n in enumerate(names)}
    n_src = len(src_pos)
    log('probes: %d analytic light sources' % n_src)

    for pi_, p in enumerate(Pb):
        R = np.zeros((nrays, len(names), 3))
        for r in range(nrays):
            d = Vector(dirs[r])
            hit = bvh.ray_cast(Vector(p) + d * 0.002, d)
            if hit[0] is None:
                for ci, n in enumerate(names):
                    if n == 'sky':
                        R[r, ci] = gains[ci] * sky_dir_weight(d.z)  # radiance of the unit sky in this direction
                continue
            ti = hit[2]
            a, b, c = V[T[ti][0]], V[T[ti][1]], V[T[ti][2]]
            q = np.array(hit[0])
            v0, v1, v2 = b - a, c - a, q - a
            d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
            den = d00 * d11 - d01 * d01
            if abs(den) < 1e-18:
                continue
            bv = (d11 * d20 - d01 * d21) / den
            bw = (d00 * d21 - d01 * d20) / den
            bu = 1 - bv - bw
            uv = TU[ti][0] * bu + TU[ti][1] * bv + TU[ti][2] * bw
            for ci, n in enumerate(names):
                R[r, ci] = sample(tex_arrays[ci], uv) * TA[ti] / PI
                kind = tri_kind[ti]
                if kind and ((n == 'lamps' and kind in ('tube', 'fan', 'lamp')) or (n == 'cove' and kind == 'cove')):
                    R[r, ci] = R[r, ci] + TE[ti] * JOB['tubeStrength' if n == 'lamps' else 'coveStrength'] * gains[ci]
        for si in range(n_src):
            ci = names_idx.get(src_kind[si])
            if ci is None:
                continue
            dvec = p - src_pos[si]
            dist = float(np.linalg.norm(dvec))
            if dist < 0.05:
                continue
            u_ = dvec / dist  # from the lamp to the probe
            if src_spot[si]:
                cosphi = float(u_ @ src_n[si])
                if cosphi <= cos_half:
                    continue
                x_ = min(1.0, (cosphi - cos_half) / smooth)
                E0 = src_E[si] * (x_ * x_ * (3 - 2 * x_)) / (dist * dist)
            else:
                cosl = float(u_ @ src_n[si])
                if cosl <= 0.0:
                    continue
                E0 = src_E[si] * cosl / (dist * dist)
            if bvh.ray_cast(Vector(p), Vector(-u_), dist - 0.05)[0] is not None:
                continue
            wl = -u_  # towards the lamp, blender frame -> three frame (x, z, -y)
            Bl = sh_basis(np.array([[wl[0], wl[2], -wl[1]]]))[0]
            out[pi_, ci] += (np.outer(Bl, E0 * gains[ci])).astype(np.float32)
        # project: c = 4 pi / N * sum R(w) Y(w)
        out[pi_] += (4 * PI / nrays * np.einsum('rk,rcj->ckj', B, R).astype(np.float32))
    out.tofile(os.path.join(OUT, 'probes.bin'))
    results['probes'] = {'count': len(P), 'components': names, 'seconds': time.time() - t}
    log('probes done in %.1fs' % (time.time() - t))


# ------------------------------------------------------------------ dyn: per-object AO atlas
def run_dyn():
    cfg = JOB['atlas'].get('dyn')
    if not cfg or not dyn:
        return
    t = time.time()
    DS, DP = cfg['size'], cfg['pad']
    atlas = np.ones((DS, DS), dtype=np.float32)  # white = open
    groups = {}
    for o in dyn:
        groups.setdefault(o.m.get('group') or o.m['key'], []).append(o)
    # a ground plane so legs and undersides sit on something; nothing else of the room is there
    gm = bpy.data.meshes.new('ground')
    gm.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
    gob = bpy.data.objects.new('ground', gm)
    sc.collection.objects.link(gob)
    gmat = bpy.data.materials.new('ground')
    gob.data.materials.append(gmat)
    sc.world.light_settings.distance = float(JOB.get('aoDistance', 0.45))
    sc.cycles.samples = max(16, int(JOB['samples']) // 2)
    for o in static:
        o.ob.hide_render = True
    for g, members in groups.items():
        for o in dyn:
            o.ob.hide_render = o not in members
        img = make_image('ao_tmp', DS, (1, 1, 1, 1))
        for o in members:
            o.tex.image = img
            o.me.uv_layers['LM'].active_render = True
            o.me.uv_layers.active = o.me.uv_layers['LM']
        select(members)
        bpy.ops.object.bake(type='AO', margin=DP, margin_type='EXTEND', use_clear=True)
        a = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(DS, DS, 4)[::-1, :, 0]
        for o in members:
            for (x, y, w, h) in RECTS.get('dyn:' + o.m['key'], []):
                atlas[y:y + h, x:x + w] = a[y:y + h, x:x + w]
        bpy.data.images.remove(img)
    for o in static:
        o.ob.hide_render = False
    for o in dyn:
        o.ob.hide_render = False
    if JOB.get('denoise', True):
        atlas = denoise_rgb(np.repeat(atlas[:, :, None], 3, axis=2), hdr=False)[:, :, 0]
    comps['_ao'] = {'ao': np.clip(atlas, 0, 1)}
    results['timings']['dyn_ao'] = time.time() - t
    log('dyn AO baked for', len(groups), 'objects in %.1fs' % (time.time() - t))


# ------------------------------------------------------------------ encode and write
def encode(arr, gain_pct=99.9):
    """arr: (N, N, 3) E units. Returns uint8 (N, N, 3) and the decode gain (value of byte 255)."""
    peak = float(np.percentile(arr[arr.sum(axis=2) > 0], gain_pct)) if (arr.sum(axis=2) > 0).any() else 1.0
    gain = max(peak, 1e-3)
    q = np.sqrt(np.clip(arr / gain, 0, 1))
    return np.round(q * 255).astype(np.uint8), gain


def downscale(a, size):
    n = a.shape[0]
    if n == size:
        return a
    f = n // size
    return a.reshape(size, f, size, f, -1).mean(axis=(1, 3))


def write_webp(path, rgb_u8, quality):
    n = rgb_u8.shape[0]
    img = bpy.data.images.new('enc', n, n, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    flat = np.concatenate([rgb_u8.astype(np.float32) / 255.0, np.ones((n, n, 1), dtype=np.float32)], axis=2)[::-1]
    img.pixels.foreach_set(flat.ravel())
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = int(quality)
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)
    return os.path.getsize(path)


def write_all():
    out = {'static': {}, 'dyn': {}}
    for tier, size in JOB['tiers'].items():
        os.makedirs(os.path.join(OUT, tier), exist_ok=True)
        for name, c in comps.items():
            if name == '_ao':
                continue
            a = downscale(c['tex'], size['static'])
            q, gain = encode(a)
            nbytes = write_webp(os.path.join(OUT, tier, 'static-%s.webp' % name), q, JOB['webpQuality'])
            out['static'].setdefault(tier, {})[name] = {'bytes': nbytes, 'gain': gain, 'size': a.shape[0]}
        if '_ao' in comps:
            a = downscale(comps['_ao']['ao'][:, :, None], size['dyn'])
            q = np.round(np.repeat(np.clip(a, 0, 1), 3, axis=2) * 255).astype(np.uint8)  # linear AO, 0..1, one gain of 1
            nbytes = write_webp(os.path.join(OUT, tier, 'dyn-ao.webp'), q, JOB['webpQuality'])
            out['dyn'][tier] = {'ao': {'bytes': nbytes, 'gain': 1.0, 'size': a.shape[0]}}
    return out


run_probes()
run_dyn()
results['files'] = write_all()
results['parity'] = {'maxMm': worst[0], 'worstKey': worst[1]}
results['blender'] = bpy.app.version_string
results['seconds'] = time.time() - T0
results['denoised'] = bool(cy.use_denoising)
json.dump(results, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
log('done')
