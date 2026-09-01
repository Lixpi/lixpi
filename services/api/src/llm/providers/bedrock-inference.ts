import * as process from 'process'

import {
    BedrockClient,
    ListFoundationModelsCommand,
    ListInferenceProfilesCommand,
    type FoundationModelSummary,
    type InferenceProfileSummary,
} from '@aws-sdk/client-bedrock'
import { fromSSO } from '@aws-sdk/credential-providers'
import {
    info,
    warn,
} from '@lixpi/debug-tools'

// Vendors whose models we can route through AWS Bedrock instead of the vendor's own API.
// Keep this aligned with the `{VENDOR}_USE_AWS_BEDROCK_INFERENCE` env flags below.
export type BedrockVendor = 'anthropic' | 'stability'

// Env flag names per vendor. The first entry is canonical; the rest are accepted aliases
// so the flag can be paired with the api-key name already used in .env (e.g.
// STABLE_DIFFUSION_API_KEY -> STABLE_DIFFUSION_USE_AWS_BEDROCK_INFERENCE).
const BEDROCK_FLAG_ENV_NAMES: Record<BedrockVendor, string[]> = {
    anthropic: ['ANTHROPIC_USE_AWS_BEDROCK_INFERENCE'],
    stability: ['STABILITY_USE_AWS_BEDROCK_INFERENCE', 'STABLE_DIFFUSION_USE_AWS_BEDROCK_INFERENCE'],
}

// Model ids in the synchronized AI model catalog are vendor-API ids. Bedrock renames a few of
// them, so map the catalog id to the Bedrock model-name stem before matching. Anything not
// listed here is matched by generic normalization (dots -> dashes, `-latest` stripped).
const BEDROCK_MODEL_NAME_ALIASES: Record<BedrockVendor, Record<string, string>> = {
    anthropic: {},
    stability: {
        'stability-ultra': 'stable-image-ultra',
        'sd3.5-large': 'sd3-5-large',
    },
}

type ResolvedBedrockModel = {
    // The id to pass as `modelId` — either a foundation-model id or, when the model is only
    // available through a cross-region inference profile, the inference-profile id.
    modelId: string
    foundationModelId: string
}

type BedrockModelCandidate = {
    modelId: string
    // Release date suffix (YYYYMMDD) when the Bedrock id carries one, otherwise 0.
    releaseDate: number
    majorVersion: number
    minorVersion: number
    supportsOnDemand: boolean
}

// Matches both current pinned, dateless ids such as `anthropic.claude-sonnet-5`
// and legacy version-suffixed ids such as `anthropic.claude-haiku-4-5-20251001-v1:0`.
export const buildBedrockModelIdPattern = (vendor: BedrockVendor, modelNameStem: string): RegExp => new RegExp(`^${vendor}\\.${modelNameStem}(?:-(\\d{8}))?(?:-v(\\d+)(?::(\\d+))?)?$`, 'i')

const normalizeModelNameStem = (vendor: BedrockVendor, modelVersion: string): string => {
    const alias = BEDROCK_MODEL_NAME_ALIASES[vendor][modelVersion]
    if (alias) return alias
    return modelVersion
        .replace(/-latest$/i, '')
        .replaceAll('.', '-')
}

// Escapes the regex metacharacters that can appear in a normalized model-name stem.
const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const compareCandidates = (a: BedrockModelCandidate, b: BedrockModelCandidate): number => b.releaseDate - a.releaseDate || b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion

// Owns Bedrock inference configuration: the per-vendor opt-in flags, the region, the
// credential resolution shared by every Bedrock client, and the catalog-id -> Bedrock-id
// resolution (cached per process, discovered from the Bedrock control plane so new model
// releases need no code change).
class BedrockInference {
    private readonly env = process.env
    private controlPlaneClient?: BedrockClient
    private foundationModelsPromise?: Promise<FoundationModelSummary[]>
    private inferenceProfilesPromise?: Promise<InferenceProfileSummary[]>
    private readonly resolvedModels = new Map<string, Promise<ResolvedBedrockModel>>()

    isEnabledFor(vendor: BedrockVendor): boolean {
        return BEDROCK_FLAG_ENV_NAMES[vendor].some(name => this.env[name]?.trim().toLowerCase() === 'true')
    }

    get region(): string {
        const region = this.env.AWS_REGION?.trim()
        if (!region) throw new Error('AWS_REGION must be set to use AWS Bedrock inference')
        return region
    }

    // Locally the api container has the developer's SSO cache mounted at /root/.aws, so resolve
    // through the named profile exactly like DynamoDBService does. On AWS the ECS task role is
    // picked up by the default provider chain, so no explicit credentials are returned.
    credentials(): { credentials: ReturnType<typeof fromSSO> } | Record<string, never> {
        const ssoProfile = this.env.AWS_PROFILE?.trim()
        if (this.env.ENVIRONMENT === 'local' && ssoProfile) {
            return { credentials: fromSSO({ profile: ssoProfile }) }
        }
        return {}
    }

