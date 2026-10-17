#!/bin/zsh
# Brief N — one full browser run of the Ready Check success path.
# Usage: ./run.sh <run-number>
set -o pipefail
RUN=${1:-1}
REPO=/Users/jet.zhang/CopilotWorkspace/Loveable/wt-r1-brief-n-ready-check
PY=/opt/anaconda3/bin/python
cd "$REPO" || exit 1
echo "===== RUN $RUN ====="
echo "--- step 0: reset synthetic fixtures + owner availability (service level) ---"
bun tests/brief-n/prep-browser.ts > /tmp/brief-n-browser/prep-$RUN.log 2>&1
echo "prep exit: $?"
echo "--- step B: Office sends the Ready Check offer (browser) ---"
$PY /tmp/brief-n-browser/journey.py $RUN send; echo "send exit: $?"
echo "--- step C/D: Installer receives and accepts (browser) ---"
$PY /tmp/brief-n-browser/journey.py $RUN accept; echo "accept exit: $?"
echo "--- step E-prep: office sees the booked Ready Check (browser) ---"
$PY /tmp/brief-n-browser/journey.py $RUN booked; echo "booked exit: $?"
echo "--- step E: installer submits the Ready Check (service level: the form is Mitti-hosted) ---"
bun tests/brief-n/submit-rc.ts; echo "submit exit: $?"
echo "--- step F: Office sees the submitted Ready Check (browser) ---"
$PY /tmp/brief-n-browser/journey.py $RUN review; echo "review exit: $?"
echo "--- step N: negative / security checks in the browser ---"
$PY /tmp/brief-n-browser/journey.py $RUN security; echo "security exit: $?"
echo "--- results ---"
/Users/jet.zhang/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3 - <<PY
import json, pathlib
p = pathlib.Path("/tmp/brief-n-browser/results-$RUN.json")
rows = json.loads(p.read_text()) if p.exists() else []
ok = sum(1 for r in rows if r["ok"])
print(f"{ok} pass / {len(rows)-ok} fail / {len(rows)} checks")
for r in rows:
    if not r["ok"]:
        print("FAILED:", r["name"], "|", r["info"])
PY
