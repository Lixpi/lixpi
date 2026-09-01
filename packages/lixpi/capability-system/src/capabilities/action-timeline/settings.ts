// Action Timeline capability settings. Every tunable this capability owns lives
// here, in the capability itself, so the backend actions, the canvas projection,
// and the frontend all read one source instead of re-declaring constants.
// Uses the same nested settings shape as the consuming frontend and backend.
export type ActionTimelineSettings = {
    canvas: {
        initialDimensions: {
            width: number
            height: number
        }
    }
    generation: {
        segmentAnswerTokens: number
        batchAnswerOverheadTokens: number
        maxBatchAnswerTokens: number
        maxBatchAttempts: number
    }
    actionTimeoutsMs: {
        validateRequest: number
        writeSegments: number
        persistTimeline: number
    }
}

export const actionTimelineSettings: ActionTimelineSettings = {
    // Canvas geometry for an Action Timeline Artifact node.
    canvas: {
        // Canvas-unit size the Artifact card claims when it first appears — both
        // when the API projects a generated timeline into the workspace and when
        // the user inserts one from the Artifact library. Existing nodes keep
        // their persisted size, so changing this only affects new cards.
        initialDimensions: {
            // Card width. The card is a text document whose segment lines wrap,
            // so this is the setting that decides how many lines each beat takes
            // and therefore how tall and how readable the timeline is.
            width: 702,
            // Initial card height only. The frontend reports its rendered height
            // and the node grows to fit the segments, so this is the space
            // reserved before the document renders, not a cap on the card.
            height: 360,
        },
    },
    // Budgets for the batched segment-writing calls to the reasoning model. Batch
    // planning and the per-call budget both read these, so a planned batch always
    // fits the budget requested for it — change them together, never one alone.
    generation: {
        // Answer-token allowance for one segment. A segment serializes as JSON
        // with a slotIndex and several text/assetId runs; this is a deliberately
        // roomy allowance so segments are never written short to fit a budget.
        // It also sets how many slots fit in a batch: batch size is the usable
        // answer tokens divided by this. Thinking tokens are excluded — the
        // structured-model runner adds that reserve on top, uniformly for every
        // provider.
        segmentAnswerTokens: 768,
        // Answer tokens reserved for the parts of a batch response that are not
        // segments — the JSON envelope and the continuity summary carried into
        // the next batch. Reserved on top of every batch, so raising it shrinks
        // the batch size at a fixed token ceiling.
        batchAnswerOverheadTokens: 2048,
        // Ceiling on the answer tokens one call may claim. Models allow far more
        // (Gemini 3.5 Flash allows 65k output), but a single call writing tens of
        // thousands of tokens of strict JSON is where structured output degrades
        // and truncates. Slots past this point move to the next batch, so nothing
        // is dropped or shortened.
        maxBatchAnswerTokens: 12288,
        // Total model calls allowed for one batch: the first write plus the
        // validation-correction retries. Each retry resends the batch with the
        // validation errors appended, so raising this trades run latency and
        // tokens for a lower chance of failing the whole timeline on one bad
        // batch. Below 2 there is no correction pass at all.
        maxBatchAttempts: 2,
    },
    // Wall-clock budget for each registered action, keyed by the action it caps.
    // The capability runner aborts the action and fails its run when the budget
    // is exceeded, so a budget that is too tight turns a slow model into a failed
    // timeline, and one that is too loose leaves a stuck run holding its slot.
    actionTimeoutsMs: {
        // `action-timeline.validate-request`: normalizes the duration and
        // precision and resolves the reference Assets into model inputs. Storage
        // reads only, no model call.
        validateRequest: 60000,
        // `action-timeline.write-segments`: the full batched segment-writing
        // loop. This budget covers every batch and every correction retry for the
        // whole timeline, so a long timeline at fine precision needs it generous
        // — this is the one action that scales with requested duration.
        writeSegments: 15 * 60000,
        // `action-timeline.persist-timeline`: builds the ProseMirror document and
        // writes the Artifact Asset. Blob upload plus database writes.
        persistTimeline: 120000,
    },
}
