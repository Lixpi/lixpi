'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

// Source-shape regression: the selected-node submission path auto-creates an AI
// chat thread root and keeps its history standalone.
const controllerSource = readFileSync(resolve(__dirname, 'ai-prompt-input-controller.ts'), 'utf-8')

describe('AiPromptInputController — standalone thread ownership', () => {
    it('tags an auto-created AI chat thread with standalone ownership', () => {
        expect(
            controllerSource.includes("owner: { type: 'standalone' }"),
            'ai-prompt-input-controller.ts should assign standalone ownership to the created thread',
        ).toBe(true)
    })
})
