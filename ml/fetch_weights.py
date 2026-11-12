"""Download the approved model weights and verify SHA-256 (SPEC 15.3). Refuses a mismatch.

Only commercial-OK weights approved for C10 are listed. Non-commercial yardsticks (Depth Pro, UniDepth)
and the 1.3 GB DA3 Metric Large / MoGe ViT-B were NOT approved for download and are deliberately absent.
"""
import hashlib, os, sys
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download

WEIGHTS = Path(os.environ.get("WALKTHRU_ML_WEIGHTS", Path.home() / "walkthru-tools/ml/weights"))

ITEMS = [
    # repo, 12-char revision prefix, file, sha256, licence
    ("depth-anything/DA3-SMALL", "e08cab65ca0e", "model.safetensors",
     "364492e38a3a06d221ac75da7f6621ada3f2361cd24fde11ba79091e9f40efcf", "Apache-2.0"),
    ("depth-anything/DA3-BASE", "f4a6c9b3c95e", "model.safetensors",
     "e01067dc1659613083d9145a9a2547ccdbe6ccbbf83c4fe7b3e8a4e2bdae78b5", "Apache-2.0"),
    ("Ruicheng/moge-2-vits-normal", "26b477f41595", "model.pt",
     "79a16621928c2bf0ed04659218c55c01075e950507f40bb3332fb4c873d3e1dc", "MIT"),
    ("depth-anything/Depth-Anything-V2-Metric-Hypersim-Small", "3bc65d4e14a6",
     "depth_anything_v2_metric_hypersim_vits.pth",
     "b782898d8a3e8be1f639de33837ed85e9b4b73e40f8f5e5cd99067588d722545", "Apache-2.0"),
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    api = HfApi()
    bad = 0
    for repo, prefix, fname, want, lic in ITEMS:
        # resolve the 12-char prefix to the full commit id and confirm it
        commits = [c.commit_id for c in api.list_repo_commits(repo)]
        full = next((c for c in commits if c.startswith(prefix)), None)
        if full is None:
            print(f"FAIL {repo}: no commit starts with {prefix}")
            bad += 1
            continue
        dest = WEIGHTS / repo.replace("/", "__")
        dest.mkdir(parents=True, exist_ok=True)
        path = Path(hf_hub_download(repo, fname, revision=full, local_dir=dest))
        if repo.startswith("depth-anything/DA3"):
            # DA3 loads through PyTorchModelHubMixin and needs the small config.json from the same revision
            hf_hub_download(repo, "config.json", revision=full, local_dir=dest)
        got = sha256(path)
        ok = got == want
        print(f"{'OK  ' if ok else 'FAIL'} {repo}@{full[:12]} {fname} sha256={got} licence={lic}")
        if not ok:
            path.unlink()
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
