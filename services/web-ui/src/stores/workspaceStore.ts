'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    type Workspace,
    type CanvasState,
} from '@lixpi/constants'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '$src/helpers/deepfreeze.ts'

type Meta = {
    loadingStatus: LoadingStatus
    isInEdit: boolean
    requiresSave: boolean
}

type WorkspaceData = Omit<Workspace, 'accessList'> & {
    error?: unknown
}

type WorkspaceStore = {
    meta: Meta
    data: WorkspaceData
}

function createDefaultCanvasState(): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
    }
}

const workspace: ReadonlyDeep<WorkspaceStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
        isInEdit: false,
        requiresSave: false,
    },
    data: {
        workspaceId: '',
        name: '',
        accessType: 'private',
        canvasState: createDefaultCanvasState(),
        createdAt: 0,
        canvasStateUpdatedAt: 0,
        updatedAt: 0,
    }
})

const store = writable({...workspace})

export const workspaceStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(state => {
            returnValue = key ? state.meta[key] : state.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (key: keyof WorkspaceData | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(state => {
            returnValue = key ? state.data[key] : state.data
        })
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): void => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            ...values
        }
    })),

    setDataValues: (values: Partial<WorkspaceData> = {}): void => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    beginWorkspaceLoad: (workspaceId: string): void => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            loadingStatus: LoadingStatus.loading,
            requiresSave: false,
        },
        data: {
            ...state.data,
            workspaceId,
            name: '',
            error: null,
            canvasState: createDefaultCanvasState(),
            createdAt: 0,
            canvasStateUpdatedAt: 0,
            updatedAt: 0,
        },
    })),

    updateCanvasState: (canvasState: CanvasState): void => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            requiresSave: true
        },
        data: {
            ...state.data,
            canvasState
        }
    })),

    resetStore: (): void => store.set({...workspace}),
}
