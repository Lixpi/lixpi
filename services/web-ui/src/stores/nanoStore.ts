// Writable adapter for the domain stores. Each domain store keeps its public
// surface and delegates subscribe, set, update, and synchronous reads to an atom.

import { atom } from 'nanostores'

export type Subscriber<Value> = (value: Value) => void
export type Updater<Value> = (value: Value) => Value
export type Unsubscriber = () => void

export type Writable<Value> = {
    // `atom.subscribe` calls the listener immediately with the current value and
    // again on every change. Domain `getData` helpers depend on that synchronous
    // initial delivery.
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
        update: updater => store.set(
            updater(
                store.get(),
            ),
        ),
        get: () => store.get(),
    }
}
