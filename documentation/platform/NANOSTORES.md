---
title: Nano Stores
description: How Lixpi uses Nano Stores for small frontend state, when to use persistent stores, and how to expose store APIs consistently.
---

# Nano Stores

Nano Stores is a small framework-agnostic state manager. In Lixpi, use it for browser-side UI state shared between UI modules, stores, and plain TypeScript code without coupling consumers to a rendering framework.

Use it for small, focused frontend state:

- Panel open/closed state.
- User interface preferences.
- Local UI dimensions that need to survive reloads.
- State consumed by both UI components and plain TypeScript code.

Do not use it for API-owned workflow state, workspace data, generated-media lineage, billing, authorization, or anything that must stay correct across clients and service restarts. Those decisions belong in API contracts, persisted workspace state, DynamoDB, NATS events, or shared backend packages.

## Package Shape

Use `nanostores` for in-memory stores:

```typescript
import { atom, map } from 'nanostores'
```

Use `@nanostores/persistent` for browser-persisted stores:

```typescript
import { persistentJSON } from '@nanostores/persistent'
```

Add dependencies directly to the package manifest. Do not install packages on the host.

## In-Memory Stores

Use an in-memory store when state should reset on reload and does not need browser storage.

Use `atom` for one value:

```typescript
import { atom } from 'nanostores'

export const accountDrawerStore = atom(false)
```

Use `map` for object state where callers update individual keys:

```typescript
import { map } from 'nanostores'

type PanelState = {
    isOpen: boolean
    width: number | null
}

export const panelStore = map<PanelState>({
    isOpen: true,
    width: null,
})

panelStore.setKey('width', 320)
```

## Persistent Stores

Use a persistent store when the browser should restore state after reload. Persistent stores read from browser storage, write updates back to it, and synchronize changes across tabs.

Use `persistentJSON` when the whole object should live under one storage key:

```typescript
import { persistentJSON } from '@nanostores/persistent'

type PanelState = {
    isOpen: boolean
    width: number | null
}

const panelStore = persistentJSON<PanelState>('navigationSidePanel:state', {
    isOpen: true,
    width: null,
})

panelStore.set({
    ...panelStore.get(),
    width: 320,
})
```

Use this shape for small UI preferences where the object should move together as one persisted value.

Use `persistentMap` when each key should be stored separately and updated through `setKey`:

```typescript
import { persistentMap } from '@nanostores/persistent'

type SettingsState = {
    reduceMotion: boolean
    theme: 'dark' | 'light' | 'system'
}

const settingsStore = persistentMap<SettingsState>('settings:', {
    reduceMotion: false,
    theme: 'system',
})

settingsStore.setKey('theme', 'dark')
```

Use this shape when individual keys are independent settings and may be added over time.

## App Store Wrappers

Existing web-ui stores expose helper methods such as `getData()` and `setValues()`. A Nano Store can still sit behind that public surface when a framework-agnostic TypeScript component needs the same style:

```typescript
class PanelStore {
    private readonly store = persistentJSON<PanelState>('panel:state', {
        isOpen: true,
        width: null,
    })

    readonly subscribe = this.store.subscribe.bind(this.store)
    readonly get = this.store.get.bind(this.store)
    readonly set = this.store.set.bind(this.store)

    getData(): PanelState {
        return this.store.get()
    }

    setValues(values: Partial<PanelState> = {}): void {
        this.store.set({
            ...this.store.get(),
            ...values,
        })
    }
}
```

Keep wrappers thin. The Nano Store should still own subscription and update semantics. Do not manually reimplement browser storage if `@nanostores/persistent` already provides the behavior.

## Choosing The Store

| Need | Store |
|------|-------|
| One reload-reset value | `atom` |
| Reload-reset object with key updates | `map` |
| One persisted JSON value | `persistentJSON` |
| Persisted object with independent storage keys | `persistentMap` |

## Reading And Subscribing

TypeScript modules should call `store.get()` or a local wrapper such as `getData()` for synchronous reads. Use `listen()` or `subscribe()` for lifecycle-bound reactions and clean up the unsubscribe function when the component is destroyed.

## Guidelines

- Keep store state small and focused.
- Prefer `persistentJSON` or `persistentMap` over hand-written `localStorage` parsing.
- Use `setKey` for `map` and `persistentMap`.
- Use object replacement for `atom` and `persistentJSON`.
- Keep API-owned and multi-client correctness decisions out of browser-only stores.
- Avoid hidden duplicated state: a component should read from one store or receive one external value from its host.
