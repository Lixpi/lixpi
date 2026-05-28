'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Source-shape regression: the legacy selected-node submission path auto-creates a
// context region and must tag its thread with contextRegion ownership, because the
// server-side delete guard classifies region histories by that ownership. The full
// path drives canvas state and NATS, so this guards the ownership tag structurally.
const controllerSource = readFileSync(resolve(__dirname, 'ai-prompt-input-controller.ts'), 'utf-8')

describe('AiPromptInputController — context region ownership', () => {
    it('tags an auto-created context-region thread with contextRegion ownership', () => {
        expect(
            controllerSource.includes("owner: { type: 'contextRegion', contextRegionNodeId }"),
            'ai-prompt-input-controller.ts should assign contextRegion ownership to the created thread',
        ).toBe(true)
    })
})
