#!/usr/bin/env node
// VTO eval runner: sends every (person, garment) pair to every model via OpenRouter
// and records the output image, real cost (usage.cost) and wall-clock latency.
//
//   node run.mjs                      # full run: all pairs x all models
//   node run.mjs --pairs pair01       # subset of pairs (comma-separated)
//   node run.mjs --models google/...  # subset of models
//   node run.mjs --repeat 3           # N samples per (pair, model)
//   node run.mjs --out runs/smoke     # output dir (relative to the project root)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PROMPT_VERSION, buildPrompt } from "./prompt.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = HERE
const DATA = path.join(HERE, "dataset")

function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    const m = fs.readFileSync(p, "utf8").match(/^OPENROUTER_API_KEY=["']?([^"'\r\n]+)/m)
    if (m) return m[1]
  }
  throw new Error("OPENROUTER_API_KEY not found in env, .env.local or .env")
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
)
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"))
const allPairs = JSON.parse(fs.readFileSync(path.join(DATA, "pairs.json"), "utf8"))
const candidates = JSON.parse(fs.readFileSync(path.join(HERE, "models.json"), "utf8")).candidates
const allModels = candidates.map((c) => c.id)
const IMAGES_API = new Set(candidates.filter((c) => c.api === "images").map((c) => c.id))
const RESOLUTION = args.resolution || "1K" // same output size for every model

const pairs = args.pairs ? allPairs.filter((p) => args.pairs.split(",").includes(p.id)) : allPairs
const models = args.models ? args.models.split(",") : allModels
const repeat = Number(args.repeat || 1)
const outDir = path.join(HERE, args.out || `runs/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`)
const CONCURRENCY = Number(args.concurrency || 4) // per model
const TIMEOUT_MS = 180_000

const byId = (list, id) => list.find((x) => x.id === id)
const dataUrl = (rel) => `data:image/jpeg;base64,${fs.readFileSync(path.join(HERE, rel)).toString("base64")}`

// Aspect ratio of the person photo, snapped to a ratio image models commonly accept.
const RATIOS = { "1:1": 1, "4:5": 0.8, "3:4": 0.75, "2:3": 0.667, "9:16": 0.5625, "5:4": 1.25, "4:3": 1.333, "3:2": 1.5, "16:9": 1.778 }
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  throw new Error("not a jpeg")
}
function aspectFor(rel, allowed) {
  const { w, h } = jpegSize(fs.readFileSync(path.join(HERE, rel)))
  const ratio = (s) => { const [a, b] = s.split(":").map(Number); return a / b }
  const options = allowed ? allowed.filter((s) => s.includes(":")) : Object.keys(RATIOS)
  return options.sort((a, b) => Math.abs(ratio(a) - w / h) - Math.abs(ratio(b) - w / h))[0]
}

// Images API models each accept a different parameter set; only send what the model supports.
let imageCaps
async function capsFor(model) {
  imageCaps ??= fetch("https://openrouter.ai/api/v1/images/models").then((r) => r.json()).then((j) => Object.fromEntries(j.data.map((m) => [m.id, m.supported_parameters || {}])))
  return (await imageCaps)[model] || {}
}

const HEADERS = (key) => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...(process.env.OPENROUTER_APP_URL ? { "HTTP-Referer": process.env.OPENROUTER_APP_URL } : {}),
  "X-Title": process.env.OPENROUTER_APP_TITLE || "vto-eval",
})

