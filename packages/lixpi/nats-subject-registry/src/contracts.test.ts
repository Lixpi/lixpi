import {
    describe,
    expect,
    it,
} from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    activeContracts,
    permissionTemplates,
    portalPermissions,
    validateContracts,
} from './contracts.ts'
import {
    type EndpointContract,
} from './types.ts'

const {
    AI_INTERACTION_SUBJECTS,
    AI_MODELS_SUBJECTS,
    ASSET_SUBJECTS,
    CAPABILITY_SUBJECTS,
    ORGANIZATION_SUBJECTS,
    PORTAL_MODULE_SUBJECTS,
    PROMPT_REFERENCE_SUBJECTS,
    USER_SUBJECTS,
} = NATS_SUBJECTS
const endpoint = (subject: string) => {
    const contract = activeContracts.find(candidate => candidate.subject === subject)

    if (!contract)
        throw new Error(`Missing endpoint: ${subject}`)

    return contract
}
const publications = permissionTemplates.flatMap(permissions => permissions.pub?.allow ?? [])
const subscriptions = permissionTemplates.flatMap(permissions => permissions.sub?.allow ?? [])

describe('endpoint permissions', () => {
    it('grants a public request its own subject', () => {
        expect(endpoint(USER_SUBJECTS.GET_USER)).toMatchObject({
            type: 'reply',
            payloadType: 'json',
            permissions: {
                pub: { allow: [USER_SUBJECTS.GET_USER] },
                sub: { allow: [] },
            },
        })
        expect(publications).toContain(USER_SUBJECTS.GET_USER)
    })

    it('keeps service-only and inactive endpoints out of user permissions', () => {
        expect(endpoint(ORGANIZATION_SUBJECTS.GET_MEMBERSHIP).permissions).toBe('none')
        expect(endpoint(PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE).permissions).toEqual({
            pub: { allow: [] },
            sub: { allow: [] },
        })

        for (const subject of [ORGANIZATION_SUBJECTS.GET_MEMBERSHIP, PROMPT_REFERENCE_SUBJECTS.RECORD_ACCEPTED_USE, ORGANIZATION_SUBJECTS.GET_ORGANIZATION]) {
            expect(publications).not.toContain(subject)
            expect(subscriptions).not.toContain(subject)
        }

        expect(activeContracts.some(contract => contract.subject === ORGANIZATION_SUBJECTS.GET_ORGANIZATION)).toBe(false)
    })

    it('grants model-sync subscription without publication', () => {
        const subject = AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED
        expect(endpoint(subject)).toMatchObject({
            type: 'subscribe',
            permissions: { sub: { allow: [subject] } },
        })
        expect(endpoint(subject).permissions).not.toHaveProperty('pub')
        expect(subscriptions).toContain(subject)
        expect(publications).not.toContain(subject)
    })

    it('preserves chat interaction kinds and queue membership', () => {
        expect(endpoint(AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE)).toMatchObject({
            type: 'subscribe',
            queue: 'aiInteraction',
            permissions: {
                pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE] },
                sub: { allow: [
                    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.{userIdToken}.>`,
                    `${AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.STATUS}.{userIdToken}.>`,
                ] },
            },
        })

        for (const subject of [AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME, AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE])
            expect(endpoint(subject)).toMatchObject({
                type: 'reply',
                queue: 'aiInteraction',
            })
    })

    it('scopes Asset events to the user and keeps document requests queued', () => {
        expect(endpoint(ASSET_SUBJECTS.GET).permissions).toEqual({
            pub: { allow: [ASSET_SUBJECTS.GET] },
            sub: { allow: [
                `${ASSET_SUBJECTS.EVENTS.CREATED}.{userIdToken}`,
                `${ASSET_SUBJECTS.EVENTS.UPDATED}.{userIdToken}`,
                `${ASSET_SUBJECTS.EVENTS.DELETED}.{userIdToken}`,
                `${ASSET_SUBJECTS.EVENTS.RENDITION_UPDATED}.{userIdToken}`,
            ] },
        })
        expect(endpoint(ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS).queue).toBe('assetDocumentSteps')
        expect(endpoint(ASSET_SUBJECTS.DOCUMENT_RESUME)).toMatchObject({
            queue: 'assetDocumentSteps',
            permissions: { sub: { allow: [`${ASSET_SUBJECTS.DOCUMENT_EVENTS}.{userIdToken}.>`] } },
        })
    })

    it('scopes generation and Capability status subscriptions to the user', () => {
        const request = AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST

        for (const subject of [request.GET, request.REPLAY])
            expect(endpoint(subject).permissions).toEqual({
                pub: { allow: [subject] },
                sub: { allow: [`${request.STATUS}.{userIdToken}.>`] },
            })

        expect(endpoint(CAPABILITY_SUBJECTS.RUN.RESUME).permissions).toEqual({
            pub: { allow: [CAPABILITY_SUBJECTS.RUN.RESUME] },
            sub: { allow: [`${CAPABILITY_SUBJECTS.RUN.STATUS}.{userIdToken}.>`] },
        })
    })

    it('includes portal permissions without inventing an API handler or inbox grant', () => {
        expect(portalPermissions).toEqual({
            pub: { allow: [PORTAL_MODULE_SUBJECTS.USER_REQUESTS] },
            sub: { allow: [PORTAL_MODULE_SUBJECTS.USER_EVENTS] },
        })
        expect(publications).toContain(PORTAL_MODULE_SUBJECTS.USER_REQUESTS)
        expect(subscriptions).toContain(PORTAL_MODULE_SUBJECTS.USER_EVENTS)
        expect(activeContracts.some(contract => contract.subject === PORTAL_MODULE_SUBJECTS.USER_REQUESTS)).toBe(false)
        expect([...publications, ...subscriptions].some(subject => subject.startsWith('_INBOX.'))).toBe(false)
    })

    it('derives every endpoint identifier from its subject in constants', () => {
        for (const contract of activeContracts) {
            const subject = contract.id.split('.').reduce<any>((value, name) => value[name], NATS_SUBJECTS)
            expect(subject).toBe(contract.subject)
        }
    })

    it('rejects duplicate IDs and duplicate subjects independently', () => {
        const first = activeContracts[0]
        const second = activeContracts[1]
        expect(() => validateContracts([first, {
            ...second,
            id: first.id,
        }])).toThrow('Duplicate')
        expect(() => validateContracts([first, {
            ...second,
            subject: first.subject,
        }])).toThrow('Duplicate')
    })

    it.each([
        { permissions: undefined },
        { permissions: {} },
        { permissions: { pub: { allow: ['a.{unknown}'] } } },
        { subject: 'a.>.b' },
        { permissions: { sub: { allow: ['_INBOX.>'] } } },
    ])('rejects invalid or implicit permissions: %j', override =>
        expect(() => validateContracts([{
            ...activeContracts[0],
            ...override,
        } as EndpointContract])).toThrow())

    it('validates permission-only extensions', () =>
        expect(() => validateContracts([], [{ pub: { allow: ['portal.{unknown}.>'] } }])).toThrow('template'))
})
