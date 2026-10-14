#!/usr/bin/env python3
"""Join blind grades with the model key and run results, then write the summary.

    python3 scripts/summarize.py runs/v1 results/2026-10-14-v1

Reads   <run>/grading/grades.txt and <run>/grading/blind_key.json
        (or an existing <results>/grades.json if grades.txt is absent),
        <run>/results.jsonl
Writes  <results>/grades.json, <results>/summary.md   (safe to commit)
        <run>/eval_report.html                        (embeds images of people; keep local)
"""
import base64, glob, io, json, statistics as st, sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RUN, RESULTS = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
RESULTS.mkdir(parents=True, exist_ok=True)
DIMS = ["garment", "identity", "scene", "fit", "artifacts"]

manifest = json.loads((ROOT / "dataset/manifest.json").read_text())
people = {p["id"]: p for p in manifest["people"]}
garments = {g["id"]: g for g in manifest["garments"]}
pairs = {p["id"]: p for p in json.loads((ROOT / "dataset/pairs.json").read_text())}
names = {c["id"]: c.get("name", c["id"].split("/")[1]) for c in json.loads((ROOT / "models.json").read_text())["candidates"]}

grades_txt = RUN / "grading/grades.txt"
if grades_txt.exists():
    key = json.loads((RUN / "grading/blind_key.json").read_text())
    rows = []
    for line in grades_txt.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split(" ")
        pid, label, scores, unusable, note = parts[0], parts[1], parts[2:7], int(parts[7]), " ".join(parts[8:])
        blocked = scores[0] == "-"
        rows.append({"pair": pid, "label": label, "model": key[pid][label], "blocked": blocked,
                     **{d: None if blocked else int(s) for d, s in zip(DIMS, scores)},
                     "unusable": unusable, "note": note})
    (RESULTS / "grades.json").write_text(json.dumps(rows, indent=1))
else:
    rows = json.loads((RESULTS / "grades.json").read_text())

results = [json.loads(l) for l in (RUN / "results.jsonl").read_text().splitlines() if l.strip()]
latest = {}
for r in results:
    latest[(r["model"], r["pair"], r["sample"])] = r
lat, cost = {}, {}
for r in latest.values():
    if r.get("ok") and r["sample"] == 1:
        lat.setdefault(r["model"], []).append(r["latency_ms"] / 1000)
        cost.setdefault(r["model"], []).append(r.get("cost") or 0)

summary = []
for m in dict.fromkeys(r["model"] for r in rows):
    rs = [r for r in rows if r["model"] == m]
    ok = [r for r in rs if not r["blocked"]]
    means = {d: st.mean(r[d] for r in ok) for d in DIMS}
    usable = sum(1 for r in rs if not r["unusable"])
    clean = sum(1 for r in ok if not r["unusable"] and all(r[d] == 5 for d in DIMS))
    ls = sorted(lat.get(m, [0]))
    summary.append({"m": m, "n": names.get(m, m), "means": means, "mean": st.mean(means.values()),
                    "usable": usable, "perfect": clean, "total": len(rs),
                    "p50": st.median(ls), "p90": ls[min(len(ls) - 1, round(0.9 * (len(ls) - 1)))],
                    "cost": st.mean(cost.get(m, [0])), "per_usable": sum(cost.get(m, [0])) / max(usable, 1)})
summary.sort(key=lambda s: (-s["usable"], -s["mean"]))

md = ["| Model | Usable | Clean | Quality | Garment | Identity | Scene | Fit | Artifacts | p50 latency | p90 latency | $/image | $/usable |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for s in summary:
    md.append(f"| {s['n']} (`{s['m']}`) | {s['usable']}/{s['total']} | {s['perfect']}/{s['total']} | {s['mean']:.2f} | "
              + " | ".join(f"{s['means'][d]:.2f}" for d in DIMS)
              + f" | {s['p50']:.1f}s | {s['p90']:.1f}s | ${s['cost']:.3f} | ${s['per_usable']:.3f} |")
md += ["", "Unusable outputs:", ""]
for s in summary:
    bad = [r for r in rows if r["model"] == s["m"] and r["unusable"]]
    for r in bad:
        md.append(f"- **{s['n']}**, {r['pair']}: {r['note']}")
(RESULTS / "summary.md").write_text("\n".join(md) + "\n")
print("\n".join(md))


def thumb(path, size):
    im = Image.open(path).convert("RGB")
    im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


gallery = []
for r in rows:
    if not r["unusable"]:
        continue
    p = pairs[r["pair"]]
    out = glob.glob(str(RUN / r["model"].replace("/", "__") / f"{r['pair']}_s1.*"))
    gallery.append({"pair": r["pair"], "model": names.get(r["model"], r["model"]), "note": r["note"],
                    "person": thumb(ROOT / people[p["person"]]["file"], 220),
                    "garment": thumb(ROOT / garments[p["garment"]]["file"], 220),
                    "out": thumb(out[0], 300) if out else None})
data = {"summary": summary, "rows": [dict(r, model=names.get(r["model"], r["model"])) for r in rows], "gallery": gallery}
page = (ROOT / "templates/report.html").read_text().replace("/*__DATA__*/null", json.dumps(data))
(RUN / "eval_report.html").write_text(page)
print(f"\nwrote {RESULTS / 'summary.md'}, {RESULTS / 'grades.json'} and {RUN / 'eval_report.html'}")
