# Why Different Model Combinations Produce Different Styles

Lixpi lets users pair any text model with any image model independently. Claude can write prompts for gpt-image-1, GPT-5 can drive Nano Banana, Gemini can steer Stable Diffusion. Each combination produces a **visually distinct aesthetic** — not randomly, but because of concrete architectural and data differences at every layer of the pipeline.

This document explains the technical reasons why, with references to source materials.

---

## The Four Factors

Four independent factors compound to produce a unique visual signature for each text+image model pairing:

1. **Model architecture** — the neural network structure that does the actual denoising
2. **Training data** — what images the model learned from and how they were filtered
3. **Text encoding** — how the prompt gets converted into vectors before generation
4. **Text model prompt style** — how the LLM writes the image prompt in the first place

Each factor independently shifts the output. Combined, they create a combinatorial space of distinct aesthetics.

---

## 1. Model Architecture

Image generation models use fundamentally different neural network architectures. The architecture determines how the model transforms random noise into a coherent image — affecting texture handling, composition, fine detail rendering, and the overall "character" of the output.

### Diffusion Models (Most Modern Image Generators)

Most modern image generators are **latent diffusion models (LDMs)**. They work by:

1. Compressing the image into a smaller **latent space** via a Variational Autoencoder (VAE)
2. Iteratively adding noise in a forward process (training)
3. Learning to reverse that noise in a backward process (generation)
4. Decoding the denoised latent back to pixel space

