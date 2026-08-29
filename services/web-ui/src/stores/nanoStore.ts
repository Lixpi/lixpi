'use strict'

// Nano Stores-backed replacement for the tiny slice of `svelte/store` the app
// used. Every domain store keeps its own public surface (getData, setDataValues,
// upsert, ...) and only needs a writable container underneath. Backing that
// container with a Nano Stores `atom` removes the Svelte runtime dependency while
// preserving the `subscribe`/`set`/`update`/`get` contract those stores rely on.

import { atom } from 'nanostores'

export type Subscriber<Value> = (value: Value) => void
export type Updater<Value> = (value: Value) => Value
export type Unsubscriber = () => void

export type Writable<Value> = {
    // `atom.subscribe` calls the listener immediately with the current value and
    // again on every change, matching the Svelte writable contract the domain
    // stores depend on (their `getData` helpers read synchronously through it).
    subscribe: (run: Subscriber<Value>) => Unsubscriber
    set: (value: Value) => void
    update: (updater: Updater<Value>) => void
    get: () => Value
}

export const writable = <Value>(initial: Value): Writable<Value> => {
    const store = atom<Value>(initial)

    return {
        subscribe: run => store.subscribe(value => run(value)),
        set: value => store.set(value),
        update: updater => store.set(updater(store.get())),
        get: () => store.get(),
    }
}
