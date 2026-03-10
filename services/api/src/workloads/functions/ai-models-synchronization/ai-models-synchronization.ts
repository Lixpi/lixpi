'use strict'

import process from 'process'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import DynamoDBService, { marshall, unmarshall } from '@lixpi/dynamodb-service'

//INFO: do not remove unused imports!
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import type {
    AiModel,
} from '@lixpi/constants'

import { getDynamoDbTableStageName } from '@lixpi/constants'
import type { PartialDeep } from 'type-fest'

// Modality metadata constants
const MODALITY_METADATA = {
    text: { title: 'Text', shortTitle: 'TXT' },
    image: { title: 'Image', shortTitle: 'IMG' },
    audio: { title: 'Audio', shortTitle: 'AUDIO' },
    voice: { title: 'Voice', shortTitle: 'VOICE' },
    video: { title: 'Video', shortTitle: 'VID' }
} as const

// Helper function to generate modalities with metadata from modalities array
function generateModalitiesWithMetadata(modalities: string[]): Array<{ modality: string; title: string; shortTitle: string }> {
    return modalities.map(modality => {
        const metadata = MODALITY_METADATA[modality as keyof typeof MODALITY_METADATA]
        return {
            modality,
            title: metadata?.title || modality.charAt(0).toUpperCase() + modality.slice(1),
            shortTitle: metadata?.shortTitle || modality.toUpperCase()
        }
    })
}

// OpenAI API types (using SDK types)
type OpenAIModel = OpenAI.Models.Model
type AnthropicModel = {
    id: string
    display_name?: string
    created_at?: string
    type?: string
}

type GoogleModel = {
    name: string
    displayName?: string
    description?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
}

// Blacklist rules per provider: exact, prefix, and contains (partial-name) patterns
type ProviderBlacklist = {
    exact: string[]
    prefix: string[]
    contains: string[]
}

// Default model capability/settings per provider.
type ModelDefaults = Pick<
    AiModel,
    'contextWindow' | 'maxCompletionSize' | 'defaultTemperature' | 'supportsSystemPrompt' | 'modalities' | 'pricing' | 'color' | 'iconName'
> & {
    // Not part of AiModel, used only for provider-grouped sorting
    starSortingPosition: number
    // Transform functions for model properties
    transforms?: {
        [key: string]: (...args: any[]) => any
    }
}

type ProviderModelDefaults = {
    exact: Record<string, PartialDeep<ModelDefaults>>
    prefix: Array<{ prefix: string; values: PartialDeep<ModelDefaults> }>
    contains: Array<{ includes: string; values: PartialDeep<ModelDefaults> }>
    fallback?: ModelDefaults
}

export interface AiModelsSyncOptions {
    dynamoDBService?: DynamoDBService
    openaiApiKey?: string
    anthropicApiKey?: string
    googleApiKey?: string
}

export interface AiModelsSyncResult {
    openAI: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    anthropic: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    google: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    totalProcessed: number
    totalNew: number
    totalUpdated: number
    totalDeleted: number
}

export class AiModelsSync {
    private readonly dynamoDBService: DynamoDBService
    private readonly openai: OpenAI
    private readonly anthropic: Anthropic
    private readonly google: GoogleGenAI
    private readonly aiModelsListTableName: string
    private readonly serviceName: string

    constructor(options: AiModelsSyncOptions = {}) {
        const env = process.env

        // Use provided DynamoDB service or create a new one
        this.dynamoDBService = options.dynamoDBService || new DynamoDBService({
            region: env.AWS_REGION,
            ssoProfile: env.AWS_PROFILE,
            ...(env.DYNAMODB_ENDPOINT && { endpoint: env.DYNAMODB_ENDPOINT }),    // For local development only
        })

        this.openai = new OpenAI({
            apiKey: options.openaiApiKey || env.OPENAI_API_KEY,
        })

        this.anthropic = new Anthropic({
            apiKey: options.anthropicApiKey || env.ANTHROPIC_API_KEY,
        })

        this.google = new GoogleGenAI({
            apiKey: options.googleApiKey || env.GOOGLE_API_KEY,
        })

        this.aiModelsListTableName = getDynamoDbTableStageName('AI_MODELS_LIST', env.ORG_NAME!, env.STAGE!)
        this.serviceName = 'ai-models-sync-service'
    }

