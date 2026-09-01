// Style Extraction capability settings. Every tunable this capability owns lives
// here, in the capability itself. It uses the same nested settings shape as
// the consuming frontend and backend.
export type StyleExtractionSettings = {
    actionTimeoutsMs: {
        initialize: number
        route: number
        extractAxis: number
        materializeCrops: number
        mergeAnalysis: number
        synthesize: number
        generateSamples: number
        persist: number
        applyVisualStyle: number
    }
}

export const styleExtractionSettings: StyleExtractionSettings = {
    // Wall-clock budget for each registered action, keyed by the action it caps.
    // The capability runner aborts the action and fails its run when the budget
    // is exceeded, so a budget that is too tight turns a slow provider into a
    // failed extraction, and one that is too loose leaves a stuck run holding its
    // slot. In-process steps get a short budget because they only do local work;
    // provider-calling steps get a budget sized to the slowest acceptable
    // response from that provider.
    actionTimeoutsMs: {
        // `style.initialize`: normalizes the request and resolves the source
        // Assets into the pipeline's starting state. Local setup only.
        initialize: 1000,
        // `style.route`: the stage-1 vision call that assesses the sources and
        // decides which style axes are applicable to this extraction.
        route: 180000,
        // `style.extract-axis`: one vision call per applicable style axis. The
        // budget caps a single axis, not the whole fan-out, and several axes run
        // concurrently behind the extractor concurrency limiter.
        extractAxis: 180000,
        // `style.materialize-crops`: renders the source crops that illustrate the
        // extracted style. Image decoding and cropping plus blob writes.
        materializeCrops: 180000,
        // `style.merge-analysis`: folds the per-axis results and the crops into
        // one pipeline state. Pure in-memory merge, no I/O.
        mergeAnalysis: 1000,
        // `style.synthesize`: the stage-4 call that turns the merged per-axis
        // analysis into the final style draft.
        synthesize: 180000,
        // `style.generate-samples`: generates the sample images that preview the
        // drafted style. Several image generations in one action, so this is the
        // longest budget in the pipeline.
        generateSamples: 300000,
        // `style.persist`: writes the finished visual-style Tool manifest and its
        // Assets. Blob uploads plus database writes.
        persist: 120000,
        // `visual-style.apply`: applies an already-extracted visual style to a
        // generation request. A local manifest lookup on a user-facing path, so
        // it stays short to fail fast rather than stall the request.
        applyVisualStyle: 5000,
    },
}
