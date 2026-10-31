import { createHash } from 'node:crypto'
import {
    createConversationSettings,
    type ConversationCreateRequest,
    type ConversationGetRequest,
    type ConversationListRequest,
    type ConversationMessageNode,
    type ConversationMessagesRequest,
    type ConversationQueueRequest,
    type ConversationReplayRequest,
    type ConversationSettings,
    type ConversationSettingsRequest,
    type ConversationStopRequest,
    type ConversationSubmitRequest,
} from '@lixpi/constants'
import {
    createProseMirrorSchema,
    DOCUMENT_TYPE,
} from '@lixpi/prosemirror'

export type ConversationRequests = {
    create: ConversationCreateRequest
    list: ConversationListRequest
    get: ConversationGetRequest
    messages: ConversationMessagesRequest
    submit: ConversationSubmitRequest
    settings: ConversationSettingsRequest
    stop: ConversationStopRequest
    queue: ConversationQueueRequest
    replay: ConversationReplayRequest
}

const commandFields: Record<keyof ConversationRequests, string[]> = {
    create: ['clientConversationId', 'settings'],
    list: ['cursor', 'limit'],
    get: ['conversationAssetId', 'clientMessageId'],
    messages: ['conversationAssetId', 'cursor', 'limit'],
    submit: ['conversationAssetId', 'clientMessageId', 'fragment', 'references', 'settingsRevision', 'midRunPolicy', 'interruptId'],
    settings: ['conversationAssetId', 'expectedRevision', 'patch'],
    stop: ['conversationAssetId', 'runId', 'clientCommandId'],
    queue: ['conversationAssetId', 'expectedRevision', 'clientCommandId', 'action', 'turnIds'],
    replay: ['conversationAssetId', 'afterEventSeq', 'limit'],
}

const record = (value: unknown): Record<string, unknown> => {
    if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
    )
        throw new Error('INVALID_CONVERSATION_COMMAND')

    return value as Record<string, unknown>
}

const fields = (
    value: Record<string, unknown>,
    allowed: string[],
): void => {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new Error('UNKNOWN_CONVERSATION_FIELD')
}

export const assertConversationId = (value: unknown): string => {
    if (
        typeof value !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)
    )
        throw new Error('INVALID_CONVERSATION_ID')

    return value
}

const integer = (
    value: unknown,
    minimum = 0,
    maximum = Number.MAX_SAFE_INTEGER,
): number => {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < minimum
        || value > maximum
    )
        throw new Error('INVALID_CONVERSATION_REVISION')

    return value
}

const choice = (
    value: unknown,
    allowed: string[],
): void => {
    if (
        typeof value !== 'string'
        || !allowed.includes(value)
    )
        throw new Error('INVALID_CONVERSATION_SETTING')
}

const shortText = (value: unknown): void => {
    if (
        typeof value !== 'string'
        || !value.length
        || value.length > 512
    )
        throw new Error('INVALID_CONVERSATION_SETTING')
}

export const validateConversationSettings = (value: unknown): Partial<ConversationSettings> => {
    const settings = record(value)
    fields(settings, ['contextMode', 'midRunPolicy', 'models'])

    if (settings.contextMode !== undefined)
        choice(settings.contextMode, ['explicit', 'discovery', 'mixed'])

    if (settings.midRunPolicy !== undefined)
        choice(settings.midRunPolicy, ['steer', 'stop-first', 'queue'])

    if (settings.models !== undefined) {
        const models = record(settings.models)
        fields(models, ['reasoningModelIds', 'imageModelIds', 'videoModelIds', 'reasoningOptions', 'imageOptions', 'videoOptions'])

        for (const key of ['reasoningModelIds', 'imageModelIds', 'videoModelIds']) {
            const ids = models[key]

            if (
                !Array.isArray(ids)
                || ids.length > 16
                || new Set(ids).size !== ids.length
            )
                throw new Error('INVALID_CONVERSATION_MODELS')

            ids.forEach(shortText)
        }

        for (const [key, allowed] of Object.entries({
            reasoningOptions: ['configGroups'],
            imageOptions: ['configGroups', 'imageSize'],
            videoOptions: ['configGroups', 'aspectRatio', 'resolution', 'duration', 'sourceVideoNodeId', 'sourceForExtension'],
        })) {
            if (models[key] === undefined)
                continue

            const options = record(models[key])
            fields(options, allowed)

            for (const [name, option] of Object.entries(options)) {
                if (name !== 'configGroups') {
                    shortText(option)

                    continue
                }

                if (
                    !Array.isArray(option)
                    || option.length > 32
                )
                    throw new Error('INVALID_CONVERSATION_MODELS')

                for (const groupInput of option) {
                    const group = record(groupInput)
                    fields(group, ['groupId', 'modelIds', 'values'])
                    shortText(group.groupId)

                    if (
                        !Array.isArray(group.modelIds)
                        || group.modelIds.length > 16
                    )
                        throw new Error('INVALID_CONVERSATION_MODELS')

                    group.modelIds.forEach(shortText)
                    const values = record(group.values)

                    if (Object.keys(values).length > 64)
                        throw new Error('INVALID_CONVERSATION_MODELS')

                    Object.values(values).forEach(shortText)
                }
            }
        }
    }

    return structuredClone(settings) as Partial<ConversationSettings>
}

export const resolveConversationSettings = (patch: unknown = {}): ConversationSettings => ({
    ...createConversationSettings(),
    ...validateConversationSettings(patch),
})