> "The VAE encoder compresses the image from pixel space to a smaller dimensional latent space, capturing a more fundamental semantic meaning of the image. Gaussian noise is iteratively applied to the compressed latent representation during forward diffusion. The U-Net block, composed of a ResNet backbone, denoises the output from forward diffusion backwards to obtain a latent representation. Finally, the VAE decoder generates the final image by converting the representation back into pixel space."
>
> — [Wikipedia: Latent Diffusion Model](https://en.wikipedia.org/wiki/Latent_diffusion_model)

The critical difference between models is the **backbone** — the neural network that does the denoising:

### U-Net Backbone (Stable Diffusion 1.x–2.x)

Stable Diffusion 1.x uses a **U-Net** (860M parameters) — a convolutional architecture with downscaling layers followed by upscaling layers, connected by skip connections. Text conditioning enters through **cross-attention** layers where:

- The latent image array serves as the **query** sequence (one query vector per pixel)
- The text encoding serves as the **key** and **value** sequences

> "In the cross-attentional blocks, the latent array itself serves as the query sequence, one query-vector per pixel. [...] The embedding vector sequence serves as both the key sequence and as the value sequence."
>
> — [Wikipedia: Latent Diffusion Model](https://en.wikipedia.org/wiki/Latent_diffusion_model)

SDXL scaled this to **3.5B parameters**.

### Rectified Flow Transformer / MMDiT (Stable Diffusion 3.0+)

Stable Diffusion 3.0 abandoned the U-Net entirely for a **Rectified Flow Transformer (MMDiT)** — a transformer-based architecture that processes image patches as tokens, similar to Vision Transformers. This is a fundamentally different computation graph with different attention patterns, different scaling behavior, and different learned representations.

> Source: [Wikipedia: Stable Diffusion](https://en.wikipedia.org/wiki/Stable_Diffusion)

### Autoregressive Transformer (DALL-E 1)

DALL-E 1 was not a diffusion model at all. It was an **autoregressive Transformer** that generated image tokens sequentially (left-to-right, top-to-bottom), conditioned on text tokens encoded by CLIP. This produces fundamentally different outputs because the generation process is sequential rather than iterative denoising.

> Source: [Wikipedia: DALL-E](https://en.wikipedia.org/wiki/DALL-E)

### Diffusion on CLIP Embeddings (DALL-E 2)

DALL-E 2 (3.5B parameters) switched to a **diffusion model conditioned on CLIP embeddings** — a two-stage process where a "prior" model generates a CLIP image embedding from text, then an "unCLIP" decoder generates the image from that embedding. This shared CLIP embedding space gives DALL-E 2 its characteristic style.

> Source: [Wikipedia: DALL-E](https://en.wikipedia.org/wiki/DALL-E)

### Why Architecture Matters

The architecture determines what the model can learn and how it represents visual concepts internally. A U-Net with convolutional layers has an inherent locality bias (nearby pixels influence each other more). A Transformer treats all patches equally through self-attention, learning longer-range spatial relationships. An autoregressive model generates tokens in a fixed order, creating sequential dependencies. These structural priors produce visibly different outputs even when trained on identical data.

---

## 2. Training Data

Each model learned from a different dataset with different curation, filtering, and aesthetic biases. A model can only generate what it has learned to see — the training data distribution directly determines the model's default aesthetic.

### Stable Diffusion: LAION-5B with Aesthetic Filtering

Stable Diffusion was trained on **LAION-5B** — 5 billion image-text pairs scraped from the web via Common Crawl. This was then filtered using an **aesthetic score predictor** to create **LAION-Aesthetics v2 5+** — approximately **600 million images** that scored ≥5 out of 10 on the aesthetic predictor.

> "SD 1.1 was a LDM trained on the laion2B-en dataset. SD 1.1 was finetuned to 1.2 on more aesthetic images."
>
> — [Wikipedia: Latent Diffusion Model](https://en.wikipedia.org/wiki/Latent_diffusion_model)

The top 100 source domains account for roughly **47% of the training data**. The biggest contributor is **Pinterest at 8.5%**, followed by WordPress, Flickr, DeviantArt, and similar platforms. This mix of sources — heavily weighted toward Pinterest's curated aesthetic and DeviantArt's digital art style — directly shapes Stable Diffusion's default output character.

> Source: [Wikipedia: Stable Diffusion](https://en.wikipedia.org/wiki/Stable_Diffusion)

### DALL-E / GPT Image: Proprietary Curated Data

OpenAI's image models are trained on **proprietary datasets** that are not publicly disclosed. The curation methodology — what was included, what was filtered out, what balance was struck between photography, illustration, 3D renders, paintings, etc. — directly determines the model's learned distribution and default aesthetic.

> Source: [Wikipedia: DALL-E](https://en.wikipedia.org/wiki/DALL-E)

### Midjourney: Proprietary Data + Niji as Proof

Midjourney uses **proprietary training data and architecture** — neither are publicly disclosed. However, Midjourney provides the strongest proof that training data determines style through its **Niji model** — a variant specifically **fine-tuned on anime and illustration data**. Same base architecture, different training data, completely different aesthetic output.

Midjourney also has a "Style Reference" feature and a documented "aesthetics system," confirming that the company treats visual style as a direct consequence of data curation.

> Source: [Wikipedia: Midjourney](https://en.wikipedia.org/wiki/Midjourney)

### The Aesthetic Filtering Effect

The choice of aesthetic filtering during training has outsized impact. Stable Diffusion's aesthetic predictor was itself trained on human aesthetic judgments — meaning the model inherits the biases of those judgments. Images that scored below 5/10 were excluded entirely, creating a model that defaults toward a specific notion of "aesthetically pleasing" that may not match all artistic intentions.

The Playground v2.5 paper found that the **noise schedule** — the mathematical function controlling how noise is added and removed during training — also has a profound impact on the resulting aesthetic:

> "We focus on three key insights: the noise schedule profoundly impacts realism and visual fidelity."
>
> — [Playground v2.5: Three Insights towards Enhancing Aesthetic Quality in Text-to-Image Generation (arXiv:2402.17245)](https://arxiv.org/abs/2402.17245)

---

## 3. Text Encoding

Before the image model generates anything, the text prompt must be converted into numerical vectors (embeddings) that the model can condition on. Different models use different text encoders, which represent the same words in fundamentally different vector spaces.

### CLIP Text Encoder (Stable Diffusion 1–2, DALL-E 2)

Stable Diffusion 1.x–2.x uses a pretrained **CLIP ViT-L/14** text encoder — a model trained contrastively on image-text pairs to align visual and textual representations in a shared embedding space.

> "For conditioning on text, the fixed, a pretrained CLIP ViT-L/14 text encoder is used to transform text prompts to an embedding space."
>
> — [Wikipedia: Latent Diffusion Model](https://en.wikipedia.org/wiki/Latent_diffusion_model)

CLIP was trained on 400 million image-text pairs to predict which caption goes with which image. Its text representations are optimized for **visual-semantic alignment** — it encodes text in terms of what things look like, not what they mean linguistically.

### T5 Text Encoder (Stable Diffusion 3, Google Imagen)

Stable Diffusion 3 and Google's Imagen use **T5** — a large language model trained on text-only corpora. T5 represents words in terms of **linguistic meaning and relationships**, not visual appearance.

Google Brain's Imagen paper demonstrated that using a frozen large language model as the text encoder produced better results than CLIP, representing a fundamental shift in how text conditions image generation:

> Google Brain reported "positive results from using a large language model trained separately on a text-only corpus (with its weights subsequently frozen), a departure from the theretofore standard approach."
>
> — [Wikipedia: Text-to-image model](https://en.wikipedia.org/wiki/Text-to-image_model)

### Why This Matters

The same prompt — "a sunset over mountains" — gets mapped to different vectors by CLIP and T5. CLIP encodes it in terms of visual similarity to images of sunsets and mountains it saw during training. T5 encodes it in terms of the linguistic relationships between "sunset," "over," and "mountains." These different vector representations steer the diffusion process through different regions of the model's learned latent space, activating different learned patterns and producing different visual results.

The text encoder is not a neutral pipe — it is an active filter that determines what aspects of the prompt the image model pays attention to.

---

## 4. Text Model Prompt Style (The Compounding Effect)

In Lixpi's model chaining architecture, the text model (Claude, GPT-5, Gemini) writes the image prompt via a `generate_image` tool call. Different text models write prompts differently:

- **Different vocabulary** — Claude may say "ethereal dawn light filtering through mist" where GPT-5 says "soft golden sunrise with atmospheric fog"
- **Different compositional emphasis** — one model may lead with subject matter, another with mood and atmosphere
- **Different structural choices** — some models write terse, keyword-dense prompts; others write flowing descriptive sentences
- **Different reasoning about the user's intent** — each model interprets the conversation context and reference images through its own learned biases

These differences in how the prompt is written compound with all the factors above. The text model determines *what words* reach the text encoder, which determines *what vectors* condition the diffusion process, which activates *different regions* of the model's learned distribution (shaped by its unique architecture and training data).

This compounding is why "Claude + gpt-image-1" produces a genuinely different aesthetic than "GPT-5 + Nano Banana" — every component in the chain introduces its own biases, and they multiply rather than cancel out.

---

## Practical Implications for Lixpi

Model pairing is a **creative tool**, not just a technical configuration. Users can explore a combinatorial space of visual styles by mixing different text and image models. The ImageRouter normalizes the interface between them (converting everything into a standard multimodal format), so any text model can drive any image model regardless of provider.

This is architecturally intentional — the text model and image model selections are independent precisely because different combinations produce meaningfully different results.

---

## Source Materials

| Source | URL | Key Content |
|--------|-----|-------------|
| Wikipedia: Diffusion Model | https://en.wikipedia.org/wiki/Diffusion_model | DDPM, score-based models, classifier-free guidance, architecture choices (U-Net vs DiT) |
| Wikipedia: Latent Diffusion Model | https://en.wikipedia.org/wiki/Latent_diffusion_model | VAE + U-Net architecture, cross-attention conditioning, CLIP text encoder, training on LAION |
| Wikipedia: Text-to-image Model | https://en.wikipedia.org/wiki/Text-to-image_model | Architecture taxonomy (GAN → diffusion), dataset overview (COCO, LAION-5B), T5 vs CLIP, Imagen findings |
| Wikipedia: DALL-E | https://en.wikipedia.org/wiki/DALL-E | DALL-E 1 (autoregressive), DALL-E 2 (diffusion + CLIP), DALL-E 3 (improved prompt following) |
| Wikipedia: Stable Diffusion | https://en.wikipedia.org/wiki/Stable_Diffusion | LAION-5B training data, aesthetic filtering, source domain breakdown, U-Net → MMDiT migration |
| Wikipedia: Midjourney | https://en.wikipedia.org/wiki/Midjourney | Proprietary architecture, Niji anime model, Style Reference feature, TPU training |
| Playground v2.5 (arXiv:2402.17245) | https://arxiv.org/abs/2402.17245 | Noise schedule impact on realism/fidelity, aesthetic quality alignment, aspect ratio training |

---

## For Future Agents

When working on model chaining, image generation, or model selection features, keep in mind:

1. **Model pairing is not cosmetic** — the style differences are grounded in real architectural and data differences, not random variation.
2. **The text encoder is not neutral** — CLIP and T5 encode the same prompt differently. Changing the text encoder changes the output even with identical prompts and identical diffusion backbones.
3. **Training data is the strongest style lever** — Midjourney's Niji model proves this definitively. Architecture matters, but data composition is the dominant factor in aesthetic character.
4. **The text model's prompt-writing style compounds everything** — different LLMs emphasize different aspects of a scene, use different vocabulary, and structure prompts differently. This is not a minor effect.
5. **The ImageRouter enables this** — by normalizing the interface between text and image models into a standard multimodal format, any combination becomes possible regardless of provider boundaries.
