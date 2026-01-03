'use strict'

import { writable } from 'svelte/store'

import {
    LoadingStatus,
    PaymentProcessingStatus
} from '@lixpi/constants'

import type { ReadonlyDeep } from 'type-fest'
import { deepFreeze } from '$src/helpers/deepfreeze.ts'

// Define types for meta and data
type Meta = {
    loadingStatus: LoadingStatus
    paymentProcessingStatus: PaymentProcessingStatus
    isPaymentDialogOpen: boolean
}

type Subscription = {
    paymentMethodSetupIntentSecret: string
    paymentMethods: any[]
}

type PaymentDialogUi = {
    dialogTitle: string
    dialogDescription: string
    hasError: boolean
}

type SubscriptionStore = {
    meta: Meta
    data: Subscription
    ui: PaymentDialogUi
}

// Define the structure and initial values of the store
const subscription: ReadonlyDeep<SubscriptionStore> = deepFreeze({
    meta: {
        loadingStatus: LoadingStatus.idle,
        paymentProcessingStatus: PaymentProcessingStatus.idle,
        isPaymentDialogOpen: false
    },
    data: {
        paymentMethodSetupIntentSecret: '',
        paymentMethods: []
    },
    ui: {
        dialogTitle: '',
        dialogDescription: '',
        hasError: false
    }
})

const store = writable({...subscription})

export const subscriptionStore = {
    ...store,

    getMeta: (key: keyof Meta | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.meta[key] : store.meta
        })
        unsubscribe()

        return returnValue
    },

    getData: (key: keyof Subscription | null = null): any => {
        let returnValue: any
        const unsubscribe = store.subscribe(store => {
            returnValue = key ? store.data[key] : store.data
        })
        unsubscribe()

        return returnValue
    },

    setMetaValues: (values: Partial<Meta> = {}): any => store.update(state => ({
        ...state,
        meta: {
            ...state.meta,
            ...values
        }
    })),

    setDataValues: (values: Partial<Subscription> = {}): any => store.update(state => ({
        ...state,
        data: {
            ...state.data,
            ...values
        }
    })),

    setUiValues: (values: Partial<PaymentDialogUi> = {}): any => store.update(state => ({
        ...state,
        ui: {
            ...state.ui,
            ...values
        }
    })),

    resetStore: (): any => store.update(state => ({
        ...subscription
    })),

    resetUiValues: (): any => store.update(state => ({
        ...state,
        ui: {
            ...subscription.ui
        }
    }))
}
