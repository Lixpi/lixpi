# MediaModelBadge

Shared provider-and-model attribution used beneath generated media and in execution traces. The component renders one compact line containing the provider icon, provider display name, configured separator, and model display name.

The component accepts already-resolved presentation metadata. Provider/model catalog lookup and application settings remain the consuming application's responsibility, so the UI kit never imports service code.

Every provider SVG renders inside the same configured square icon slot. Optical scale corrections for unusually dense or sparse provider glyphs belong to this component's stylesheet, so all consumers receive identical icon sizing and spacing without local overrides.

```typescript
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'

const badge = createMediaModelBadge({
    providerTitle: 'Google',
    modelTitle: 'Nano Banana Pro',
    icon: googleIcon,
    separator: ' : ',
})
```

Import `@lixpi/ui-kit/styles/media-model-badge` once in each rendering surface that uses the badge.
