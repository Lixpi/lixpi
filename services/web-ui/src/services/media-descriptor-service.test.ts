'use strict'

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { describeMedia, describeText } from './media-descriptor-service.ts'

const { MEDIA_DESCRIBE } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

vi.mock('$src/services/auth-service.ts', () => ({
    default: { getTokenSilently: vi.fn() },
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: { getData: vi.fn() },
}))

function mockNatsRequest(response: unknown) {
    const request = vi.fn().mockResolvedValue(response)
    servicesStore.getData.mockReturnValue({ request } as never)
    return request
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AuthService.getTokenSilently).mockResolvedValue('token-1')
    servicesStore.getData.mockReturnValue(undefined as never)
})

describe('media-descriptor-service', () => {
    describe('describeMedia', () => {
        it('returns OFFLINE when the NATS service is missing', async () => {
            const result = await describeMedia({
                workspaceId: 'workspace-1',
                fileId: 'file-image-1',
            })

            expect(result).toEqual({ error: 'OFFLINE' })
            expect(servicesStore.getData).toHaveBeenCalledWith('nats')
            expect(AuthService.getTokenSilently).not.toHaveBeenCalled()
        })

        it('requests MEDIA_DESCRIBE with file ids and token for image descriptors', async () => {
            const request = mockNatsRequest({ summary: 'an image of a robot', entityTags: ['robot'] })
            const result = await describeMedia({
                workspaceId: 'workspace-1',
                fileId: 'file-image-1',
                aiModel: 'vision-v2',
            })

            expect(result).toEqual({ summary: 'an image of a robot', entityTags: ['robot'] })
            expect(request).toHaveBeenCalledTimes(1)
            expect(request).toHaveBeenCalledWith(MEDIA_DESCRIBE, {
                token: 'token-1',
                workspaceId: 'workspace-1',
                fileId: 'file-image-1',
                aiModel: 'vision-v2',
            })
        })

        it('omits an aiModel field when no aiModel is supplied', async () => {
            const request = mockNatsRequest({ summary: 'no model hint needed' })

            await describeMedia({
                workspaceId: 'workspace-1',
                fileId: 'file-image-2',
            })

            const payload = request.mock.calls[0]?.[1] as Record<string, unknown>
            expect(payload?.aiModel).toBeUndefined()
        })
    })

    describe('describeText', () => {
        it('returns OFFLINE when the NATS service is missing', async () => {
            const result = await describeText({
                workspaceId: 'workspace-1',
                text: 'A document about robots',
                title: 'Robot Notes',
                aiModel: 'text-v2',
            })

            expect(result).toEqual({ error: 'OFFLINE' })
            expect(AuthService.getTokenSilently).not.toHaveBeenCalled()
        })

        it('requests MEDIA_DESCRIBE with text payloads', async () => {
            const request = mockNatsRequest({ summary: 'robot design doc', styleTags: ['technical'] })

            const result = await describeText({
                workspaceId: 'workspace-1',
                text: 'A document about robots',
                title: 'Robot Notes',
                aiModel: 'text-v2',
            })

            expect(result).toEqual({ summary: 'robot design doc', styleTags: ['technical'] })
            expect(request).toHaveBeenCalledTimes(1)
            expect(request).toHaveBeenCalledWith(MEDIA_DESCRIBE, {
                token: 'token-1',
                workspaceId: 'workspace-1',
                text: 'A document about robots',
                title: 'Robot Notes',
                aiModel: 'text-v2',
            })
        })
    })
})
