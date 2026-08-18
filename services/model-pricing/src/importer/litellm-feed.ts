'use strict'

import { fetchAllowlistedText, ProviderSourceError } from './secure-fetch.ts'
import { sha256 } from './canonical-json.ts'
import type { ImmutableLiteLlmFeed, LiteLlmEntry } from './types.ts'

const GITHUB_API_ORIGIN = 'https://api.github.com'
const GITHUB_RAW_ORIGIN = 'https://raw.githubusercontent.com'
const LITELLM_REPOSITORY = 'BerriAI/litellm'
const LITELLM_PATH = 'model_prices_and_context_window.json'
const MAX_FEED_BYTES = 32 * 1024 * 1024

const isCommitSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export class LiteLlmFeedImporter {
    async fetch(): Promise<ImmutableLiteLlmFeed> {
        const headResponse = await fetchAllowlistedText({
            url: `${GITHUB_API_ORIGIN}/repos/${LITELLM_REPOSITORY}/commits/main`,
            allowedOrigins: new Set([GITHUB_API_ORIGIN]),
            maxBytes: 256 * 1024,
        })
        let commitDocument: unknown
        try {
            commitDocument = JSON.parse(headResponse.text)
        } catch {
            throw new ProviderSourceError('provider-source-invalid', 'LiteLLM commit response is not JSON')
        }
        const commitSha = isRecord(commitDocument) ? commitDocument.sha : undefined
        if (!isCommitSha(commitSha)) throw new ProviderSourceError('provider-source-invalid', 'LiteLLM commit response lacks a SHA')

        const feedResponse = await fetchAllowlistedText({
            url: `${GITHUB_RAW_ORIGIN}/${LITELLM_REPOSITORY}/${commitSha}/${LITELLM_PATH}`,
            allowedOrigins: new Set([GITHUB_RAW_ORIGIN]),
            maxBytes: MAX_FEED_BYTES,
        })
        let parsed: unknown
        try {
            parsed = JSON.parse(feedResponse.text)
        } catch {
            throw new ProviderSourceError('provider-source-invalid', 'Pinned LiteLLM feed is not JSON')
        }
        if (!isRecord(parsed) || !Object.values(parsed).every(isRecord)) {
            throw new ProviderSourceError('provider-source-invalid', 'Pinned LiteLLM feed has an invalid schema')
        }

        return { commitSha, contentSha256: sha256(feedResponse.text), entries: parsed as Record<string, LiteLlmEntry> }
    }
}
