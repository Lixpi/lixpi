type FakeStepResult = {
    doc: unknown
    failed: null
    maps?: unknown[]
    messages?: string[]
}

type FakeStep = {
    apply: (doc: unknown) => FakeStepResult
}

type FakeMapResult = {
    pos: number
}

class FakeMapping {
    maps: unknown[] = []

    appendMap(): this {
        return this
    }

    mapResult(pos: number): FakeMapResult {
        return { pos }
    }

    map(pos: number): number {
        return pos
    }

    slice(): this {
        return this
    }

    invert(): this {
        return this
    }

    setMirror(): void {
    }
}

export class Transform {
    steps: unknown[] = []
    mapping = new FakeMapping()
    doc: unknown

    constructor(doc: unknown = null) {
        this.doc = doc
    }

    step(): this {
        return this
    }
}

const createDefaultStep = (_schema: unknown, value: unknown): FakeStep => ({
    apply: (doc: unknown): FakeStepResult => ({
        doc,
        failed: null,
        maps: [],
        messages: [],
    }),
})

export const Step = {
    fromJSON: (_schema: unknown, _step: unknown): FakeStep => createDefaultStep(_schema, _step),
}

export const canSplit = (): boolean => false
export const canJoin = (): boolean => false
export const liftTarget = () => null
export const replaceStep = () => null
export const joinPoint = () => null
export const findWrapping = () => null
export const dropPoint = () => null
export class ReplaceStep {
    static fromJSON() {
        return new ReplaceStep()
    }

    apply() {
        return {
            doc: null,
            failed: false,
        }
    }
}
export class ReplaceAroundStep {
    static fromJSON() {
        return new ReplaceAroundStep()
    }
}

export { FakeMapping as Mapping }
