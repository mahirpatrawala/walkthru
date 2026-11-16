# Reference images for the 3D generators (SPEC 16.15, route B): a generic furniture description in, a clean three-quarter product picture out, made by the
# Apache-2.0 FLUX.1-schnell on the free hosted Space (anonymous: about 2 GPU minutes a day, one call about 6 s, stops on a quota error). Run with
# ~/walkthru-tools/gen3d/venv (pip install gradio_client pillow). Only generic descriptions leave the machine. Results and prompts go to ref/<name>.png and .json.

import json, sys, time, hashlib, shutil
from gradio_client import Client
S = "three-quarter front view from slightly above, product photograph, isolated on a plain pure white background, soft even studio lighting, no shadow, single object, whole object in frame, contemporary Indian apartment style"
P = {
 "sofa3": "A modern three-seater fabric sofa with slim tapered wooden legs, light grey upholstery, thick seat cushions and soft back cushions, low square arms",
 "sofa2": "A modern two-seater fabric loveseat sofa with slim tapered wooden legs, light grey upholstery, thick seat cushions and soft back cushions, low square arms",
 "armchair": "A modern fabric armchair with slim tapered wooden legs, light grey upholstery, thick seat cushion, soft back cushion, low square arms",
 "bedq": "A modern queen size bed with a storage box base in light oak wood, a tall upholstered grey headboard, a white mattress with two pillows, no bedding other than a plain white duvet",
 "dchair": "A modern dining chair with a padded fabric seat and a padded curved back, slim solid wood legs",
 "coffee": "A modern rectangular wooden coffee table with a thick oak top and four slim tapered legs",
 "ochair": "A modern ergonomic office chair, mesh back, black frame, five-star base with castors, adjustable armrests",
 "wc": "A modern white ceramic western toilet commode, floor mounted, with a close-coupled cistern and a closed seat lid",
 "basin": "A modern white ceramic wash basin on a pedestal, single tap hole, rounded rectangular bowl",
 "tvunit": "A modern low TV unit, wide walnut wood cabinet on short legs with two sliding doors and an open shelf",
 "desk": "A modern study desk in light oak with a single drawer and four slim legs, simple rectangular top",
 "wardrobe": "A modern three door wardrobe, floor to ceiling, plain white laminate doors with slim vertical handles, a small plinth",
 "fridge": "A modern double door refrigerator, stainless steel finish, top freezer, vertical bar handles",
 "washer": "A modern front loading washing machine, white body, round glass door, control knob panel at the top",
 "treadmill": "A modern home treadmill with a black running belt, handrails and a control console, dark grey frame",
 "lounger": "A modern outdoor pool lounger, white sun lounger with a reclined back and slim aluminium frame",
 "bench": "A park bench with a wooden slatted seat and back on cast iron side frames",
 "billiards": "A billiards pool table with green cloth, dark wood body, six pockets, four thick legs",
}
only = sys.argv[1:] or list(P)
c = Client("black-forest-labs/FLUX.1-schnell", httpx_kwargs={"timeout":180})
for name in only:
    prompt = P[name] + ", " + S
    for attempt in range(1):
        try:
            t=time.time()
            res = c.predict(prompt=prompt, seed=11, randomize_seed=False, width=1024, height=1024, num_inference_steps=4, api_name="/infer")
        except Exception as e:
            print(name, "ERROR", str(e)[:300]); 
            if "quota" in str(e).lower() or "GPU" in str(e): print("QUOTA, stopping"); sys.exit(2)
            continue
        from PIL import Image
        im = Image.open(res[0]).convert("RGB"); out=f"ref/{name}.png"; im.save(out)
        json.dump({"name":name,"prompt":prompt,"seed":res[1],"space":"black-forest-labs/FLUX.1-schnell","model_license":"apache-2.0","sha256":hashlib.sha256(open(out,'rb').read()).hexdigest(),"date":"2026-11-16"}, open(f"ref/{name}.json","w"), indent=1)
        print(name, "ok", round(time.time()-t,1), flush=True)
        time.sleep(3)