    // Blacklist rules per provider: exact, prefix, and contains (partial-name) patterns
    private static readonly MODELS_BLACKLIST: { OpenAI: ProviderBlacklist; Anthropic: ProviderBlacklist; Google: ProviderBlacklist } = {
        OpenAI: {
            // Exact matches (use for cases like 'gpt-4' to avoid excluding 'gpt-4o')
            exact: [
                'gpt-4',
                'gpt-4o',
                'gpt-image-1',    // temporarily disabled, code doesn't yet support it
                'gpt-4o-transcribe',    // temporarily disabled, code doesn't yet support it
            ],
            // Prefix matches (legacy families)
            prefix: [
                'gpt-3.5',
                'gpt-4-',
                'gpt-4-turbo',
                'chatgpt-4o-',
                'o1',    // temporarily disabled, code doesn't yet support it
                'text-',
                'code-',
                'davinci',
                'curie',
                'babbage',
                'ada',
                'dall-e',
                'tts',
                'whisper'
            ],
            // Contains (partial-name) matches
            // Example: filter out models with '-mini' or '-nano' anywhere in the name
            contains: [
                '-mini',
                '-nano'
            ]
        },
        Anthropic: {
            exact: [],
            prefix: [
                'claude-3-haiku',
                'claude-3-opus',
                'claude-3-5',
                'claude-3-7'
            ],
            contains: []
        },
        Google: {
            exact: [],
            prefix: [
                'gemini-1.0',
                'gemini-1.5',
                'gemini-2.0',
                'text-embedding',
                'embedding',
                'aqa',
            ],
            contains: [
                '-tts-',
                '-live-',
                '-robotics-',
                '-computer-use-',
                'imagen',
                'veo',
                'lyria',
            ]
        }
    }

