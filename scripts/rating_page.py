#!/usr/bin/env python3
"""Build a self-contained, blind rating page for a VTO eval run.

    python3 scripts/rating_page.py runs/v1

Writes <run>/report.html (images embedded, downscaled) and prints cost/latency stats.
Outputs for each pair are shuffled and labelled A/B/C so raters don't know which model
made which image; "Reveal models" shows the key and per-model averages of the ratings.
"""
import base64, html, io, json, random, statistics, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
RUN = Path(sys.argv[1]).resolve()
MAX_SIDE = 720


def thumb(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else None


results = [json.loads(l) for l in (RUN / "results.jsonl").read_text().splitlines() if l.strip()]
config = json.loads((RUN / "config.json").read_text())
manifest = json.loads((HERE / "dataset/manifest.json").read_text())
pairs = {p["id"]: p for p in json.loads((HERE / "dataset/pairs.json").read_text())}
people = {p["id"]: p for p in manifest["people"]}
garments = {g["id"]: g for g in manifest["garments"]}
models = config["models"]

# Latest attempt wins for each (model, pair, sample), so retries replace failures.
latest = {}
for r in results:
    latest[(r["model"], r["pair"], r["sample"])] = r
rows = list(latest.values())

stats = []
for m in models:
    rs = [r for r in rows if r["model"] == m]
    ok = [r for r in rs if r.get("ok")]
    lat = [r["latency_ms"] / 1000 for r in ok]
    costs = [r["cost"] for r in ok if r.get("cost") is not None]
    stats.append({
        "model": m,
        "calls": len(rs),
        "ok": len(ok),
        "p50": pct(lat, 50), "p90": pct(lat, 90), "max": max(lat) if lat else None,
        "cost_mean": statistics.mean(costs) if costs else None,
        "cost_total": sum(r.get("cost") or 0 for r in rs),
        "errors": sorted({(r.get("error") or "")[:140] for r in rs if not r.get("ok")}),
    })

print(f"{'model':40} {'ok':>7} {'p50 s':>7} {'p90 s':>7} {'max s':>7} {'$/img':>8} {'$ total':>8}")
for s in stats:
    f = lambda v, d=1: "-" if v is None else f"{v:.{d}f}"
    print(f"{s['model']:40} {s['ok']:>3}/{s['calls']:<3} {f(s['p50']):>7} {f(s['p90']):>7} {f(s['max']):>7} {f(s['cost_mean'],4):>8} {f(s['cost_total'],3):>8}")
    for e in s["errors"]:
        print("    error:", e)

# Build the blind items: one card per pair, outputs shuffled with a fixed seed.
rng = random.Random(42)
cards = []
for pid in config["pairs"]:
    pair = pairs[pid]
    outs = [r for r in rows if r["pair"] == pid and r["sample"] == 1]
    rng.shuffle(outs)
    cards.append({
        "pair": pid,
        "tests": pair["tests"],
        "person": thumb(HERE / people[pair["person"]]["file"]),
        "garment": thumb(HERE / garments[pair["garment"]]["file"]),
        "garment_desc": garments[pair["garment"]]["description"],
        "outputs": [{
            "label": "ABCDEFG"[i],
            "model": r["model"],
            "ok": bool(r.get("ok")),
            "img": thumb(RUN / r["file"]) if r.get("ok") else None,
            "latency": round(r["latency_ms"] / 1000, 1) if r.get("latency_ms") else None,
            "cost": r.get("cost"),
            "error": (r.get("error") or "")[:200],
        } for i, r in enumerate(outs)],
    })

data = {"run": RUN.name, "prompt_version": config["prompt_version"], "models": models, "stats": stats, "cards": cards}
page = (HERE / "templates/rating.html").read_text().replace("/*__DATA__*/null", json.dumps(data))
(RUN / "report.html").write_text(page)
print(f"\nwrote {RUN / 'report.html'} ({(RUN / 'report.html').stat().st_size / 1e6:.1f} MB)")
