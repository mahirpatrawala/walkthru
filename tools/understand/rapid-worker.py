#!/usr/bin/env python3
# Walkthru local OCR worker (SPEC 17.17). A long-lived process that reads PNG files with RapidOCR (PP-OCR detection + recognition on
# ONNX Runtime, Apache-2.0) and answers one JSON line per request on stdout. src/understand/local/ocr-rapid.ts drives it; nothing
# here is specific to a drawing. The protocol is the whole contract, so the same models can be run by onnxruntime-node or
# onnxruntime-web later by a TypeScript backend that answers the same two calls:
#
#   -> {"id":1,"op":"page","path":"/tmp/p.png"}            whole image: detect text lines, read each
#   <- {"id":1,"lines":[{"box":[[x,y],[x,y],[x,y],[x,y]],"text":"BED ROOM","conf":0.97}]}      (box corners clockwise from top-left)
#   -> {"id":2,"op":"rec","paths":["/tmp/a.png","/tmp/b.png"]}   single-line crops: read only, no detection
#   <- {"id":2,"reads":[{"text":"12'-0\" X 10'-0\"","conf":0.93},{"text":"","conf":0}]}
#
# Start: python3 -I rapid-worker.py --models <dir> [--det small --rec small --version PP-OCRv6]. It never touches the network: the model
# files are taken from <dir> (tools/understand/setup-ocr.sh puts them there) and a missing file is an error, not a download.
import argparse
import json
import os
import resource
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--models', required=True)
    ap.add_argument('--det', default=None, help='detection model file in --models (default: the set setup-ocr.sh installed, models/active.json)')
    ap.add_argument('--rec', default=None)
    ap.add_argument('--cls', default=None)
    ap.add_argument('--threads', type=int, default=2)
    ap.add_argument('--text-score', type=float, default=0.3)
    a = ap.parse_args()
    # libraries print to stdout: keep it for the protocol only
    out = os.fdopen(os.dup(1), 'w')
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    active = {}
    try:
        active = json.load(open(os.path.join(a.models, 'active.json')))
    except (OSError, ValueError):
        pass
    files = {'det': a.det or active.get('detFile', 'PP-OCRv6_det_tiny.onnx'), 'rec': a.rec or active.get('recFile', 'PP-OCRv6_rec_tiny.onnx'), 'cls': a.cls or active.get('clsFile', 'ch_ppocr_mobile_v2.0_cls_mobile.onnx')}
    paths = {k: os.path.join(a.models, v) for k, v in files.items()}
    missing = [p for p in paths.values() if not os.path.exists(p)]
    if missing:
        out.write(json.dumps({'ready': False, 'error': 'model file missing: ' + ', '.join(missing) + ' (run tools/understand/setup-ocr.sh)'}) + '\n'); out.flush()
        return 3
    try:
        import cv2
        import numpy as np
        from rapidocr import RapidOCR
    except ImportError as e:
        out.write(json.dumps({'ready': False, 'error': f'python packages missing: {e} (run tools/understand/setup-ocr.sh)'}) + '\n'); out.flush()
        return 2
    eng = RapidOCR(params={
        'Global.log_level': 'error', 'Global.max_side_len': 8000, 'Global.min_side_len': 30, 'Global.text_score': a.text_score,
        'Det.model_path': paths['det'], 'Rec.model_path': paths['rec'], 'Cls.model_path': paths['cls'],
        'Det.limit_type': 'min', 'Det.limit_side_len': 736,
        'EngineConfig.onnxruntime.intra_op_num_threads': a.threads, 'EngineConfig.onnxruntime.inter_op_num_threads': 1,
    })
    sizes = {k: os.path.getsize(p) for k, p in paths.items()}
    out.write(json.dumps({'ready': True, 'engine': 'rapidocr-onnx', 'models': {k: os.path.basename(p) for k, p in paths.items()}, 'bytes': sizes}) + '\n'); out.flush()

    def stats():
        # cumulative CPU seconds and peak resident memory of this worker (macOS reports bytes, Linux kilobytes)
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return {'cpu': round(time.process_time(), 3), 'rssMb': round(rss / 1e6 if sys.platform == 'darwin' else rss / 1024, 1)}

    def load(path):
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        return None if img is None else np.ascontiguousarray(img)

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            rid, op = req.get('id'), req.get('op')
            if op == 'page':
                img = load(req['path'])
                lines = []
                if img is not None:
                    res = eng(img, use_cls=bool(req.get('cls', True)))
                    if res.txts:
                        for box, txt, sc in zip(res.boxes, res.txts, res.scores):
                            lines.append({'box': [[float(x), float(y)] for x, y in box], 'text': txt, 'conf': float(sc)})
                out.write(json.dumps({'id': rid, 'lines': lines, **stats()}) + '\n')
            elif op == 'rec':
                reads = []
                for p in req['paths']:
                    img = load(p)
                    r = eng(img, use_det=False, use_cls=False, use_rec=True) if img is not None else None
                    if r is not None and getattr(r, 'txts', None):
                        reads.append({'text': ' '.join(r.txts), 'conf': float(sum(r.scores) / len(r.scores))})
                    else:
                        reads.append({'text': '', 'conf': 0.0})
                out.write(json.dumps({'id': rid, 'reads': reads, **stats()}) + '\n')
            elif op == 'quit':
                break
            else:
                out.write(json.dumps({'id': rid, 'error': f'unknown op {op}'}) + '\n')
        except Exception as e:  # one bad request must not kill the worker
            out.write(json.dumps({'id': (req or {}).get('id') if isinstance(req, dict) else None, 'error': str(e)[:300]}) + '\n')
        out.flush()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
