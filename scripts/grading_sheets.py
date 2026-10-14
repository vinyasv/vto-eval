#!/usr/bin/env python3
"""Make blind grading sheets: one image per pair with the inputs on top and the
model outputs below, shuffled and labelled A, B, C... The label -> model key is
written separately so a grader (human or model) can score without knowing which
model made which image.

    python3 scripts/grading_sheets.py runs/v1

Writes <run>/grading/pairXX.jpg and <run>/grading/blind_key.json.
Record grades in <run>/grading/grades.txt, one line per output:

    pair01 A 5 5 5 4 5 0 short note
    (pair label garment identity scene fit artifacts unusable note; use "-" for
     the five scores when the model returned no image)

Then run scripts/summarize.py.
"""
import glob, json, random, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RUN = Path(sys.argv[1]).resolve()
OUT = RUN / "grading"
OUT.mkdir(exist_ok=True)

manifest = json.loads((ROOT / "dataset/manifest.json").read_text())
people = {p["id"]: p for p in manifest["people"]}
garments = {g["id"]: g for g in manifest["garments"]}
pairs = json.loads((ROOT / "dataset/pairs.json").read_text())
models = json.loads((RUN / "config.json").read_text())["models"]

rng = random.Random(20261014)
key = {}
W, H = 400, 600
for p in pairs:
    order = models[:]
    rng.shuffle(order)
    key[p["id"]] = {}
    sheet = Image.new("RGB", (W * max(5, len(order)), H * 2 + 40), "white")
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate([people[p["person"]]["file"], garments[p["garment"]]["file"]]):
        im = Image.open(ROOT / f).convert("RGB")
        im.thumbnail((W * 2 - 10, H))
        sheet.paste(im, (i * W * 2, 0))
    g = garments[p["garment"]]
    d.text((W * 4 + 10, 10), f"{p['id']}\n{p['tests'][:60]}\n{g['category']}: {g['description'][:40]}", fill="black", font_size=18)
    for j, model in enumerate(order):
        label = "ABCDEFGHIJ"[j]
        key[p["id"]][label] = model
        found = glob.glob(str(RUN / model.replace("/", "__") / f"{p['id']}_s1.*"))
        if found:
            im = Image.open(found[0]).convert("RGB")
            im.thumbnail((W - 6, H))
            sheet.paste(im, (j * W, H + 40))
        else:
            d.text((j * W + 20, H + 200), "NO IMAGE", fill="red", font_size=22)
        d.text((j * W + 6, H + 10), label, fill="blue", font_size=24)
    sheet.save(OUT / f"{p['id']}.jpg", quality=88)

(OUT / "blind_key.json").write_text(json.dumps(key, indent=1))
print(f"wrote {len(pairs)} sheets to {OUT}")