    // Default model capability/settings per provider.
    private static readonly MODELS_DEFAULTS: { OpenAI: ProviderModelDefaults; Anthropic: ProviderModelDefaults; Google: ProviderModelDefaults } = {
        // OpenAI model defaults sourced from offline docs provided in temp-openai-models-info/.
        // Only differences from fallback are specified; remaining fields inherit via mergeWithFallback.
        OpenAI: {
            exact: {
                // ChatGPT-4o alias page shows 128k context, 16,384 max output tokens
                'chatgpt-4o-latest': { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '15.00' } } } } },
                // GPT-5 Chat latest explicit alias
                'gpt-5-chat-latest': { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } },
            },
            prefix: [
                {
                    prefix: 'gpt-5', values: {
                    contextWindow: 400000,
                    maxCompletionSize: 128000,
                    modalities: ['text', 'image'],
                    defaultTemperature: 1,    // Supports only default value 1.
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } }
                },
                // GPT-5 Chat family: 128k context, 16,384 max output
                { prefix: 'gpt-5-chat', values: { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // GPT-4.1 family: ~1M context window, 32,768 max output
                { prefix: 'gpt-4.1', values: { contextWindow: 1047576, maxCompletionSize: 32768, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '8.00' } } } } } },
                // GPT-4o (chat) family: 128k context, 16,384 max output
                { prefix: 'gpt-4o', values: { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.50', completion: '10.00' } } } } } },
                // GPT-4o Realtime family: 32k context, 4,096 max output; supports audio
                { prefix: 'gpt-4o-realtime', values: { contextWindow: 32000, maxCompletionSize: 4096, modalities: ['text', 'image', 'audio'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '20.00' } } }, audio: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '40.00', completion: '80.00' } } } },
                // O3 Deep Research: 200k context, 100k max output
                { prefix: 'o3-deep-research', values: { contextWindow: 200000, maxCompletionSize: 100000, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '10.00', completion: '40.00' } } } } } },
                // O4 Mini Deep Research: 200k context, 100k max output (per page)
                { prefix: 'o4-mini-deep-research', values: { contextWindow: 200000, maxCompletionSize: 100000, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '8.00' } } } } } },
                // GPT-Image-1: image generation model; specify modalities only
                { prefix: 'gpt-image-1', values: { modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '0.00' } } }, image: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '10.00', completion: '40.00' } } } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                supportsSystemPrompt: true,
                modalities: ['text'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',    // for example set to 1.2 to add 20% margin
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                // Provider UI defaults
                color: '#56967c',
                iconName: 'gptAvatarIcon',
                // Base offset for sorting; used to group providers
                starSortingPosition: 200,
                transforms: {
                    title: (modelId: string) => {
                        return modelId
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gpt') return 'GPT'
                                if (part.toLowerCase() === 'o1') return 'O1'
                                if (part.toLowerCase() === 'o3') return 'O3'
                                if (part.toLowerCase() === 'o4') return 'O4'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                    },
                    shortTitle: (modelId: string) => {
                        const title = modelId
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gpt') return 'GPT'
                                if (part.toLowerCase() === 'o1') return 'O1'
                                if (part.toLowerCase() === 'o3') return 'O3'
                                if (part.toLowerCase() === 'o4') return 'O4'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                        // Remove "Latest" suffix if present
                        return title.replace(/\s+Latest$/i, '')
                    }
                }
            }
        },
        // Anthropic model defaults sourced from official docs (Models overview):
        // - Context window: generally 200k (Sonnet 4 can be 1M with beta header; we default to 200k)
        // - Max output tokens: varies by family
        Anthropic: {
            exact: {},
            prefix: [
                { prefix: 'claude-opus-4-1', values: { contextWindow: 200000, maxCompletionSize: 32000, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-opus-4', values: { contextWindow: 200000, maxCompletionSize: 32000, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-sonnet-4', values: { contextWindow: 200000, maxCompletionSize: 64000, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '3.00', completion: '15.00' } } } } } },
                { prefix: 'claude-3-7-sonnet', values: { contextWindow: 200000, maxCompletionSize: 64000, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '3.00', completion: '15.00' } } } } } },
                { prefix: 'claude-3-5-haiku', values: { contextWindow: 200000, maxCompletionSize: 8192, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.00', completion: '5.00' } } } } } },
                { prefix: 'claude-3-haiku', values: { contextWindow: 200000, maxCompletionSize: 4096, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.00', completion: '5.00' } } } } } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                supportsSystemPrompt: true,
                modalities: ['text', 'image'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                color: '#D97757',
                iconName: 'claudeIcon',
                starSortingPosition: 100,
                transforms: {
                    title: (modelId: string, displayName?: string) => {
                        return displayName || modelId
                            .split('-')
                            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(' ')
                    },
                    shortTitle: (modelId: string, displayName?: string) => {
                        const fullTitle = displayName || modelId
                            .split('-')
                            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(' ')
                        // Remove "Claude " prefix if present
                        return fullTitle.replace(/^Claude\s+/i, '')
                    }
                }
            }
        },
        Google: {
            exact: {
                'gemini-2.5-flash-preview-image-generation': {
                    contextWindow: 1048576,
                    maxCompletionSize: 65536,
                    modalities: ['text', 'image'],
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } }
                },
                'gemini-2.5-flash-image': {
                    contextWindow: 1048576,
                    maxCompletionSize: 65536,
                    modalities: ['text', 'image'],
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } }
                },
            },
            prefix: [
                // Gemini 2.5 Pro family (text-only)
                { prefix: 'gemini-2.5-pro', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // Gemini 2.5 Flash family (text-only, image generation only in gemini-2.5-flash-image)
                { prefix: 'gemini-2.5-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
                // Gemini 3 Pro Image (Nano Banana Pro)
                { prefix: 'gemini-3-pro-image', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '5.00' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } } } },
                // Gemini 3.1 Flash Image (Nano Banana 2)
                { prefix: 'gemini-3.1-flash-image', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } } } },
                // Gemini 3.1 Pro
                { prefix: 'gemini-3.1-pro', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // Gemini 3.1 Flash
                { prefix: 'gemini-3.1-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
                // Gemini 3 Flash
                { prefix: 'gemini-3-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                supportsSystemPrompt: true,
                modalities: ['text'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                color: '#4285F4',
                iconName: 'geminiIcon',
                starSortingPosition: 150,
                transforms: {
                    title: (modelId: string) => {
                        // Map well-known image models to Nano Banana names
                        const nanoBananaNames: Record<string, string> = {
                            'gemini-2.5-flash-preview-image-generation': 'Nano Banana',
                            'gemini-3-pro-image-preview': 'Nano Banana Pro',
                            'gemini-3.1-flash-image-preview': 'Nano Banana 2',
                        }
                        if (nanoBananaNames[modelId]) return nanoBananaNames[modelId]

                        return modelId
                            .replace(/^models\//, '')
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gemini') return 'Gemini'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                    },
                    shortTitle: (modelId: string) => {
                        const nanoBananaNames: Record<string, string> = {
                            'gemini-2.5-flash-preview-image-generation': 'Nano Banana',
                            'gemini-3-pro-image-preview': 'Nano Banana Pro',
                            'gemini-3.1-flash-image-preview': 'Nano Banana 2',
                        }
                        if (nanoBananaNames[modelId]) return nanoBananaNames[modelId]

                        return modelId
                            .replace(/^models\//, '')
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gemini') return 'Gemini'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                            .replace(/\s+Preview$/i, '')
                    }
                }
            }
        }
    }

    // Helper to merge pricing from partial values with provider fallback
    private mergePricingWithFallback(partial: Partial<AiModel['pricing']> | undefined, fallback: AiModel['pricing']): AiModel['pricing'] {
        const p = partial || {}
        const merged: any = {
            currency: p.currency || fallback.currency,
            resaleMargin: p.resaleMargin || fallback.resaleMargin,
        }
        if (p.text || fallback.text) merged.text = p.text || fallback.text
        if (p.audio || (fallback as any).audio) merged.audio = p.audio || (fallback as any).audio
        if (p.image || (fallback as any).image) merged.image = p.image || (fallback as any).image
        return merged as AiModel['pricing']
    }

    // Merge a (possibly partial) entry with the provider fallback to ensure all fields are present.
    private mergeWithFallback(partial: PartialDeep<ModelDefaults> | undefined, fallback: ModelDefaults): ModelDefaults {
        const p = partial || {}
        return {
            contextWindow: typeof p.contextWindow === 'number' ? p.contextWindow : fallback.contextWindow,
            maxCompletionSize: typeof p.maxCompletionSize === 'number' ? p.maxCompletionSize : fallback.maxCompletionSize,
            defaultTemperature: typeof p.defaultTemperature === 'number' ? p.defaultTemperature : fallback.defaultTemperature,
            supportsSystemPrompt: typeof p.supportsSystemPrompt === 'boolean' ? p.supportsSystemPrompt : fallback.supportsSystemPrompt,
            modalities: Array.isArray(p.modalities) ? p.modalities : fallback.modalities,
            pricing: this.mergePricingWithFallback(p.pricing as any, fallback.pricing),
            color: typeof (p as any).color === 'string' ? (p as any).color : fallback.color,
            iconName: typeof (p as any).iconName === 'string' ? (p as any).iconName : fallback.iconName,
            starSortingPosition: typeof (p as any).starSortingPosition === 'number' ? (p as any).starSortingPosition : fallback.starSortingPosition,
            transforms: (p as any).transforms || fallback.transforms,
        }
    }

    private resolveModelDefaults(provider: keyof typeof AiModelsSync.MODELS_DEFAULTS, modelId: string): ModelDefaults {
        const config = AiModelsSync.MODELS_DEFAULTS[provider]
        const fallback = config.fallback!

        // 1. Check exact matches first
        if (config.exact[modelId]) {
            return this.mergeWithFallback(config.exact[modelId], fallback)
        }

        // 2. Check prefix matches
        for (const prefixEntry of config.prefix) {
            if (modelId.startsWith(prefixEntry.prefix)) {
                return this.mergeWithFallback(prefixEntry.values, fallback)
            }
        }

        // 3. Check contains (partial-name) matches
        for (const containsEntry of config.contains) {
            if (modelId.includes(containsEntry.includes)) {
                return this.mergeWithFallback(containsEntry.values, fallback)
            }
        }

        // 4. Return fallback if no specific match
        return fallback
    }

    // Helper function to detect minor versions with date patterns
    private isMinorVersion(modelId: string): boolean {
        const patterns = [
            /\d{4}-\d{2}-\d{2}/,    // 2024-01-25
            /:\d{8}/,               // :20240125
            /-preview$/,            // -preview suffix
            /-alpha$/,              // -alpha suffix
            /-beta$/,               // -beta suffix
        ]

        return patterns.some(pattern => pattern.test(modelId))
    }

    // Fetch available models from OpenAI API using SDK
    private async fetchOpenAIModels(): Promise<OpenAIModel[]> {
        const apiKey = this.openai.apiKey
        if (!apiKey) {
            throw new Error('OpenAI API key is required but not provided')
        }

        try {
            const modelsList = await this.openai.models.list()
            const models = modelsList.data

            // Filter models based on blacklist and only include relevant models
            const blacklist = AiModelsSync.MODELS_BLACKLIST.OpenAI

            return models.filter((model: OpenAIModel) => {
                const modelId = model.id

                // Check exact blacklist matches
                if (blacklist.exact.includes(modelId)) {
                    return false
                }

                // Check prefix blacklist matches
                if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) {
                    return false
                }

                // Check contains blacklist matches
                if (blacklist.contains.some(substring => modelId.includes(substring))) {
                    return false
                }

                // Skip minor versions/snapshots with date patterns
                if (this.isMinorVersion(modelId)) {
                    return false
                }

                // Include only GPT, O1, or text-davinci models (main OpenAI chat/completion models)
                return modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('text-davinci')
            })

        } catch (error) {
            err('Failed to fetch OpenAI models:', error)
            throw error
        }
    }

    // Fetch available models from Anthropic API using SDK
    private async fetchAnthropicModels(): Promise<AnthropicModel[]> {
        const apiKey = this.anthropic.apiKey
        if (!apiKey) {
            warn('Anthropic API key not provided, skipping Anthropic models synchronization')
            return []
        }

        try {
            // Note: Anthropic doesn't have a public models list endpoint yet
            // This is a placeholder implementation that returns an empty array
            // In the future, when Anthropic provides such an endpoint, we can implement it here

            // Temporary: attempt to call the list method if it exists
            if (typeof this.anthropic.models?.list === 'function') {
                const page = await this.anthropic.models.list({
                    limit: 100,
                }) as any

                if (page?.data) {
                    const models = page.data as AnthropicModel[]

                    // Filter models based on blacklist
                    const blacklist = AiModelsSync.MODELS_BLACKLIST.Anthropic

                    return models.filter(model => {
                        const modelId = model.id

                        // Check exact blacklist matches
                        if (blacklist.exact.includes(modelId)) {
                            return false
                        }

                        // Check prefix blacklist matches
                        if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) {
                            return false
                        }

                        // Check contains blacklist matches
                        if (blacklist.contains.some(substring => modelId.includes(substring))) {
                            return false
                        }

                        // Skip minor versions/snapshots with date patterns
                        if (this.isMinorVersion(modelId)) {
                            return false
                        }

                        return true
                    })
                }
            }

            // Return empty array as fallback
            info('Anthropic models list endpoint not available yet, returning empty array')
            return []

        } catch (error) {
            warn('Failed to fetch Anthropic models (expected, as endpoint may not exist yet):', error)
            return []
        }
    }

    // Fetch available models from Google Gen AI API
    private async fetchGoogleModels(): Promise<GoogleModel[]> {
        try {
            const pager = await this.google.models.list({ config: { pageSize: 100 } })
            const allModels: GoogleModel[] = []

            for await (const model of pager) {
                // The API returns model names like "models/gemini-2.5-flash"
                // Strip the "models/" prefix for consistency
                const modelId = (model.name || '').replace(/^models\//, '')
                if (!modelId) continue

                allModels.push({
                    name: modelId,
                    displayName: model.displayName,
                    description: model.description,
                    inputTokenLimit: model.inputTokenLimit,
                    outputTokenLimit: model.outputTokenLimit,
                })
            }

            // Filter models based on blacklist
            const blacklist = AiModelsSync.MODELS_BLACKLIST.Google

            return allModels.filter(model => {
                const modelId = model.name

                if (blacklist.exact.includes(modelId)) return false
                if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) return false
                if (blacklist.contains.some(substring => modelId.includes(substring))) return false
                if (this.isMinorVersion(modelId) && !modelId.includes('image')) return false

                // Only include gemini models
                return modelId.startsWith('gemini')
            })

        } catch (error) {
            err('Failed to fetch Google models:', error)
            throw error
        }
    }

    // Map OpenAI model to our AiModel format
    private mapOpenAIModelToAiModel(openAIModel: OpenAIModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('OpenAI', openAIModel.id)

        const now = Date.now()

        const model: AiModel = {
            provider: 'OpenAI',
            model: openAIModel.id,
            title: openAIModel.id,
            shortTitle: openAIModel.id,
            modelVersion: openAIModel.id,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            supportsSystemPrompt: modelDefaults.supportsSystemPrompt,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(openAIModel.id)
                }
            }
        }

        return model
    }

    // Map Anthropic model to our AiModel format
    private mapAnthropicModelToAiModel(anthropicModel: AnthropicModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('Anthropic', anthropicModel.id)

        const now = Date.now()

        const model: AiModel = {
            provider: 'Anthropic',
            model: anthropicModel.id,
            title: anthropicModel.display_name || anthropicModel.id,
            shortTitle: anthropicModel.display_name || anthropicModel.id,
            modelVersion: anthropicModel.id,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            supportsSystemPrompt: modelDefaults.supportsSystemPrompt,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(anthropicModel.id, anthropicModel.display_name)
                }
            }
        }

        return model
    }

    // Map Google model to our AiModel format
    private mapGoogleModelToAiModel(googleModel: GoogleModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('Google', googleModel.name)

        const now = Date.now()

        // Use API-reported token limits if available and our defaults are 0
        const contextWindow = modelDefaults.contextWindow || googleModel.inputTokenLimit || 0
        const maxCompletionSize = modelDefaults.maxCompletionSize || googleModel.outputTokenLimit || 0

        const model: AiModel = {
            provider: 'Google',
            model: googleModel.name,
            title: googleModel.displayName || googleModel.name,
            shortTitle: googleModel.displayName || googleModel.name,
            modelVersion: googleModel.name,
            contextWindow,
            maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            supportsSystemPrompt: modelDefaults.supportsSystemPrompt,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(googleModel.name)
                }
            }
        }

        return model
    }

    // Update existing models sequentially to avoid overwhelming DynamoDB
    private async updateModelsSequentially(modelsToUpdate: AiModel[], tableName: string, origin: string) {
        if (modelsToUpdate.length === 0) return

        info(`📝 Updating ${modelsToUpdate.length} existing models sequentially`)

        for (const model of modelsToUpdate) {
            try {
                await this.dynamoDBService.putItem({
                    tableName,
                    item: model,
                    origin
                })
                info(`Updated model: ${model.model}`)
            } catch (error) {
                err(`Failed to update model ${model.model}:`, error)
                throw error
            }
        }

        info(`✅ Successfully updated ${modelsToUpdate.length} models`)
    }

    // Synchronize OpenAI models with database
    private async synchronizeOpenAIModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting OpenAI models synchronization')

        try {
            // Fetch models from OpenAI API
            const openAIModels = await this.fetchOpenAIModels()
            info(`📡 Fetched ${openAIModels.length} models from OpenAI API`)

            // Log the raw models from OpenAI
            info('📋 Raw OpenAI models:')
            openAIModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.id} (owner: ${model.owned_by}, created: ${new Date(model.created * 1000).toISOString()})`)
            })

            // Map OpenAI models to our format
            const mappedModels: AiModel[] = openAIModels.map((model, index) =>
                this.mapOpenAIModelToAiModel(model, index + 1)
            )

            info(`🔧 Mapped ${mappedModels.length} models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            // Get existing OpenAI models from database
            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'OpenAI' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing OpenAI models in database`)

            // Identify models to delete (exist in DB but not in fetched list)
            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            // Separate remaining models into new and existing
            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new OpenAI models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            // Delete obsolete models first
            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete OpenAI models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete OpenAI model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete OpenAI model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete OpenAI models`)
            }

            // Process new models first
            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new OpenAI models`)
            }

            // Process updates sequentially
            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ OpenAI models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ OpenAI models synchronization failed:', error)
            throw error
        }
    }

    // Synchronize Anthropic models with database
    private async synchronizeAnthropicModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting Anthropic models synchronization')

        try {
            // Fetch models from Anthropic API
            const anthropicModels = await this.fetchAnthropicModels()
            info(`📡 Fetched ${anthropicModels.length} models from Anthropic API`)

            // Log the raw models from Anthropic
            info('Raw Anthropic models:')
            anthropicModels.forEach((model, index) => {
                const createdIso = model.created_at ? new Date(model.created_at).toISOString() : 'N/A'
                const logMessage = `${index + 1}. ${model.id} (display: ${model.display_name || 'N/A'}, created: ${createdIso})`
                info(logMessage)
            })

            // Map Anthropic models to our format
            const mappedModels: AiModel[] = anthropicModels.map((model, index) =>
                this.mapAnthropicModelToAiModel(model, index + 1)
            )

            info(`🔧 Mapped ${mappedModels.length} Anthropic models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            // Get existing Anthropic models from database
            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'Anthropic' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing Anthropic models in database`)

            // Identify models to delete (exist in DB but not in fetched list)
            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            // Separate remaining models into new and existing
            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new Anthropic models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            // Delete obsolete models first
            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete Anthropic models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete Anthropic model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete Anthropic model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete Anthropic models`)
            }

            // Process new models first
            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new Anthropic models`)
            }

            // Process updates sequentially
            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ Anthropic models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ Anthropic models synchronization failed:', error)
            throw error
        }
    }

    // Synchronize Google models with database
    private async synchronizeGoogleModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting Google models synchronization')

        try {
            const googleModels = await this.fetchGoogleModels()
            info(`📡 Fetched ${googleModels.length} models from Google API`)

            info('📋 Raw Google models:')
            googleModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.name} (display: ${model.displayName || 'N/A'}, input: ${model.inputTokenLimit}, output: ${model.outputTokenLimit})`)
            })

            const mappedModels: AiModel[] = googleModels.map((model, index) =>
                this.mapGoogleModelToAiModel(model, index + 1)
            )

            info(`🔧 Mapped ${mappedModels.length} Google models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'Google' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing Google models in database`)

            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new Google models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete Google models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete Google model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete Google model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete Google models`)
            }

            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new Google models`)
            }

            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ Google models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ Google models synchronization failed:', error)
            throw error
        }
    }

    // Main synchronization method
    async synchronizeModels(): Promise<AiModelsSyncResult> {
        info(`🚀 Starting AI models synchronization - Service: ${this.serviceName}`)

        try {
            // Synchronize OpenAI models
            const openAIResult = await this.synchronizeOpenAIModels()
            info(`OpenAI synchronization completed: ${JSON.stringify(openAIResult)}`)

            // Synchronize Anthropic models (placeholder)
            const anthropicResult = await this.synchronizeAnthropicModels()
            info(`Anthropic synchronization completed: ${JSON.stringify(anthropicResult)}`)

            // Synchronize Google models
            const googleResult = await this.synchronizeGoogleModels()
            info(`Google synchronization completed: ${JSON.stringify(googleResult)}`)

            const totalResult = {
                openAI: openAIResult,
                anthropic: anthropicResult,
                google: googleResult,
                totalProcessed: openAIResult.processed + anthropicResult.processed + googleResult.processed,
                totalNew: openAIResult.newModels + anthropicResult.newModels + googleResult.newModels,
                totalUpdated: openAIResult.updatedModels + anthropicResult.updatedModels + googleResult.updatedModels,
                totalDeleted: openAIResult.deletedModels + anthropicResult.deletedModels + googleResult.deletedModels
            }

            info('✅ AI models synchronization completed successfully')
            info(`📊 Summary: ${JSON.stringify(totalResult)}`)

            return totalResult

        } catch (error) {
            err('❌ AI models synchronization failed:', error)
            throw error
        }
    }
}