    async resolveModelId(vendor: BedrockVendor, modelVersion: string): Promise<string> {
        const cacheKey = `${vendor}:${modelVersion}`
        let pending = this.resolvedModels.get(cacheKey)
        if (!pending) {
            pending = this.discoverModel(vendor, modelVersion)
            this.resolvedModels.set(cacheKey, pending)
        }
        try {
            const resolved = await pending
            return resolved.modelId
        } catch (e) {
            // A failed lookup must not be cached — the next request should retry (e.g. after
            // expired SSO credentials are refreshed).
            this.resolvedModels.delete(cacheKey)
            throw e
        }
    }

    private client(): BedrockClient {
        this.controlPlaneClient ??= new BedrockClient({ region: this.region, ...this.credentials() })
        return this.controlPlaneClient
    }

    private async listFoundationModels(): Promise<FoundationModelSummary[]> {
        this.foundationModelsPromise ??= (async () => {
            const response = await this.client().send(new ListFoundationModelsCommand({}))
            return response.modelSummaries ?? []
        })()
        try {
            return await this.foundationModelsPromise
        } catch (e) {
            this.foundationModelsPromise = undefined
            throw e
        }
    }

    private async listInferenceProfiles(): Promise<InferenceProfileSummary[]> {
        this.inferenceProfilesPromise ??= (async () => {
            const profiles: InferenceProfileSummary[] = []
            let nextToken: string | undefined
            do {
                const response = await this.client().send(new ListInferenceProfilesCommand({ nextToken }))
                profiles.push(...(response.inferenceProfileSummaries ?? []))
                nextToken = response.nextToken
            } while (nextToken)
            return profiles
        })()
        try {
            return await this.inferenceProfilesPromise
        } catch (e) {
            this.inferenceProfilesPromise = undefined
            throw e
        }
    }

    private async discoverModel(vendor: BedrockVendor, modelVersion: string): Promise<ResolvedBedrockModel> {
        const stem = normalizeModelNameStem(vendor, modelVersion)
        const pattern = buildBedrockModelIdPattern(vendor, escapeForRegex(stem))
        const summaries = await this.listFoundationModels()

        const candidates: BedrockModelCandidate[] = []
        for (const summary of summaries) {
            const modelId = summary.modelId
            if (!modelId) continue
            const match = pattern.exec(modelId)
            if (!match) continue
            candidates.push({
                modelId,
                releaseDate: Number(match[1] ?? 0),
                majorVersion: Number(match[2] ?? 0),
                minorVersion: Number(match[3] ?? 0),
                supportsOnDemand: (summary.inferenceTypesSupported ?? []).includes('ON_DEMAND'),
            })
        }

        if (candidates.length === 0) {
            throw new Error(
                `No AWS Bedrock foundation model matches ${vendor} model "${modelVersion}" `
                    + `(looked for ${vendor}.${stem} with an optional date and -vN suffix in region ${this.region}). `
                    + `Either the model is not offered on Bedrock, is not enabled for this account, `
                    + `or the model catalog id needs an alias in bedrock-inference.ts.`,
            )
        }

        candidates.sort(compareCandidates)
        const selected = candidates[0]!

        if (selected.supportsOnDemand) {
            info(`[Bedrock] Resolved ${vendor} model "${modelVersion}" -> ${selected.modelId} (on-demand)`)
            return { modelId: selected.modelId, foundationModelId: selected.modelId }
        }

        // Newer models are invocable only through a cross-region inference profile whose id
        // carries a geo prefix (e.g. `us.anthropic.claude-…`).
        const profiles = await this.listInferenceProfiles()
        const profile = profiles.find(candidate =>
            (candidate.models ?? []).some(
                model => model.modelArn?.endsWith(`/${selected.modelId}`),
            )
        )
        const profileId = profile?.inferenceProfileId
        if (!profileId) {
            throw new Error(
                `AWS Bedrock model ${selected.modelId} requires an inference profile, but no profile `
                    + `covering it exists in region ${this.region}. Enable cross-region inference for it.`,
            )
        }

        info(`[Bedrock] Resolved ${vendor} model "${modelVersion}" -> ${profileId} (inference profile for ${selected.modelId})`)
        return { modelId: profileId, foundationModelId: selected.modelId }
    }

    // Logged once at construction of a Bedrock-backed provider so the routing decision is
    // visible in startup/stream logs instead of being silent.
    logRouting(vendor: BedrockVendor, providerName: string): void {
        info(`[${providerName}] AWS Bedrock inference enabled (region ${this.region})`)
        if (this.env.ENVIRONMENT === 'local' && !this.env.AWS_PROFILE?.trim()) {
            warn(`[${providerName}] ENVIRONMENT=local but AWS_PROFILE is unset — Bedrock calls will fall back to the default AWS credential chain`)
        }
    }
}

export const bedrockInference = new BedrockInference()
