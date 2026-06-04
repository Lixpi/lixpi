# Markdown Rendering Coding Style Guide

This guide applies to any code that displays markdown in the web UI.

**Rule:** all markdown rendering MUST go through `@lixpi/markdown-stream-parser`. Editable ProseMirror content uses the `aiChatThreadPlugin` (`StreamingInserter`); every other (non-editable) surface MUST use the unified `MarkdownStreamRenderer` (`services/web-ui/src/utils/markdownStreamRenderer.ts`). Never hand-roll markdown→HTML, render raw markdown as plain text, add another markdown library, or fork the segment→DOM mapping.

The authoritative reference — architecture, the two render paths, the parser contract, usage examples, styles, and the full do/don't list — lives in [documentation/conventions/MARKDOWN-RENDERING.md](../conventions/MARKDOWN-RENDERING.md). Read it before adding or changing any markdown rendering.
