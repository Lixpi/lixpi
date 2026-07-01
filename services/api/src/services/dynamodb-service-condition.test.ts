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
// API WORKSPACE FILE UPDATE CONTRACT
// =============================================================================

describe('Workspace model file update contract', () => {
    it('appends workspace files atomically instead of using read-modify-write state', () => {
        const source = workspaceModelSource()

        expectSourceToContain(
            source,
            "updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, #updatedAt), #files = list_append(if_not_exists(#files, :empty), :newFiles), #updatedAt = :now'",
            'Workspace.addFile'
        )
        expectSourceNotToContain(
            source,
            'const currentFiles = workspace?.files || []\n            const updatedFiles = [...currentFiles, file]',
            'Workspace.addFile'
        )
    })

    it('removes workspace files with a guarded list-index update and conditional retry', () => {
        const source = workspaceModelSource()

        expectSourceToContain(
            source,
            'const maxAttempts = 5',
            'Workspace.removeFile'
        )
        expectSourceToContain(
            source,
            'updateExpression: `SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[${fileIndex}]`',
            'Workspace.removeFile'
        )
        expectSourceToContain(
            source,
            'conditionExpression: `#files[${fileIndex}].#id = :fileId`',
            'Workspace.removeFile'
        )
        expectSourceToContain(
            source,
            "if (error?.name === 'ConditionalCheckFailedException') continue",
            'Workspace.removeFile'
        )
        expectSourceNotToContain(
            source,
            'files: updatedFiles',
            'Workspace.removeFile'
        )
    })
})
