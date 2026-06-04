---
title: Markdown Rendering
description: The one-parser rule for runtime markdown in the web UI — every piece of markdown is tokenized by @lixpi/markdown-stream-parser, and exactly two renderers (the editable ProseMirror StreamingInserter and the non-editable MarkdownStreamRenderer) turn segments into UI. Covers the parser contract, usage, global styles, the forbidden list, and current consumers.
---

# Markdown Rendering

Markdown shows up in many places in the web UI — AI chat responses, the feature-extraction tab (prompt previews and streamed model output), the Media Library (saved feature instructions), and any future surface that displays model text. To keep all of it consistent and to avoid scattering markdown parsers across the codebase, Lixpi has **one rule**: every piece of markdown is tokenized by the same parser, and there are exactly two renderers that turn those tokens into UI.

{% callout type="note" %}
This convention governs **runtime markdown in the web UI** (model output, feature instructions, and similar surfaces). It is distinct from the documentation site's own **build-time Markdoc renderer** in [`documentation/site/`](../site/README.md), which turns these `.md` docs into static HTML. The two do not share code or this rule.
{% /callout %}

## The rule

**All markdown rendering MUST go through [`@lixpi/markdown-stream-parser`](https://github.com/Lixpi/markdown-stream-parser).** The parser is the single source of truth for how markdown is tokenized into segments; a renderer's only job is to apply styles to those segments. Never hand-roll markdown→HTML, never render raw markdown as plain text, never add a second markdown library (`marked`, `markdown-it`, `remark`, …), and never fork the segment→DOM mapping into a new file.

There are exactly two renderers, chosen by whether the surface is editable:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
graph TB
    subgraph "Source"
        MD[Markdown text<br/>stream or full string]
    end

    subgraph "Parser — single source of truth"
        Parser["@lixpi/markdown-stream-parser<br/>MarkdownStreamParser"]
        Seg[Parsed segments<br/>type + styles + level]
    end

    subgraph "Renderers"
        PM[ProseMirror plugin<br/>StreamingInserter<br/>EDITABLE]
        Unified[MarkdownStreamRenderer<br/>utils/markdownStreamRenderer.ts<br/>NON-EDITABLE]
    end

    subgraph "Surfaces"
        Chat[AI chat threads]
        Ext[Extraction tab<br/>prompt preview + model output]
        Lib[Media Library<br/>feature instructions]
    end

    MD --> Parser
    Parser --> Seg
    Seg --> PM
    Seg --> Unified
    PM --> Chat
    Unified --> Ext
    Unified --> Lib
```

| Surface | Renderer | Source |
|---------|----------|--------|
| **Editable** ProseMirror content (AI chat threads) | The ProseMirror plugin's `StreamingInserter` | [`aiChatThreadPlugin.ts`](../../services/web-ui/src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts) |
| **Non-editable** content (everything else) | The unified `MarkdownStreamRenderer` | [`markdownStreamRenderer.ts`](../../services/web-ui/src/utils/markdownStreamRenderer.ts) |

Both consume the same parser and the same segment shape. If a new surface needs markdown, reuse one of these two — extend them if needed, never fork them.

## The parser contract

`MarkdownStreamParser` is a streaming, instance-per-stream singleton. Each emitted segment has the shape:

```typescript
{
    status: 'STREAMING' | 'END_STREAM'
    segment: {
        segment: string          // the text content
        styles: string[]         // inline styles on this run
        type: string             // block type
        level?: number           // heading level (1–6) when type === 'header'
        isBlockDefining: boolean  // true when a new block starts
        isProcessingNewLine: boolean
    }
}
```

- **Block types:** `paragraph`, `header` (with `level` 1–6), `code` (fenced code block).
- **Inline styles:** `bold`, `italic`, `strikethrough`, `code`.

Instance lifecycle: `MarkdownStreamParser.getInstance(id)` → `subscribeToTokenParse(cb)` → `startParsing()` → `parseToken(chunk)` per chunk → `stopParsing()` (flushes the last block and emits `END_STREAM`) → `removeInstance(id)`.

The segment/token TypeScript shapes (`MarkdownParsedSegment`, `MarkdownStreamToken`) currently live in [`@lixpi/constants`](../../packages/lixpi/constants/ts/types.ts) because the published parser version defines its segment internally but does not export it (`subscribeToTokenParse` is typed `any`).

{% callout type="note" %}
A newer version of `@lixpi/markdown-stream-parser` is in development that **exports proper segment types**. Once it is released, drop the `@lixpi/constants` copies and import the types directly from the package.
{% /callout %}

## Non-editable rendering: `MarkdownStreamRenderer`

[`src/utils/markdownStreamRenderer.ts`](../../services/web-ui/src/utils/markdownStreamRenderer.ts) is the **only** approved way to render markdown outside ProseMirror. It owns its `contentEl`, drives the parser, and applies styles to each segment as plain DOM (built with the `html` helper from `domTemplates.ts`).

**Streaming** (tokens arrive over time — e.g. live model output). Because the renderer owns `contentEl`, it survives container re-renders; re-attach `contentEl` after a rebuild instead of recreating it:

```typescript
import { MarkdownStreamRenderer } from '$src/utils/markdownStreamRenderer.ts'

const renderer = new MarkdownStreamRenderer(`${runId}:${stage}`, 'my-scroll-box lixpi-markdown')
container.appendChild(renderer.contentEl)
// for each streamed chunk:
renderer.push(chunk)
// when the stream ends:
renderer.finalize()
```

**Static** (the full string is already available — e.g. a saved feature's instructions, a prompt preview):

```typescript
import { renderMarkdownStatic } from '$src/utils/markdownStreamRenderer.ts'

mountEl.appendChild(renderMarkdownStatic(feature.instructions, `feature:${feature.featureId}`, 'feature-library-instructions-body lixpi-markdown'))
```

- The `instanceId` must be unique per concurrent render (the parser is a singleton keyed by id).
- The optional `className` is applied to the content element; always include `lixpi-markdown` so the global styles apply, plus any surface-specific scroll/layout class.

## Styles

Markdown element styles are **global** and live in [`src/sass/_markdown.scss`](../../services/web-ui/src/sass/_markdown.scss) under `.lixpi-markdown` / `.lixpi-md-*` (imported by `src/sass/styles.scss`). They are global on purpose so the renderer looks the same on every surface. Do not redefine markdown element styles in a component stylesheet — only add surface-specific container styles (scroll box, max-height, background) on your own class alongside `lixpi-markdown`.

## Forbidden

- `element.innerHTML = someMarkdown`, or any string-built markdown HTML.
- Rendering markdown source as text (`<pre>${markdown}</pre>`, `${feature.instructions}` straight into the DOM).
- Importing a markdown library other than `@lixpi/markdown-stream-parser`.
- Copying the segment→DOM mapping into a new file instead of using `MarkdownStreamRenderer`.

## Current consumers

| Consumer | What it renders | How |
|----------|-----------------|-----|
| AI chat thread | Streamed assistant responses | `aiChatThreadPlugin` (editable / ProseMirror) |
| Feature-extraction tab | Stage prompt previews, streamed model output | `MarkdownStreamRenderer` / `renderMarkdownStatic` |
| Media Library | Saved feature instructions ("Application notes") | `renderMarkdownStatic` |

See also: [Feature Extraction — Overview](../library/FEATURE-EXTRACTION-OVERVIEW.md), [Using Features](../library/USING-FEATURES.md), and [Media Library](../library/MEDIA-LIBRARY.md).
