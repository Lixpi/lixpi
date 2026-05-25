# Markdown Rendering Coding Style Guide

This guide applies to any code that displays markdown anywhere in the web UI.

## The Rule

**All markdown rendering MUST go through `@lixpi/markdown-stream-parser`.** Never hand-roll markdown→HTML, never render raw markdown as plain text, and never add a second markdown library (`marked`, `markdown-it`, `remark`, etc.). The parser is the single source of truth for how markdown is tokenized into segments; rendering is the application of styles to those segments.

There are exactly two rendering paths, and you must use the one that matches the surface:

| Surface | Renderer | Where |
|---------|----------|-------|
| **Editable** ProseMirror content (AI chat threads) | The ProseMirror plugin's `StreamingInserter` | [`aiChatThreadPlugin.ts`](../../services/web-ui/src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts) |
| **Non-editable** content (everything else) | The unified `MarkdownStreamRenderer` | [`markdownStreamRenderer.ts`](../../services/web-ui/src/utils/markdownStreamRenderer.ts) |

Both consume the same parser and the same segment shape. Do not write a third segment→DOM mapping. If a new surface needs markdown, reuse one of these two — extend them if needed, never fork them.

## Non-editable rendering: `MarkdownStreamRenderer`

`src/utils/markdownStreamRenderer.ts` is the **only** approved way to render markdown outside ProseMirror. It feeds tokens to the parser and applies styles to the emitted segments as plain DOM (built with the `html` helper from `domTemplates.ts`).

**Streaming** (tokens arrive over time — e.g. live model output). The renderer owns its `contentEl`, so it survives container re-renders; re-attach `contentEl` after a rebuild instead of recreating it:

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

The `instanceId` must be unique per concurrent render (the parser is a singleton keyed by id). The optional `className` is applied to the content element; always include `lixpi-markdown` so the global styles apply, plus any surface-specific scroll/layout class.

## Styles

Markdown element styles are **global** and live in [`src/sass/_markdown.scss`](../../services/web-ui/src/sass/_markdown.scss) under `.lixpi-markdown` / `.lixpi-md-*`. They are global on purpose so the renderer is styled consistently on every surface. Do not redefine markdown element styles in a component stylesheet — only add surface-specific container styles (scroll box, max-height, background) on your own class alongside `lixpi-markdown`.

## Forbidden

- `element.innerHTML = someMarkdown` or any string-built markdown HTML.
- Rendering markdown source as text (`<pre>${markdown}</pre>`, `${feature.instructions}` straight into the DOM).
- Importing a markdown library other than `@lixpi/markdown-stream-parser`.
- Copying the segment→DOM mapping into a new file instead of using `MarkdownStreamRenderer`.
