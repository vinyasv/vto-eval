#!/usr/bin/env node
// Downloads the 40 dataset images from Unsplash into dataset/garments and dataset/people.
// Images are not committed to the repo; this rebuilds them exactly (1024px long side, same crops).
//
//   node scripts/fetch-dataset.mjs           # skip files that already exist
//   node scripts/fetch-dataset.mjs --force   # re-download everything

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "dataset/manifest.json"), "utf8"))
const force = process.argv.includes("--force")

const items = [...manifest.garments, ...manifest.people]
let fetched = 0
for (const item of items) {
  const out = path.join(ROOT, item.file)
  if (!force && fs.existsSync(out)) continue
  const url = new URL(item.image_url)
  // Unsplash serves through imgix: rect crops in original pixels before the resize.
  if (item.crop) url.searchParams.set("rect", item.crop.join(","))
  // Uncropped images are 1024 wide; crops are 1024 on their long side.
  url.searchParams.set(item.crop && item.crop[3] > item.crop[2] ? "h" : "w", "1024")
  if (item.crop) url.searchParams.set("fit", "max")
  url.searchParams.set("q", "85")
  url.searchParams.set("fm", "jpg")
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${item.id}: HTTP ${res.status} for ${url}`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  fetched++
  console.log(`${item.id}  ${item.file}  (photo by ${item.author}, ${item.source})`)
}
console.log(`${fetched} downloaded, ${items.length - fetched} already present`)
