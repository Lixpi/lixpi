import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import type { BranchMarkerPromptPart } from '../../shared/branch-tree-layout/marker-prompt-parts.ts'

export type BranchPromptReference = Exclude<BranchMarkerPromptPart, { type: 'text' }>['reference']
export type BranchPromptReferenceView = { dom: HTMLElement; destroy: () => void }
export type BranchPromptReferenceRenderer = (reference: BranchPromptReference) => BranchPromptReferenceView

export class BranchMarkerPromptParts {
    readonly items: ReadonlyArray<string | HTMLElement>
    private readonly lifetime = new Lifetime()

    constructor(parts: readonly BranchMarkerPromptPart[], renderReference: BranchPromptReferenceRenderer) {
        const items: Array<string | HTMLElement> = []
        try {
            for (const part of parts) {
                if (part.type === 'text') items.push(part.text)
                else {
                    const view = renderReference(part.reference)
                    this.lifetime.own(() => view.dom.remove())
                    this.lifetime.own(() => view.destroy())
                    items.push(view.dom)
                }
            }
            this.items = items
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