async function post(key, url, body) {
  const t0 = performance.now()
  const res = await fetch(url, { method: "POST", headers: HEADERS(key), body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  const ttfb = performance.now() - t0
  const json = await res.json().catch(() => null)
  return { res, json, ttfb, latency: performance.now() - t0 }
}

// Image-only models (e.g. Hy Image) are served on the dedicated Images API, not chat/completions.
async function callImagesApi(key, model, person, garment) {
  const caps = await capsFor(model)
  const { res, json, ttfb, latency } = await post(key, "https://openrouter.ai/api/v1/images", {
    model,
    prompt: buildPrompt(garment),
    input_references: [person.file, garment.file].map((f) => ({ type: "image_url", image_url: { url: dataUrl(f) } })),
    aspect_ratio: aspectFor(person.file, caps.aspect_ratio?.values),
    ...(caps.resolution?.values?.includes(RESOLUTION) ? { resolution: RESOLUTION } : {}),
    n: 1,
  })
  if (!res.ok || !json || json.error) {
    return { ok: false, status: res.status, error: json?.error?.message || JSON.stringify(json)?.slice(0, 500), latency_ms: latency, ttfb_ms: ttfb }
  }
  const d = json.data?.[0]
  return {
    ok: !!d?.b64_json,
    error: d?.b64_json ? undefined : `no image returned: ${JSON.stringify(json).slice(0, 300)}`,
    image: d?.b64_json ? `data:${d.media_type || "image/png"};base64,${d.b64_json}` : undefined,
    cost: json.usage?.cost,
    usage: json.usage,
    latency_ms: latency,
    ttfb_ms: ttfb,
  }
}

async function callModel(key, model, person, garment) {
  if (IMAGES_API.has(model)) return callImagesApi(key, model, person, garment)
  const body = {
    model,
    modalities: model.startsWith("google/") ? ["image", "text"] : ["image"],
    image_config: { aspect_ratio: aspectFor(person.file), image_size: RESOLUTION },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt(garment) },
          { type: "image_url", image_url: { url: dataUrl(person.file) } },
          { type: "image_url", image_url: { url: dataUrl(garment.file) } },
        ],
      },
    ],
    usage: { include: true },
  }
  const { res, json, ttfb, latency } = await post(key, "https://openrouter.ai/api/v1/chat/completions", body)
  if (!res.ok || !json || json.error) {
    return { ok: false, status: res.status, error: json?.error?.message || JSON.stringify(json)?.slice(0, 500), latency_ms: latency, ttfb_ms: ttfb }
  }
  const msg = json.choices?.[0]?.message
  const img = msg?.images?.[0]?.image_url?.url
  return {
    ok: !!img,
    error: img ? undefined : `no image returned; text: ${(msg?.content || "").slice(0, 300)}; finish: ${json.choices?.[0]?.finish_reason}`,
    image: img,
    text: msg?.content || undefined,
    cost: json.usage?.cost,
    usage: json.usage,
    provider: json.provider,
    generation_id: json.id,
    latency_ms: latency,
    ttfb_ms: ttfb,
  }
}

async function pool(items, n, fn) {
  const q = [...items]
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()) }))
}

async function main() {
  const key = loadKey()
  fs.mkdirSync(outDir, { recursive: true })
  // Adding models or pairs to an existing run extends its config instead of replacing it.
  const configPath = path.join(outDir, "config.json")
  const prev = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null
  if (prev && prev.prompt_version !== PROMPT_VERSION) throw new Error(`run used prompt ${prev.prompt_version}, current is ${PROMPT_VERSION}; use a new --out`)
  const union = (a = [], b) => [...new Set([...a, ...b])]
  fs.writeFileSync(configPath, JSON.stringify({
    prompt_version: PROMPT_VERSION,
    models: union(prev?.models, models),
    pairs: union(prev?.pairs, pairs.map((p) => p.id)),
    repeat: Math.max(prev?.repeat || 1, repeat),
    started: prev?.started || new Date().toISOString(),
  }, null, 2))
  const resultsPath = path.join(outDir, "results.jsonl")
  const done = new Set(fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ok).map((r) => `${r.model}|${r.pair}|${r.sample}`) : [])

  const jobsByModel = models.map((model) =>
    pairs.flatMap((pair) => Array.from({ length: repeat }, (_, s) => ({ model, pair, sample: s + 1 }))).filter((j) => !done.has(`${j.model}|${j.pair.id}|${j.sample}`))
  )
  const total = jobsByModel.flat().length
  let n = 0
  console.log(`${total} calls -> ${path.relative(ROOT, outDir)}`)

  await Promise.all(jobsByModel.map((jobs) => pool(jobs, CONCURRENCY, async ({ model, pair, sample }) => {
    const person = byId(manifest.people, pair.person), garment = byId(manifest.garments, pair.garment)
    let r
    try { r = await callModel(key, model, person, garment) } catch (e) { r = { ok: false, error: String(e) } }
    let file
    if (r.ok) {
      const m = r.image.match(/^data:image\/(\w+);base64,(.*)$/s)
      const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "png"
      file = `${model.replace("/", "__")}/${pair.id}_s${sample}.${ext}`
      fs.mkdirSync(path.join(outDir, path.dirname(file)), { recursive: true })
      if (m) fs.writeFileSync(path.join(outDir, file), Buffer.from(m[2], "base64"))
      else fs.writeFileSync(path.join(outDir, file), Buffer.from(await (await fetch(r.image)).arrayBuffer()))
    }
    const { image, ...rest } = r
    fs.appendFileSync(resultsPath, JSON.stringify({ model, pair: pair.id, person: pair.person, garment: pair.garment, sample, file, ...rest }) + "\n")
    n++
    console.log(`[${n}/${total}] ${model} ${pair.id} s${sample} ${r.ok ? "ok" : "FAIL"} ${(r.latency_ms / 1000).toFixed(1)}s ${r.cost != null ? "$" + r.cost.toFixed(4) : ""} ${r.ok ? "" : r.error?.slice(0, 160)}`)
  })))
}

main().catch((e) => { console.error(e); process.exit(1) })
