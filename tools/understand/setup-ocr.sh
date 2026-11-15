#!/bin/sh
# Installs the local text reader for Walkthru's picture-of-a-plan path (SPEC 17.17): a Python venv with RapidOCR (PP-OCR on ONNX
# Runtime, Apache-2.0) and the three ONNX models. This is the ONLY place anything is downloaded, and only when you run it.
#   sh tools/understand/setup-ocr.sh            installs under $WALKTHRU_OCR_HOME (default ~/walkthru-tools/ocr)
#   WALKTHRU_OCR_MODEL=<set> sh ...             model set: v6-tiny (default, 6.9 MB), v6-small (32 MB), v5-mobile (22 MB), v5-server (190 MB)
# Needs Python 3.9 to 3.12 (onnxruntime wheels) and, for the first run, network access to PyPI and the model host. Nothing in the
# project, its tests or its evaluations downloads anything: with no install the reader falls back to Tesseract and says so.
set -eu
HOME_DIR="${WALKTHRU_OCR_HOME:-$HOME/walkthru-tools/ocr}"
SET="${WALKTHRU_OCR_MODEL:-v6-tiny}"
PY="${WALKTHRU_PYTHON:-}"
if [ -z "$PY" ]; then for c in python3.12 python3.11 python3.10 python3.9 python3; do if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi; done; fi
[ -n "$PY" ] || { echo "no python3 found" >&2; exit 1; }
case "$SET" in
  v5-mobile) VER=PP-OCRv5; DET=mobile; REC=mobile; DF=ch_PP-OCRv5_det_mobile.onnx; RF=ch_PP-OCRv5_rec_mobile.onnx ;;
  v5-server) VER=PP-OCRv5; DET=server; REC=server; DF=ch_PP-OCRv5_det_server.onnx; RF=ch_PP-OCRv5_rec_server.onnx ;;
  v6-small)  VER=PP-OCRv6; DET=small;  REC=small;  DF=PP-OCRv6_det_small.onnx;  RF=PP-OCRv6_rec_small.onnx ;;
  v6-tiny)   VER=PP-OCRv6; DET=tiny;   REC=tiny;   DF=PP-OCRv6_det_tiny.onnx;   RF=PP-OCRv6_rec_tiny.onnx ;;
  *) echo "unknown model set $SET" >&2; exit 1 ;;
esac
mkdir -p "$HOME_DIR/models"
if [ ! -x "$HOME_DIR/venv/bin/python3" ]; then "$PY" -m venv "$HOME_DIR/venv"; fi
"$HOME_DIR/venv/bin/pip" install --quiet "rapidocr==3.10.0" "onnxruntime>=1.18" pillow
# building the engine once makes the package fetch any model it does not ship; the files are then copied to the model folder the
# worker reads (the worker itself never downloads)
"$HOME_DIR/venv/bin/python3" -I - "$HOME_DIR/models" "$VER" "$DET" "$REC" <<'PY'
import os, shutil, sys
import rapidocr
from rapidocr import RapidOCR, OCRVersion, ModelType
dest, ver, det, rec = sys.argv[1:5]
eng = RapidOCR(params={'Det.ocr_version': OCRVersion(ver), 'Det.model_type': ModelType(det), 'Rec.ocr_version': OCRVersion(ver), 'Rec.model_type': ModelType(rec), 'Global.log_level': 'error'})
# the package loads (and so downloads) each model on first use: load all three now, pinned to rapidocr 3.10.0
eng._load_det_model(); eng._load_cls_model(); eng._load_rec_model()
root = os.path.join(os.path.dirname(rapidocr.__file__), 'models')
copied = []
for f in sorted(os.listdir(root)):
    if f.endswith('.onnx'):
        shutil.copy2(os.path.join(root, f), os.path.join(dest, f)); copied.append(f)
print('models in', dest, ':', ', '.join(copied))
PY
cat > "$HOME_DIR/models/active.json" <<JSON
{"set": "$SET", "version": "$VER", "detFile": "$DF", "recFile": "$RF", "clsFile": "ch_ppocr_mobile_v2.0_cls_mobile.onnx"}
JSON
echo "installed. Try: python3 -I tools/understand/bench-ocr.py --engine rapid:$VER:$DET:$REC  (dev sets only)"
