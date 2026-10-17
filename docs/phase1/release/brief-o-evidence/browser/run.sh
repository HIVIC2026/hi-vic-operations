#!/bin/zsh
# Brief O — one complete journey from a clean fixture: prep, then every browser phase in order.
# Usage: ./run.sh <run-number>
set -u
RUN="${1:-1}"
WT=/Users/jet.zhang/CopilotWorkspace/Loveable/wt-r1-brief-n-ready-check
PY=/opt/anaconda3/bin/python
cd /tmp/brief-o-browser || exit 1

rm -f "results-$RUN.json"
echo "=== prep (run $RUN) ==="
(cd "$WT" && bun tests/brief-o/prep.ts "$RUN") || { echo "prep failed"; exit 1; }

for ph in owner office_send offer accept installer_rc office_review security; do
  echo "=== $ph ==="
  $PY journey.py "$RUN" "$ph" 2>&1 | grep -E "^(PASS|FAIL|Traceback|[A-Za-z_.]*Error)" || true
done

echo "=== summary ==="
$PY - "$RUN" <<'PY'
import json, sys, pathlib
rows = json.loads(pathlib.Path(f"results-{sys.argv[1]}.json").read_text())
ok = sum(1 for r in rows if r["ok"])
print(f"run{sys.argv[1]}: {ok} pass / {len(rows)-ok} fail / {len(rows)} checks")
PY
