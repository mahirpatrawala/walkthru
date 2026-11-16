# Cuts the white background off a reference image with rembg (u2net, Apache-2.0) so the 3D generator never needs its own background remover
# (TRELLIS.2 uses briaai/RMBG-2.0, non-commercial). venv12: python3.12 -m venv, pip install "rembg[cpu]" pillow numpy scipy. Writes ref/<name>.rgba.png.

import sys
from rembg import remove, new_session
from PIL import Image
import numpy as np
s=new_session("u2net")
for name in sys.argv[1:]:
    im=Image.open(f'ref/{name}.png').convert('RGB')
    out=remove(im, session=s)
    a=np.array(out)
    # keep the largest connected blob of alpha, binarise softly
    from scipy import ndimage
    al=a[...,3]>128
    lab,n=ndimage.label(al)
    if n>1:
        sizes=ndimage.sum(al,lab,range(1,n+1)); keep=1+int(np.argmax(sizes)); al=lab==keep
    a[...,3]=np.where(al,255,0).astype(np.uint8)
    Image.fromarray(a).save(f'ref/{name}.rgba.png'); print(name, al.mean())
