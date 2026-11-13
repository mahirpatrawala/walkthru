#!/usr/bin/env python3
# C12b helper for src/understand/ocr.ts. Reads each PNG path given on the command line with RapidOCR (PaddleOCR models on ONNX
# Runtime, Apache-2.0) and prints one JSON line per file: {"text": "...", "confidence": 0.0-1.0}. Run in the C10 venv:
#   python3 -I tools/understand/ocr.py crop1.png crop2.png
# Not installed or run by the project yet (SPEC 17.5 item 3, risk 17.16-3). Nothing here touches the network.
import json
import sys


def main() -> int:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        sys.stderr.write("rapidocr_onnxruntime is not installed\n")
        return 2
    engine = RapidOCR()
    for path in sys.argv[1:]:
        result, _ = engine(path)
        if not result:
            print(json.dumps({"text": "", "confidence": 0.0}))
            continue
        text = " ".join(r[1] for r in result)
        conf = sum(float(r[2]) for r in result) / len(result)
        print(json.dumps({"text": text, "confidence": conf}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
