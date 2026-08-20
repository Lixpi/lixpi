# Block Card Tiles List

`BlockCardTilesList` renders a compact, scrollable collection of selectable block card tiles. Each tile owns a circular marker, a truncated title, two metadata lines, selection styling, and an optional icon action.

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
