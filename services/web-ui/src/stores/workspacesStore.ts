'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    type WorkspaceMeta,
} from '@lixpi/constants'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '../helpers/deepfreeze.ts'

type Meta = {
    loadingStatus: LoadingStatus
}

type WorkspacesStore = {
    meta: Meta
    data: WorkspaceMeta[]
}

const workspaces: ReadonlyDeep<WorkspacesStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
    },
    data: [],
})

const store = writable({...workspaces})

export const workspacesStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(state => {
            returnValue = key ? state.meta[key] : state.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (): WorkspaceMeta[] => {
        let returnValue: WorkspaceMeta[] = []
        const unsubscribe = store.subscribe(state => {
            returnValue = state.data
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

    addWorkspaces: (workspaces: WorkspaceMeta[] = []): void => store.update(state => ({
        ...state,
        data: [
            ...workspaces,
            ...state.data,
        ],
    })),

    setWorkspaces: (workspaces: WorkspaceMeta[] = []): void => store.update(state => ({
        ...state,
        data: [...workspaces],
    })),

    deleteWorkspace: (workspaceId: string): void => store.update(state => ({
        ...state,
        data: state.data.filter((workspace: WorkspaceMeta) => workspace.workspaceId !== workspaceId),
    })),

    updateWorkspace: (workspaceId: string, newValues: Partial<WorkspaceMeta>): void => store.update(state => {
        const workspaceIndex = state.data.findIndex((workspace: WorkspaceMeta) => workspace.workspaceId === workspaceId)
        if (workspaceIndex !== -1) {
            state.data[workspaceIndex] = { ...state.data[workspaceIndex], ...newValues }
        }
        return { ...state }
    }),

    resetStore: (): void => store.set({...workspaces}),
}
