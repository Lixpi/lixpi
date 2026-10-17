# Error placeholders

`createErrorPlaceholder` renders an accessible error message and retry button for asynchronous content. It accepts an optional document, light/dark theme, overlay, message, retry label and callback. The instance owns its DOM and retry listener; call `destroy()` when removing the surface.

```typescript
import { createErrorPlaceholder } from '@lixpi/ui-kit/components/loading-placeholder'
import '@lixpi/ui-kit/styles/loading-placeholder'

const error = createErrorPlaceholder({
    message: 'Failed to load document',
    retryLabel: 'Try again',
    onRetry: reloadDocument,
})
container.append(error.dom)
```

Instances expose `dom`, `show()`, `hide()`, `setMessage(message)` and `destroy()`. Messages use text content. The stylesheet owns overlay and error presentation, without a CSS spinner or rotation animation.

Application loading uses Canvas Components' `LoadingLayer`, which shares one traveling-outline renderer across independent loading leases. UI-kit error placeholders have no canvas dependency.
