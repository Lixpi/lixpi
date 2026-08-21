'use strict'

import { fromPublic } from '@nats-io/nkeys'

import DynamoDBService from '@lixpi/dynamodb-service'
import type { PricingOverrideCommand } from '@lixpi/constants'
import { canonicalize, sha256 } from '../importer/canonical-json.ts'
import { PricingStorage } from '../importer/pricing-storage.ts'

type OverrideEvent = PricingOverrideCommand & {
    recordKey: string
    sortKey: string
    payloadHash: string
    status: 'proposed' | 'approved' | 'rejected'
}

const commandPayload = (command: PricingOverrideCommand): Omit<PricingOverrideCommand, 'signature'> => {
    const { signature: _signature, ...payload } = command
    return payload
}

const decodeBase64Url = (value: string): Uint8Array => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64')
}

const asCommand = (value: unknown): PricingOverrideCommand => {
    if (!value || typeof value !== 'object') throw new Error('Override command must be an object')
    const command = value as PricingOverrideCommand
    const requiredStrings: Array<keyof PricingOverrideCommand> = [
        'commandId', 'pricingKey', 'expectedActiveSnapshotId', 'candidateHash', 'reason',
        'changeReference', 'issuedAt', 'expiresAt', 'nonce', 'actorKeyId', 'signature',
    ]
    for (const field of requiredStrings) {
        if (typeof command[field] !== 'string' || !command[field].trim()) {
            throw new Error(`Override command ${field} must be a non-empty string`)
        }
    }
    if (!['propose', 'approve', 'reject'].includes(command.action)) throw new Error('Override command action is invalid')
    if (command.action === 'propose' && !command.patch) throw new Error('Override proposals require a patch')
    if (command.action !== 'propose' && command.patch !== undefined) throw new Error('Only override proposals may include a patch')
    if (command.action !== 'propose' && (typeof command.proposalEventId !== 'string' || !command.proposalEventId.trim())) {
        throw new Error('Override approvals and rejections must reference a proposal event id')
    }
    if (command.action === 'propose' && command.proposalEventId !== undefined) {
        throw new Error('Override proposals must not reference a proposal event id')
    }
    return command
}

export class PricingOverrideService {
    constructor(
        private readonly dynamo: DynamoDBService,
        private readonly storage: PricingStorage,
        private readonly auditTable: string,
        private readonly operatorPublicKeys: ReadonlySet<string>,
    ) {}

    async submit(value: unknown): Promise<{ eventId: string; status: OverrideEvent['status']; idempotent: boolean }> {
        const command = asCommand(value)
        this.verifySignature(command)
        this.verifyFreshness(command)

        const existing = await this.dynamo.getItem({
            tableName: this.auditTable,
            key: { recordKey: `COMMAND#${command.commandId}`, sortKey: 'COMMAND' },
            consistentRead: true,
            origin: 'model-pricing.override-command-idempotency',
            throwOnError: true,
        }) as OverrideEvent | undefined
        const payloadHash = sha256(canonicalize(commandPayload(command)))
        if (existing) {
            if (existing.payloadHash !== payloadHash) throw new Error(`Override command id ${command.commandId} was replayed with different content`)
            return { eventId: existing.sortKey, status: existing.status, idempotent: true }
        }

        const active = await this.storage.getActivePointer()
        if (active?.snapshotId !== command.expectedActiveSnapshotId) {
            throw new Error(`Override command expected active snapshot ${command.expectedActiveSnapshotId}, found ${active?.snapshotId ?? 'none'}`)
        }
        await this.assertCandidate(command)

        const status = command.action === 'propose' ? 'proposed' : command.action === 'approve' ? 'approved' : 'rejected'
        const eventId = `${command.issuedAt}#${command.commandId}`
        const event: OverrideEvent = {
            recordKey: `OVERRIDE#${command.pricingKey}`,
            sortKey: eventId,
            ...command,
            payloadHash,
            status,
        }
        await this.dynamo.transactWrite({
            operations: [
                {
                    type: 'put',
                    tableName: this.auditTable,
                    item: { ...event, recordKey: `COMMAND#${command.commandId}`, sortKey: 'COMMAND' },
                    conditionExpression: 'attribute_not_exists(#recordKey)',
                    expressionAttributeNames: { '#recordKey': 'recordKey' },
                },
                {
                    type: 'put',
                    tableName: this.auditTable,
                    item: event,
                    conditionExpression: 'attribute_not_exists(#recordKey)',
                    expressionAttributeNames: { '#recordKey': 'recordKey' },
                },
            ],
            logConditionalCheckFailures: false,
            origin: 'model-pricing.override-command',
        })
        return { eventId, status, idempotent: false }
    }

    private verifySignature(command: PricingOverrideCommand): void {
        if (!this.operatorPublicKeys.has(command.actorKeyId)) throw new Error('Override command actor is not an authorized operator key')
        const verified = fromPublic(command.actorKeyId).verify(
            new TextEncoder().encode(canonicalize(commandPayload(command))),
            decodeBase64Url(command.signature),
        )
        if (!verified) throw new Error('Override command signature is invalid')
    }

    private verifyFreshness(command: PricingOverrideCommand): void {
        const issuedAt = Date.parse(command.issuedAt)
        const expiresAt = Date.parse(command.expiresAt)
        const now = Date.now()
        if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error('Override command timestamps are invalid')
        if (issuedAt > now + 60_000 || expiresAt < now || expiresAt - issuedAt > 10 * 60_000) throw new Error('Override command is outside its allowed ten-minute validity window')
    }

    private async assertCandidate(command: PricingOverrideCommand): Promise<void> {
        const hold = await this.storage.getCurrentHold(command.pricingKey)
        if (hold?.candidateHash !== command.candidateHash) throw new Error('Override command is not bound to the current held candidate')

        if (command.action === 'propose') return
        const events = await this.dynamo.queryItems({
            tableName: this.auditTable,
            keyConditions: { recordKey: `OVERRIDE#${command.pricingKey}` },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.override-proposal',
        })
        // Bind strictly to the referenced proposal event, not merely to "some"
        // proposal sharing this candidate hash - otherwise a later, never-approved
        // proposal for the same still-held hash could silently inherit an earlier
        // approval (see PricingStorage.getApprovedOverride).
        const proposal = ((events?.items ?? []) as OverrideEvent[])
            .find(event => event.sortKey === command.proposalEventId && event.status === 'proposed')
        if (!proposal) throw new Error('Override approval or rejection must reference an existing proposal event id')
        if (proposal.candidateHash !== command.candidateHash) {
            throw new Error('Override command candidate hash does not match its referenced proposal')
        }
        if (command.action === 'approve' && proposal.actorKeyId === command.actorKeyId) {
            throw new Error('Override approval must be signed by a different operator key than its proposal')
        }
    }
}
