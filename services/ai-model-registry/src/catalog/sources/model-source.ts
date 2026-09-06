import {
    type InferenceProviderId,
    type LixpiModelRecord,
    type ProviderDirectory,
    type SourceId,
} from '../types.ts'

// What one source can say about one model, per inference provider. Fields a source cannot answer
// are left out entirely rather than filled with a guess, because an absent field
// merges cleanly while a guessed one becomes drift nobody can act on.
export type SourceProviderFacts = {
    sourceKey: string
    fields: Partial<LixpiModelRecord>
    // Facts the source reports that the model record has no field for. They are
    // written to the source file and never merged, so a source can record what it
    // knows without inventing model fields nobody consumes.
    sourceOnlyFacts?: Record<string, unknown>
}

// A source may know a model on the vendor's own API, on AWS Bedrock, or on both. The
// rates differ between them, so they are kept apart all the way to the merge and
// every one of them reaches the merged file.
export type SourceModelFacts = {
    byInferenceProvider: Partial<Record<InferenceProviderId, SourceProviderFacts>>
}

// Every source implements this. `load` runs once per sync, `lookup` is pure after
// that, and `listAvailable` reports what the source sees so models nobody has
// reviewed can be surfaced instead of silently ignored.
export type ModelSource = {
    readonly id: SourceId
    load: () => Promise<void>
    lookup: (
        provider: ProviderDirectory,
        modelId: string,
    ) => SourceModelFacts | null
    listAvailable: (provider: ProviderDirectory) => string[] | null
}
