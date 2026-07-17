'use strict'

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workspaceModelSource = (): string =>
    readFileSync(new URL('../models/workspace.ts', import.meta.url), 'utf8')

function expectSourceToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source'): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`
    ).toBe(false)
}

// =============================================================================
// API WORKSPACE CANVAS STATE UPDATE CONTRACT
// =============================================================================

describe('Workspace model canvas state update contract', () => {
    it('guards full canvas saves with an optimistic-concurrency canvasStateUpdatedAt condition', () => {
        const source = workspaceModelSource()

        expectSourceToContain(
            source,
            "return '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)'",
            'getCanvasStateWriteCondition'
        )
        expectSourceToContain(
            source,
            "return '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt)) AND attribute_not_exists(#deletingAt)'",
            'getCanvasStateWriteCondition'
        )
        expectSourceNotToContain(
            source,
            'const currentFiles = workspace?.files || []',
            'Workspace model'
        )
    })

    it('retries mutateCanvasState on a conditional-check failure instead of overwriting a concurrent write', () => {
        const source = workspaceModelSource()

        expectSourceToContain(
            source,
            'const maxAttempts = 5',
            'Workspace.mutateCanvasState'
        )
        expectSourceToContain(
            source,
            'if (isTransactionConditionalCheckFailure(error)) continue',
            'Workspace.mutateCanvasState'
        )
        expectSourceToContain(
            source,
            'throw new Error(`Failed to mutate workspace canvas state after concurrent updates: ${workspaceId}`)',
            'Workspace.mutateCanvasState'
        )
        expectSourceNotToContain(
            source,
            'files: updatedFiles',
            'Workspace model'
        )
    })
})
