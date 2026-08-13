'use strict'

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type InstructionSource = {
    path: string
    text: string
}

const STATIC_INSTRUCTION_FILES = [
    new URL('./system.txt', import.meta.url),
    new URL('./anthropic_code_block_hack.txt', import.meta.url),
    new URL('./image_generation_instructions.txt', import.meta.url),
    new URL('./video_generation_instructions.txt', import.meta.url),
    new URL('../media-descriptor.ts', import.meta.url),
    new URL('../graph/media-branch-resolver.ts', import.meta.url),
    new URL('../tools/image-generation.ts', import.meta.url),
    new URL('../tools/video-generation.ts', import.meta.url),
    new URL('../../capability-system/capability-model-tool-executor.ts', import.meta.url),
    new URL('../../../packages/lixpi/capability-system/src/backend/capability-model-tools.ts', import.meta.url),
]

const STATIC_INSTRUCTION_DIRECTORIES = [
    new URL('../../capability-system/style-extraction-runtime/pipeline/', import.meta.url),
    new URL('../../../packages/lixpi/capability-system/src/capabilities/', import.meta.url),
]

const FORBIDDEN_PATTERNS = [
    {
        reason: 'illustrative phrasing',
        pattern: /\b(?:e\.g\.|for example|as an example|such as)\b/giu,
    },
    {
        reason: 'sample-prompt phrasing',
        pattern: /\bin the style of\b/giu,
    },
    {
        reason: 'known semantic or aesthetic exemplar',
        pattern: /\b(?:goat|cat|dog|fox|kitten|man|guy|watercolou?r|gouache|acrylic|anime|manga|pixar|disney|ghibli|kodak|canon|nikon|leica|arri|hasselblad|rembrandt|monet|picasso)\b/giu,
    },
] as const

const SOURCE_SUFFIXES = ['.ts', '.md', '.txt', '.json'] as const

function readInstructionSource(url: URL): InstructionSource {
    return {
        path: fileURLToPath(url),
        text: readFileSync(url, 'utf8'),
    }
}

function collectInstructionSources(directory: URL): InstructionSource[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const child = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory)
        if (entry.isDirectory()) return collectInstructionSources(child)
        if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) return []
        if (!SOURCE_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) return []
        return [readInstructionSource(child)]
    })
}

describe('static model instructions', () => {
    it('contain structural contracts without illustrative content', () => {
        const sources = [
            ...STATIC_INSTRUCTION_FILES.map(readInstructionSource),
            ...STATIC_INSTRUCTION_DIRECTORIES.flatMap(collectInstructionSources),
        ]
        const violations = sources.flatMap(source => FORBIDDEN_PATTERNS.flatMap(rule =>
            [...source.text.matchAll(rule.pattern)].map(match => {
                const line = source.text.slice(0, match.index).split('\n').length
                return `${source.path}:${line} ${rule.reason}: ${match[0]}`
            }),
        ))

        expect(violations, violations.join('\n')).toEqual([])
    })
})
