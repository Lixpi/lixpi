import {
    type ReadonlyDeep,
} from 'type-fest'

export const deepFreeze = <T>(o: T) => {
    Object.values(o).forEach(v => Object.isFrozen(v) || deepFreeze(v))

    return Object.freeze(o) as ReadonlyDeep<T>
}
