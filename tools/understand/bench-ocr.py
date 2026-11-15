#!/usr/bin/env python3
# Whole-image OCR benchmark for choosing the local raster engine (SPEC 17.17). Scores how many printed room sizes and room names of the
# label truth show up in an engine's text. DEV SETS ONLY: the script refuses any set the split file lists as held-out.
#   python3 -I tools/understand/bench-ocr.py --engine rapid:PP-OCRv6:small:small --scale 2400 [--rot] [--sets r05,r12]
#   python3 -I tools/understand/bench-ocr.py --engine tesseract
# One engine per process so peak RSS (printed at the end) belongs to that engine alone.
import argparse, json, os, re, resource, subprocess, sys, tempfile, time

ROOT = os.path.expanduser('~/walkthru-tools/eval/real')


def load_dev():
    split = json.load(open(os.path.join(ROOT, 'split.json')))
    return [s['set'] for s in split['sets']['dev']]


def image_of(set_id, tmp):
    d = os.path.join(ROOT, set_id)
    for n in ('drawing.jpg', 'drawing.png', 'drawing.jpeg'):
        if os.path.exists(os.path.join(d, n)):
            return os.path.join(d, n)
    pdf = os.path.join(d, 'drawing.pdf')
    out = os.path.join(tmp, set_id)
    subprocess.run(['pdftocairo', '-png', '-singlefile', '-r', '200', pdf, out], check=True)
    return out + '.png'


def digits(s): return re.sub(r'[^0-9]', '', s)
def letters(s): return re.sub(r'[^A-Z]', '', s.upper())


def score(lines, truth):
    dl = [digits(l) for l in lines]
    # a size also counts when it is split over two consecutive lines
    dl2 = dl + [dl[i] + dl[i + 1] for i in range(len(dl) - 1)]
    sized = [r for r in truth['rooms'] if r['printed']]
    sf = sum(1 for r in sized if any(len(digits(p)) >= 3 and any(digits(p) in d for d in dl2) for p in r['printed']))
    names = sorted({letters(re.sub(r'\(.*?\)', '', r['name'])) for r in truth['rooms'] if len(letters(re.sub(r'\(.*?\)', '', r['name']))) >= 3})
    lt = ' '.join(letters(l) for l in lines)
    nf = sum(1 for n in names if n in lt)
    return sf, len(sized), nf, len(names)


def tess_lines(path, scale):
    from PIL import Image
    im = Image.open(path).convert('L')
    long = max(im.size)
    k = scale / long
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    lines = []
    with tempfile.TemporaryDirectory() as t:
        f = os.path.join(t, 'u.png'); im.save(f)
        for psm in ('11', '6'):
            r = subprocess.run(['/opt/homebrew/bin/tesseract', f, 'stdout', '--psm', psm], capture_output=True, text=True)
            lines += [l.strip() for l in r.stdout.split('\n') if l.strip()]
    return lines


def rapid_factory(spec):
    from rapidocr import RapidOCR, OCRVersion, ModelType
    _, ver, det, rec = spec.split(':')
    params = {
        'Global.max_side_len': 6000, 'Global.min_side_len': 30, 'Global.log_level': 'error',
        'Det.ocr_version': OCRVersion(ver), 'Det.model_type': ModelType(det), 'Det.limit_side_len': 1024 if False else 736, 'Det.limit_type': 'min',
        'Rec.ocr_version': OCRVersion(ver), 'Rec.model_type': ModelType(rec),
    }
    return RapidOCR(params=params)


def rapid_lines(eng, path, scale, rot, score_min):
    import numpy as np
    from PIL import Image
    im = Image.open(path).convert('RGB')
    long = max(im.size)
    k = scale / long
    if k != 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    lines = []
    for angle in ((0, 90, 270) if rot else (0,)):
        r = im if angle == 0 else im.rotate(angle, expand=True)
        out = eng(np.ascontiguousarray(np.array(r)[:, :, ::-1]), text_score=score_min)
        if out.txts:
            lines += list(out.txts)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--scale', type=int, default=2400)
    ap.add_argument('--rot', action='store_true')
    ap.add_argument('--score', type=float, default=0.3)
    ap.add_argument('--sets')
    a = ap.parse_args()
    dev = load_dev()
    sets = a.sets.split(',') if a.sets else dev
    bad = [s for s in sets if s not in dev]
    if bad:
        sys.exit(f'refusing held-out sets: {bad}')
    eng = None
    if a.engine.startswith('rapid'):
        t0 = time.time(); eng = rapid_factory(a.engine); load = time.time() - t0
    else:
        load = 0
    tot = [0, 0, 0, 0]; rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for s in sets:
            truth = json.load(open(os.path.join(ROOT, s, 'truth.json')))
            img = image_of(s, tmp)
            t0 = time.time()
            lines = tess_lines(img, a.scale) if a.engine == 'tesseract' else rapid_lines(eng, img, a.scale, a.rot, a.score)
            dt = time.time() - t0
            sc = score(lines, truth)
            tot = [x + y for x, y in zip(tot, sc)]
            rows.append(f'  {s} sizes {sc[0]}/{sc[1]} names {sc[2]}/{sc[3]} lines {len(lines)} {dt:.1f}s')
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9
    kids = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1e9
    print(f'{a.engine} scale={a.scale} rot={a.rot} score>={a.score}: sizes {tot[0]}/{tot[1]} names {tot[2]}/{tot[3]} load {load:.1f}s peakRSS {max(rss, kids):.2f}GB')
    print('\n'.join(rows))


main()