export class ConversationProtocol {
    private readonly schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONVERSATION)

    parse<Kind extends keyof ConversationRequests>(
        kind: Kind,
        input: unknown,
    ): ConversationRequests[Kind] {
        const data = record(input)

        if (Buffer.byteLength(
            JSON.stringify(data),
            'utf8',
        ) > 128_000)
            throw new Error('CONVERSATION_COMMAND_TOO_LARGE')

        fields(data, ['protocolVersion', 'workspaceId', ...commandFields[kind]])

        if (data.protocolVersion !== 1)
            throw new Error('UNSUPPORTED_CONVERSATION_PROTOCOL')

        assertConversationId(data.workspaceId)

        if (
            kind !== 'create'
            && kind !== 'list'
        )
            assertConversationId(data.conversationAssetId)

        if (kind === 'create') {
            assertConversationId(data.clientConversationId)

            if (data.settings !== undefined)
                validateConversationSettings(data.settings)
        }

        if (
            kind === 'list'
            && data.cursor !== undefined
        )
            assertConversationId(data.cursor)

        if (data.limit !== undefined)
            integer(
                data.limit,
                1,
                100,
            )

        if (
            kind === 'messages'
            && data.cursor !== undefined
            && (typeof data.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/u.test(data.cursor))
        )
            throw new Error('INVALID_CONVERSATION_CURSOR')

        if (
            kind === 'get'
            && data.clientMessageId !== undefined
        )
            assertConversationId(data.clientMessageId)

        if (kind === 'submit') {
            assertConversationId(data.clientMessageId)
            integer(data.settingsRevision, 1)

            if (data.midRunPolicy !== undefined)
                choice(data.midRunPolicy, ['steer', 'stop-first', 'queue'])

            if (data.interruptId !== undefined)
                assertConversationId(data.interruptId)

            this.validateFragment(data.fragment)

            if (
                !Array.isArray(data.references)
                || data.references.length > 24
            )
                throw new Error('INVALID_CONVERSATION_REFERENCES')

            const seen = new Set<string>()

            for (const inputReference of data.references) {
                const reference = record(inputReference)
                fields(reference, ['assetId', 'role', 'revision', 'renditionId'])
                assertConversationId(reference.assetId)
                choice(reference.role, ['content', 'conversation', 'provenance', 'media', 'artifact'])

                if (reference.revision !== undefined)
                    integer(reference.revision, 1)

                if (reference.renditionId !== undefined)
                    assertConversationId(reference.renditionId)

                const key = `${reference.assetId}:${reference.role}:${reference.renditionId ?? ''}`

                if (seen.has(key))
                    throw new Error('DUPLICATE_CONVERSATION_REFERENCE')

                seen.add(key)
            }
        }

        if (kind === 'settings') {
            integer(data.expectedRevision, 1)
            validateConversationSettings(data.patch)
        }

        if (kind === 'stop') {
            assertConversationId(data.runId)
            assertConversationId(data.clientCommandId)
        }

        if (kind === 'queue') {
            integer(data.expectedRevision, 1)
            assertConversationId(data.clientCommandId)
            choice(data.action, ['cancel-message', 'resume'])

            if (
                !Array.isArray(data.turnIds)
                || data.turnIds.length > 32
                || new Set(data.turnIds).size !== data.turnIds.length
            )
                throw new Error('INVALID_CONVERSATION_QUEUE')

            data.turnIds.forEach(assertConversationId)

            if (
                data.action === 'cancel-message'
                && data.turnIds.length === 0
            )
                throw new Error('INVALID_CONVERSATION_QUEUE')
        }

        if (kind === 'replay')
            integer(data.afterEventSeq)

        return structuredClone(data) as ConversationRequests[Kind]
    }

    private validateFragment(input: unknown): void {
        const fragment = record(input)

        if (
            fragment.type !== 'aiUserMessage'
            || fragment.attrs !== undefined
        )
            throw new Error('INVALID_CONVERSATION_MESSAGE')

        let hasReference = false
        const walk = (
            node: Record<string, unknown>,
            depth: number,
        ): void => {
            fields(node, ['type', 'text', 'attrs', 'content', 'marks'])

            if (
                depth > 32
                || (depth > 0 && String(node.type).startsWith('ai'))
            )
                throw new Error('INVALID_CONVERSATION_MESSAGE')

            if (node.type === 'prompt_reference')
                hasReference = true

            if (node.content !== undefined) {
                if (
                    !Array.isArray(node.content)
                    || node.content.length > 4096
                )
                    throw new Error('INVALID_CONVERSATION_MESSAGE')

                node.content.forEach(
                    child => walk(
                        record(child),
                        depth + 1,
                    ),
                )
            }
        }
        walk(fragment, 0)
        const node = this.schema.nodeFromJSON(fragment)
        node.check()

        if (
            !node.textContent.trim()
            && !hasReference
        )
            throw new Error('EMPTY_CONVERSATION_MESSAGE')
    }
}

export const conversationMessageText = (node: ConversationMessageNode): string => node.text ?? (node.content ?? []).map(conversationMessageText).join(
    node.type === 'aiUserMessage' ? '\n' : '',
)

// Canonicalize object keys while preserving ordered arrays and exact text.
export const conversationPayloadHash = (input: unknown): string => {
    const canonical = (value: unknown): unknown => {
        if (Array.isArray(value))
            return value.map(canonical)

        if (
            value
            && typeof value === 'object'
        )
            return Object.fromEntries(
                Object.keys(value)
                    .sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]),
            )

        return value
    }

    return createHash('sha256')
        .update(
            JSON.stringify(
                canonical(input),
            ),
        )
        .digest('hex')
}
