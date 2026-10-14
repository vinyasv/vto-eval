| Model | Usable | Clean | Quality | Garment | Identity | Scene | Fit | Artifacts | p50 latency | p90 latency | $/image | $/usable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hy Image 3.5 Preview (`tencent/hy-image-v3.5-preview`) | 20/20 | 14/20 | 4.91 | 4.80 | 5.00 | 4.85 | 5.00 | 4.90 | 16.8s | 20.9s | $0.024 | $0.024 |
| Seedream 5.0 Flash (`bytedance-seed/seedream-5-0-flash`) | 19/20 | 14/20 | 4.75 | 4.85 | 4.55 | 4.55 | 4.85 | 4.95 | 15.0s | 18.9s | $0.018 | $0.019 |
| FLUX.3 Image (`black-forest-labs/flux-3-image`) | 18/20 | 13/20 | 4.91 | 4.74 | 4.95 | 4.95 | 4.89 | 5.00 | 71.1s | 90.3s | $0.048 | $0.051 |
| Gemini 3.1 Flash Lite Image (`google/gemini-3.1-flash-lite-image`) | 18/20 | 6/20 | 4.52 | 4.70 | 4.40 | 3.80 | 4.75 | 4.95 | 7.1s | 9.4s | $0.034 | $0.038 |
| FLUX.2 Klein 4B (`black-forest-labs/flux.2-klein-4b`) | 14/20 | 6/20 | 4.39 | 4.25 | 4.40 | 3.80 | 4.70 | 4.80 | 8.7s | 11.4s | $0.017 | $0.024 |

Unusable outputs:

- **Seedream 5.0 Flash**, pair01: turned person to face away (copied back-view of product)
- **FLUX.3 Image**, pair13: BLOCKED by provider moderation (no image)
- **FLUX.3 Image**, pair15: colour wrong (taupe/brown instead of olive)
- **Gemini 3.1 Flash Lite Image**, pair11: body visibly slimmed/taller and pose copied from product model (hand on hip)
- **Gemini 3.1 Flash Lite Image**, pair17: entirely different person, zoomed in, wearing product photo's skirt too
- **FLUX.2 Klein 4B**, pair01: added a black blazer over the tee
- **FLUX.2 Klein 4B**, pair02: body much heavier, face/expression changed, shirt became paisley, trousers changed to matching suit
- **FLUX.2 Klein 4B**, pair07: added a navy blazer-like jacket over the vest (copied the hanger undershirt as outerwear)
- **FLUX.2 Klein 4B**, pair13: different-looking woman (face changed) and blazer removed
- **FLUX.2 Klein 4B**, pair17: saree replaced by the product photo's white shorts; younger/slimmer woman, crouching pose
- **FLUX.2 Klein 4B**, pair20: added the navy overshirt from the product photo as a sash over the skirt
