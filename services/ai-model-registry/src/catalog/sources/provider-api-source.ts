import process from 'node:process'

import {
    info,
    warn,
} from '@lixpi/debug-tools'

import {
    type LixpiModelRecord,
    type ProviderDirectory,
    type SourceId,
} from '../types.ts'
import {
    type ModelSource,
    type SourceModelFacts,
} from './model-source.ts'

// The vendors' own listing endpoints. They answer what models.dev and LiteLLM
// cannot: whether a model is still offered on the account Lixpi actually calls, and
// what the vendor currently calls it. Anthropic publishes both token limits with it,
// and Google adds the default temperature.
//
// AWS Bedrock is a separate source, in bedrock-source.ts, because an account can
// reach a model through both and the two catalogs are worth keeping apart.
//
// Stability and BytePlus publish no listing endpoint, so they return null and their
// models carry no facts from here at all.

type ProviderModelFacts = Map<string, Partial<LixpiModelRecord>>

export class ProviderApiSource implements ModelSource {
    readonly id: SourceId = 'provider-api'

    private readonly facts = new Map<ProviderDirectory, ProviderModelFacts | null>()

    async load(): Promise<void> {
        this.facts.set('openai', await this.safeLoad('OpenAI', () => this.loadOpenAI()))
        this.facts.set('anthropic', await this.safeLoad('Anthropic', () => this.loadAnthropic()))
        this.facts.set('google', await this.safeLoad('Google', () => this.loadGoogle()))
        this.facts.set('stability', null)
        this.facts.set('byteplus', null)
    }

    // One provider being unreachable must never take the whole sync down. A null
    // result reads the same as "this provider publishes no listing", which keeps the
    // authored catalog authoritative either way.
    private async safeLoad(
        label: string,
        load: () => Promise<ProviderModelFacts>,
    ): Promise<ProviderModelFacts | null> {
        try {
            const result = await load()
            info(`${label} listing returned ${result.size} models`)

            return result
        } catch (error) {
            warn(`${label} listing skipped: ${error instanceof Error ? error.message : String(error)}`)

            return null
        }
    }

    // OpenAI's listing publishes an id, a creation timestamp, and an owner, and
    // nothing else. It answers availability and nothing more.
    private async loadOpenAI(): Promise<ProviderModelFacts> {
        const apiKey = process.env.OPENAI_API_KEY

        if (!apiKey)
            throw new Error('OPENAI_API_KEY is not set')

        const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } })

        if (!response.ok)
            throw new Error(`OpenAI listing failed with ${response.status}`)

        const body = (await response.json()) as { data?: Array<{ id: string }> }
        const facts: ProviderModelFacts = new Map()

        for (const entry of body.data ?? [])
            facts.set(entry.id, {})

        return facts
    }

    private async loadAnthropic(): Promise<ProviderModelFacts> {
        const apiKey = process.env.ANTHROPIC_API_KEY

        if (!apiKey)
            throw new Error('ANTHROPIC_API_KEY is not set')

        const response = await fetch(
            'https://api.anthropic.com/v1/models?limit=1000',
            {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
            },
        )

        if (!response.ok)
            throw new Error(`Anthropic listing failed with ${response.status}`)

        const body = (await response.json()) as {
            data?: Array<{
                id: string
                display_name?: string
                max_input_tokens?: number
                max_tokens?: number
            }>
        }
        const facts: ProviderModelFacts = new Map()

        for (const entry of body.data ?? []) {
            const fields: Partial<LixpiModelRecord> = {}

            if (entry.display_name)
                fields.title = entry.display_name

            if (entry.max_input_tokens)
                fields.contextWindow = entry.max_input_tokens

            if (entry.max_tokens)
                fields.maxCompletionSize = entry.max_tokens

            facts.set(entry.id, fields)
        }

        return facts
    }

    private async loadGoogle(): Promise<ProviderModelFacts> {
        const apiKey = process.env.GOOGLE_API_KEY

        if (!apiKey)
            throw new Error('GOOGLE_API_KEY is not set')

        const facts: ProviderModelFacts = new Map()
        let pageToken: string | undefined

        do {
            const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
            url.searchParams.set('key', apiKey)
            url.searchParams.set('pageSize', '100')

            if (pageToken)
                url.searchParams.set('pageToken', pageToken)

            const response = await fetch(url)

            if (!response.ok)
                throw new Error(`Google listing failed with ${response.status}`)

            const body = (await response.json()) as {
                models?: Array<{
                    name?: string
                    displayName?: string
                    inputTokenLimit?: number
                    outputTokenLimit?: number
                    temperature?: number
                }>
                nextPageToken?: string
            }

            for (const entry of body.models ?? []) {
                const modelId = (entry.name ?? '').replace(/^models\//u, '')

                if (!modelId)
                    continue

                const fields: Partial<LixpiModelRecord> = {}

                if (entry.displayName)
                    fields.title = entry.displayName

                if (entry.inputTokenLimit)
                    fields.contextWindow = entry.inputTokenLimit

                if (entry.outputTokenLimit)
                    fields.maxCompletionSize = entry.outputTokenLimit

                if (typeof entry.temperature === 'number')
                    fields.defaultTemperature = entry.temperature

                facts.set(modelId, fields)
            }

            pageToken = body.nextPageToken
        } while (pageToken)

        return facts
    }

    lookup(
        provider: ProviderDirectory,
        modelId: string,
    ): SourceModelFacts | null {
        const fields = this.facts.get(provider)?.get(modelId)

        if (!fields)
            return null

        return {
            byInferenceProvider: {
                [provider]: {
                    sourceKey: modelId,
                    fields,
                },
            },
        }
    }

    listAvailable(provider: ProviderDirectory): string[] | null {
        const facts = this.facts.get(provider)

        if (!facts)
            return null

        return [...facts.keys()].sort()
    }
}
