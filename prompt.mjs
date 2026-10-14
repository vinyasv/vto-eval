// Single VTO prompt shared by every model in the eval. Bump PROMPT_VERSION on any change
// so results from different prompts are never compared in the same report.
//
// Inputs are always sent in this order: [prompt text, image 1 = person, image 2 = garment].
// The only per-request variables are the garment category and its product title, which any
// store's product feed provides.

export const PROMPT_VERSION = "v1"

const PLACEMENT = {
  top: "It is a top. Replace only the person's current top with it. Keep their bottoms, shoes and accessories unchanged. If they wear an open jacket or blazer, keep it and put the new top underneath.",
  outerwear: "It is outerwear. Put it on over the person's current outfit, layered naturally on top of their existing top. Keep everything else unchanged.",
  dress: "It is a dress. Replace both the person's top and bottoms with it. Keep their shoes and accessories unchanged.",
  jumpsuit: "It is a jumpsuit. Replace both the person's top and bottoms with it. Keep their shoes and accessories unchanged.",
  bottom: "It is a bottom. Replace only the person's current pants, shorts or skirt with it. Keep their top, shoes and accessories unchanged.",
}

export function buildPrompt(garment) {
  return `Virtual try-on. Image 1 is a photo of a person. Image 2 is a product photo of a garment: "${garment.description}".

Edit Image 1 so the same person is wearing the garment from Image 2.

GARMENT: Reproduce the garment from Image 2 exactly: its color, pattern, print, text and logos, fabric texture, neckline, sleeves, length, silhouette and fit. Take only the garment from Image 2. Ignore any model, mannequin, hanger, background, props or other clothing in Image 2. If part of the garment is hidden in Image 2, complete it plausibly and consistently with what is visible.

PLACEMENT: ${PLACEMENT[garment.category]}

PRESERVE: Keep the person exactly as they are in Image 1: face, identity, expression, hair, skin tone, body shape and proportions, pose, and the position of their hands and arms. Keep the background, lighting, camera angle and framing of Image 1 unchanged. Do not crop, zoom or reposition the person.

REALISM: Fit the garment naturally to this person's body and pose, with realistic drape, folds and tension. Match the lighting and shadows of Image 1. Hair, hands, arms and held objects that sit in front of the garment must stay in front of it.

OUTPUT: One photorealistic image with the same composition as Image 1. No text, borders, watermarks, collages or side-by-side views.`
}
