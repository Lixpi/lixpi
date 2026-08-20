# CanvasNodeFooter

Framework-agnostic below-node controls for canvas nodes that expose details or generation history. The footer always renders one info control, renders the shared progress ripple only while generation is active, and appends caller-provided attribution or review sections after those entry controls.

Both the info control and active progress control call the same `onOpenDetails` callback. The host owns node state, sidebar state, model attribution, and review behavior; it updates the footer through `update()` and disposes it through `destroy()`.

```typescript
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'

const footer = createCanvasNodeFooter({
    infoLabel: 'Media details and generation history',
    progressActive: true,
    selected: false,
    sections: [{ elements: [modelBadge], separated: true }],
    onOpenDetails: openDetails,
})
```

Import `@lixpi/ui-kit/styles/canvas-node-footer` once in each rendering surface that uses the component.
