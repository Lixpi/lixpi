# Context Selector Component

Reusable D3-managed sliding option control extracted from the retired ProseMirror context selector. It renders only the single-selection control; it does not render document/thread diagrams or own application state. D3 applies state and ARIA updates while CSS animates the percentage-based slider position so browser layout resolves the movement correctly.

## API

```typescript
import { createContextSelector } from '$src/components/contextSelector/index.ts'

const selector = createContextSelector({
    id: 'chat-context-mode',
    options: [
        { label: 'Follow Selection', value: 'followSelection' },
        { label: 'Pinned Context', value: 'pinnedContext' },
    ],
    selectedValue: 'followSelection',
    onChange: (value) => {
        // Persist the selected mode in the owning feature.
    },
})

container.appendChild(selector.dom)
selector.setValue('pinnedContext')
selector.destroy()
```

The component owns the sliding indicator animation, radio semantics, and keyboard cycling. Consumers own persistence and the meaning of each option.
