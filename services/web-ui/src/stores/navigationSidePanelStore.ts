import { createStore } from '@lixpi/web-client-service-factory'

export type NavigationSidePanelState = {
    isOpen: boolean
    width: number | null
    // Workspaces whose children the tree hides.
    collapsedWorkspaceIds: string[]
}

type NavigationSidePanelStoreMethods = {
    getData: {
        (): NavigationSidePanelState
        <Key extends keyof NavigationSidePanelState>(key: Key): NavigationSidePanelState[Key]
    }
    setValues: (values?: Partial<NavigationSidePanelState>) => void
}

const STORAGE_KEY = 'navigationSidePanel:state'

const defaultState: NavigationSidePanelState = {
    isOpen: true,
    width: null,
    collapsedWorkspaceIds: [],
}

export const navigationSidePanelStore = createStore({
    initialState: defaultState,
    createMethods: store => ({
        // A state persisted before a field existed lacks it, so reads fill
        // missing fields from the defaults.
        getData: ((key?: keyof NavigationSidePanelState) => {
            const state = {
                ...defaultState,
                ...store.get(),
            }

            return key === undefined ? state : state[key]
        }) as NavigationSidePanelStoreMethods['getData'],
        setValues: (values: Partial<NavigationSidePanelState> = {}): void =>
            void store.update(
                state => ({
                    ...state,
                    ...(typeof values.isOpen === 'boolean' ? { isOpen: values.isOpen } : {}),
                    ...(Object.hasOwn(values, 'width') ? { width: values.width ?? null } : {}),
                    ...(Array.isArray(values.collapsedWorkspaceIds) ? { collapsedWorkspaceIds: [...values.collapsedWorkspaceIds] } : {}),
                }),
            ),
    }),
    persistence: {
        key: STORAGE_KEY,
    },
})
