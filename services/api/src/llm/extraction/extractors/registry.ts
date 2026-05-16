'use strict'

import type { FeatureExtractor } from '../types.ts'

// New extractors are added by importing them here and appending to the array.
// Adding a new axis is a single-file change in this folder plus an import below;
// the router prompt is templated from this registry, so the new axis becomes
// scoreable automatically.
const EXTRACTORS: FeatureExtractor[] = []

export const registerExtractor = (extractor: FeatureExtractor): void => {
    if (EXTRACTORS.find((e) => e.axis === extractor.axis)) {
        throw new Error(`Duplicate extractor axis: ${extractor.axis}`)
    }
    EXTRACTORS.push(extractor)
}

export const getExtractors = (): FeatureExtractor[] => EXTRACTORS.slice()

export const getExtractor = (axis: string): FeatureExtractor | undefined =>
    EXTRACTORS.find((e) => e.axis === axis)

export const getRegisteredAxes = (): string[] =>
    EXTRACTORS.map((e) => e.axis)
