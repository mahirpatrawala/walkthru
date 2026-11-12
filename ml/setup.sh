#!/usr/bin/env bash
# C10 environment (SPEC 15.1). Idempotent. Needs Homebrew.
set -euo pipefail
ML=$HOME/walkthru-tools/ml
HERE="$(cd "$(dirname "$0")" && pwd)"
brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
mkdir -p "$ML"/{src,weights,runs}
[ -d "$ML/.venv" ] || /opt/homebrew/bin/python3.12 -m venv "$ML/.venv"
. "$ML/.venv/bin/activate"
pip install --upgrade pip
pip install -r "$HERE/requirements.txt"
pip install --no-deps "utils3d_moge @ git+https://github.com/EasternJournalist/utils3d-moge.git@62f09d58509485564e24d5d9f6aac9ee9ebc0c37"
clone() { # dir url sha
  [ -d "$ML/src/$1/.git" ] && return 0
  mkdir -p "$ML/src/$1" && cd "$ML/src/$1" && git init -q && git remote add origin "$2" && git fetch -q --depth 1 origin "$3" && git checkout -q FETCH_HEAD
}
clone da3  https://github.com/ByteDance-Seed/Depth-Anything-3 3d835ec1a5802d64a8b8b15f817a1ab54809bfe4
clone moge https://github.com/microsoft/MoGe                  74fbce054ebed49800de42d0ad0e83495065719a
clone da2  https://github.com/DepthAnything/Depth-Anything-V2 a561b849ebae10a6f5ef49e26c83cbbcd36c71bf
python "$HERE/fetch_weights.py"
