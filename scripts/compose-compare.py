#!/usr/bin/env python3
"""Builds the owner's side-by-side sheets from the compare-demo.html shots (tools/cdp.mjs, see SPEC 16.15 "Pictures").
usage: compose-compare.py <shots dir with before/ and after/> <out dir> <piece> [<piece> ...]
For each piece: row 1 old (generated) | new, at about 2.5 m; row 2 the same at 40 cm, 100 % crops; row 3 the new piece 12 % wider and in a second colour, at 2.5 m and 40 cm."""
import sys, os
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
pieces = sys.argv[3:]
os.makedirs(out, exist_ok=True)
W, H = 640, 455
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
except Exception:
    font = ImageFont.load_default()

def load(path):
    im = Image.open(path).convert('RGB')
    return im.resize((W, H), Image.LANCZOS)

def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 30], fill=(255, 255, 255))
    d.text((8, 3), text, fill=(30, 30, 30), font=font)
    return im

sheets = {}
for p in pieces:
    b, a = f'{src}/before/{p}', f'{src}/after/{p}'
    tiles = [
        [(f'{b}-walk.png', 'old: generated, 2.5 m'), (f'{a}-walk.png', 'new, 2.5 m')],
        [(f'{b}-close.png', 'old, 40 cm'), (f'{a}-close.png', 'new, 40 cm')],
        [(f'{a}-t-walk.png', 'new, +12% wide, recoloured, 2.5 m'), (f'{a}-t-close.png', 'new, +12% wide, recoloured, 40 cm')],
    ]
    sheet = Image.new('RGB', (W * 2 + 6, H * 3 + 12), (255, 255, 255))
    for r, row in enumerate(tiles):
        for c, (path, txt) in enumerate(row):
            if not os.path.exists(path):
                continue
            sheet.paste(label(load(path), txt), (c * (W + 6), r * (H + 6)))
    sheet.save(f'{out}/compare-{p}.png')
    sheets[p] = sheet
    print('wrote', f'{out}/compare-{p}.png')
