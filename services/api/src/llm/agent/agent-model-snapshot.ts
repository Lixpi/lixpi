import { createHash } from 'node:crypto'
import {
    type AgentBedrockModelProfile,
} from './agent-bedrock-model.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

type ModelSnapshot = {
    selectionId: string
    profile: AgentBedrockModelProfile
    resolvedModelId: string
}

// The transport route and model controls are part of an accepted turn's state.
// Resolving them again after a crash could change the request fingerprint and
// bypass the receipt for a provider request whose outcome is still unknown.
export class AgentModelSnapshot {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly resolve: (modelVersion: string) => Promise<string>,
    ) {}

    async load(
        owner: ConversationOwner,
        selectionId: string,
        profile: AgentBedrockModelProfile,
        scope?: string,
    ): Promise<ModelSnapshot> {
        const run = (await owner.read()).run

        if (!run)
            throw new Error('CONVERSATION_RUN_REQUIRED')

        if (profile.inferenceProviderCalledByThePlatform !== 'aws-bedrock')
            throw new Error('AGENT_REASONING_ROUTE_UNAVAILABLE')

        const suffix = scope === undefined ? '' : `#${createHash('sha256').update(scope).digest('hex')}`
        const key = `MODEL_PROFILE#${run.turnId}${suffix}`
        const saved = await this.repository.read<{ payload: AgentPayload }>(owner.partition, key)

        if (saved) {
            const snapshot = JSON.parse(
                Buffer.from(await this.payloads.read(saved.payload)).toString('utf8'),
            ) as ModelSnapshot

            if (
                snapshot.selectionId !== selectionId
                || snapshot.profile.modelVersion !== profile.modelVersion
                || snapshot.profile.model !== profile.model
            )
                throw new Error('AGENT_REASONING_MODEL_CHANGED')

            await owner.fences(run.continuationEpoch)

            return snapshot
        }

        const snapshot: ModelSnapshot = {
            selectionId,
            profile: structuredClone(profile),
            resolvedModelId: await this.resolve(profile.modelVersion),
        }
        const prepared = await this.payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(snapshot),
            ),
            key,
        )

        try {
            await this.repository.commit([
                ...await owner.fences(run.continuationEpoch),
                this.repository.put(
                    owner.partition,
                    key,
                    { payload: prepared.payload },
                ),
                ...prepared.operations,
            ])
        } catch (error) {
            const committed = await this.repository.read<{ payload: AgentPayload }>(owner.partition, key)

            if (committed?.payload.hash !== prepared.payload.hash)
                throw error

            await owner.fences(run.continuationEpoch)
        }

        return snapshot
    }
}
