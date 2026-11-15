# Licence of the local text reader (SPEC 17.17)

What Walkthru's picture-of-a-plan reader runs, and the terms each part is under. Checked 15 Nov 2026 against the upstream pages named below.

| Part | What | Licence | Source checked |
| --- | --- | --- | --- |
| RapidOCR 3.10.0 (Python package, installed into a venv by `setup-ocr.sh`) | ONNX Runtime packaging of the PP-OCR pipeline | Apache-2.0 | package metadata (`License-Expression: Apache-2.0`, `LICENSE`) and https://github.com/RapidAI/RapidOCR |
| PP-OCRv6 tiny detection + recognition models, ONNX (1.8 MB + 4.5 MB) | text detector and recogniser (default) | Apache-2.0 | official model cards, e.g. https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx ("License: apache-2.0"); RapidOCR `MODEL_LICENSES.md` ("Official PaddlePaddle model cards identify the PP-OCRv6 model weights and ONNX representations as Apache-2.0") |
| Text-line orientation classifier `ch_ppocr_mobile_v2.0_cls_mobile.onnx` (0.6 MB) | turns upside-down lines | Apache-2.0 | same `MODEL_LICENSES.md`, PaddleOCR is Apache-2.0 (https://github.com/PaddlePaddle/PaddleOCR) |
| onnxruntime, numpy, opencv-python-headless, pillow, shapely, pyclipper | runtime libraries pulled in by RapidOCR | MIT / BSD / Apache-2.0 / HPND | their package metadata |

Apache-2.0 allows commercial use, modification and redistribution. Conditions that apply if the models are ever shipped with the product (for example served to the browser): keep the Apache-2.0 licence text and the copyright notices (Baidu / PaddleOCR authors, RapidOCR authors) with the files, and state that the ONNX files are converted from the PaddleOCR models. Nothing here uses the PaddleOCR or RapidOCR names as a product name.

Other engines looked at and why they are not used:

- **Surya**: code is Apache-2.0 but the model weights are under a modified AI Pubs Open Rail-M licence, free for research, personal use and startups under 5 million USD funding or revenue, with a paid licence for broader commercial use (https://github.com/datalab-to/surya). Not usable without a commercial agreement, and PyTorch only.
- **Tesseract 5**: Apache-2.0, kept as the fallback. Far lower recall on small plan text (see SPEC 17.17).
- **EasyOCR, docTR**: Apache-2.0 but PyTorch (or TensorFlow) engines with no ONNX distribution of the weights from the project, so they cannot run in a serverless function or the browser without a conversion nobody here has validated. Not benchmarked: they fail the deployability requirement before accuracy matters.
