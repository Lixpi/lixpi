# CanvasNodeFooter

Framework-agnostic below-node controls for canvas nodes that expose details or generation history. The footer always renders one info control, renders the shared progress ripple only while generation is active, and appends caller-provided attribution or review sections after those entry controls.

Both the info control and active progress control call the same `onOpenDetails` callback. The host owns node state, sidebar state, model attribution, and review behavior; it updates the footer through `update()` and disposes it through `destroy()`.

The icon-only controls use ARIA labels and opt into the shared help-tooltip provider. They never create native `title` tooltips or feature-local hover labels.

```typescript
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'

const footer = createCanvasNodeFooter({
    icons: { info: infoMarkup, progress: rippleArtwork },
    infoLabel: 'Media details and generation history',
    progressActive: true,
    selected: false,
    sections: [{ elements: [modelBadge], separated: true }],
    onOpenDetails: openDetails,
})
```

Import `@lixpi/ui-kit/styles/canvas-node-footer` and `@lixpi/ui-kit/styles/progress-ripple` once in each rendering surface. Icon markup and the three ripple paths come from the caller's artwork catalog. The component does not import an icon package.
