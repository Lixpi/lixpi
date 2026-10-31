import {
    BedrockRuntimeClient,
    InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { bedrockInference } from './bedrock-inference.ts'

export type StabilityBedrockInput = {
    modelVersion: string
    prompt: string
    imageSize: string
    seed: number
}
export type StabilityBedrockOutput = {
    imageBase64: string
    seed: number
    providerRequestId: string
    filtered: boolean
}

// Exactly one paid request. The caller owns authorization, retries, durability
// and usage settlement. Unsupported reference controls never enter this path.
export class StabilityBedrockCall {
    private readonly client: BedrockRuntimeClient

    constructor(client?: BedrockRuntimeClient) {
        this.client = client ?? new BedrockRuntimeClient({
            region: bedrockInference.region,
            ...bedrockInference.credentials(),
            maxAttempts: 1,
        })
    }

    async invoke(
        input: StabilityBedrockInput,
        signal?: AbortSignal,
    ): Promise<StabilityBedrockOutput> {
        const modelId = await bedrockInference.resolveModelId('stability', input.modelVersion)
        const response = await this.client.send(
            new InvokeModelCommand({
                modelId,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    prompt: input.prompt,
                    mode: 'text-to-image',
                    aspect_ratio: input.imageSize,
                    output_format: 'png',
                    seed: input.seed,
                }),
            }),
            { abortSignal: signal },
        )
        const value = JSON.parse(
            new TextDecoder().decode(response.body),
        ) as {
            images?: unknown[]
            seeds?: unknown[]
            finish_reasons?: unknown[]
        }
        const filtered = Boolean(value.finish_reasons?.[0])
        const imageBase64 = value.images?.[0]
        const seed = value.seeds?.[0]

        if (
            (!filtered && (typeof imageBase64 !== 'string' || !imageBase64))
            || !Number.isSafeInteger(
                Number(seed),
            )
        )
            throw new Error('STABILITY_BEDROCK_INVALID_RESPONSE')

        return {
            imageBase64: typeof imageBase64 === 'string' ? imageBase64 : '',
            seed: Number(seed),
            filtered,
            providerRequestId: response.$metadata.requestId ?? '',
        }
    }
}
