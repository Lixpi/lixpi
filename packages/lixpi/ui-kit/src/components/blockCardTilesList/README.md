# Block Card Tiles List

`BlockCardTilesList` renders a compact, scrollable collection of selectable block card tiles. Each tile owns a circular marker, a truncated title, two metadata lines, selection styling, and an optional icon action.

Default tile paints, borders and typography come from the complete TypeScript theme roles in `components.blockCards`; local custom properties such as `--block-card-tile-hover-background-image` and `--block-card-tile-marker-background` remain supported overrides.

The component is framework-agnostic and does not assign domain meaning to cards or actions.

```typescript
import { createBlockCardTilesList } from '@lixpi/ui-kit/components/block-card-tiles-list'

const list = createBlockCardTilesList({
    title: 'Items',
    items: [{
        id: 'item-1',
        title: 'First item',
        primaryMeta: 'Updated today',
        secondaryMeta: 'Ready',
    }],
})
```

```scss
@use '@lixpi/ui-kit/styles/block-card-tiles-list';
```
