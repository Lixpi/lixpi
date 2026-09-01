'use strict'

import type { StyleExtractor } from '../types.ts'

// New extractors are added by importing them here and appending to the array.
// Adding a new axis is a single-file change in this folder plus an import below;
// the router prompt is templated from this registry, so the new axis becomes
// scoreable automatically.
const EXTRACTORS: StyleExtractor[] = []

export const registerExtractor = (extractor: StyleExtractor): void => {
    if (EXTRACTORS.find((e) => e.axis === extractor.axis)) {
        throw new Error(`Duplicate extractor axis: ${extractor.axis}`)
    }
    EXTRACTORS.push(extractor)
}

export const getExtractors = (): StyleExtractor[] => EXTRACTORS.slice()

export const getExtractor = (axis: string): StyleExtractor | undefined => EXTRACTORS.find((e) => e.axis === axis)

export const getRegisteredAxes = (): string[] => EXTRACTORS.map((e) => e.axis)
