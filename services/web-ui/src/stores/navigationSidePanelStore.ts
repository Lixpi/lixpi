import { atom } from 'nanostores'
import { persistentJSON } from '@nanostores/persistent'

export type NavigationSidePanelState = {
    isOpen: boolean
    width: number | null
}

const STORAGE_KEY = 'navigationSidePanel:state'

const defaultState: NavigationSidePanelState = {
    isOpen: true,
    // `null` means the user has not chosen a persisted width yet. The shared
    // SidePanel then falls back to `settings.navigationSidePanel.defaultDimensions`.
    width: null,
}

// Temporary bridge for the legacy account drawer still hosted in the root layout.
// It is deliberately not persisted: an open account drawer is an interaction
// state, not a user preference that should survive reloads or new tabs.
export const userInfoPanelStore = atom(false)

class NavigationSidePanelStore {
    // This is local UI chrome state, not API/domain state. `persistentJSON`
    // keeps the panel state in one browser storage key and leaves Nano Stores
    // responsible for JSON encoding, storage reads/writes, and tab sync.
    private readonly store = persistentJSON<NavigationSidePanelState>(STORAGE_KEY, { ...defaultState })

    // Keep the public store surface compatible with existing app stores while
    // the implementation stays a Nano Store. Consumers can subscribe to this, and
    // framework-agnostic TypeScript can call `getData()` synchronously.
    readonly subscribe = this.store.subscribe.bind(this.store)
    readonly listen = this.store.listen.bind(this.store)
    readonly get = this.store.get.bind(this.store)
    readonly set = this.store.set.bind(this.store)

    getData(): NavigationSidePanelState
    getData<Key extends keyof NavigationSidePanelState>(key: Key): NavigationSidePanelState[Key]
    getData<Key extends keyof NavigationSidePanelState>(key?: Key): NavigationSidePanelState | NavigationSidePanelState[Key] {
        const state = this.store.get()

        return key === undefined ? state : state[key]
    }

    setValues(values: Partial<NavigationSidePanelState> = {}): void {
        const current = this.store.get()
        // `persistentJSON` is atom-shaped: update by replacing the object.
        // Merge partial values here so callers do not need to know that detail.
        this.store.set({
            ...current,
            ...(typeof values.isOpen === 'boolean' ? { isOpen: values.isOpen } : {}),
            // Check property ownership instead of truthiness so callers can
            // explicitly clear the persisted width with `null`.
            ...(Object.hasOwn(values, 'width') ? { width: values.width ?? null } : {}),
        })
    }

    resetStore(): void {
        this.store.set({ ...defaultState })
    }
}

export const navigationSidePanelStore = new NavigationSidePanelStore()
