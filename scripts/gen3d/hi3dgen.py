# Shape from one reference image with Hi3DGen / Stable3DGen (Stable-X, MIT, commercial use stated in its README, see scripts/look-model-routes.json) on the
# free hosted Space. SHAPE ONLY (no texture): the model library gives every part a finish material, so the shape is split into named parts afterwards.
# UNTESTED: the anonymous ZeroGPU quota (2 minutes a day, reset 24 h after the first use) was used up before the first call. One call is the whole day's quota,
# so run it for one piece a day, never retry in a loop, and stop on a quota error.  usage: python hi3dgen.py <name> [seed]   (reads ref/<name>.rgba.png)
import hashlib, json, shutil, sys, time
from gradio_client import Client, handle_file

name = sys.argv[1]
seed = int(sys.argv[2]) if len(sys.argv) > 2 else 0
c = Client("Stable-X/Hi3DGen", httpx_kwargs={"timeout": 300})
t = time.time()
try:
    res = c.predict(image=handle_file(f"ref/{name}.rgba.png"), seed=seed, ss_guidance_strength=3, ss_sampling_steps=50,
                    slat_guidance_strength=3.0, slat_sampling_steps=6, api_name="/generate_3d")
except Exception as e:
    print("ERROR", str(e)[:300]); sys.exit(2)
glb = res[3]
dst = f"glb/{name}.hi3dgen.glb"
shutil.copy(glb, dst)
json.dump({"name": name, "space": "Stable-X/Hi3DGen", "seed": seed, "secs": round(time.time() - t, 1), "sha256": hashlib.sha256(open(dst, "rb").read()).hexdigest(),
           "date": "2026-11-16"}, open(f"glb/{name}.hi3dgen.json", "w"), indent=1)
print(dst)
