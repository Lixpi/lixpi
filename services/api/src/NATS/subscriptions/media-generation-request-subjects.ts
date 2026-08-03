'use strict'

import { getMediaGenerationUserEventSubject, NATS_SUBJECTS } from '@lixpi/constants'

import MediaGenerationRequestModel from '../../models/media-generation-request.ts'
import { resumeAiInteractionMediaGenerationRequest } from './ai-interaction-subjects.ts'
import { ProviderVerificationCoordinator } from '../../llm/media-identity/provider-verification-coordinator.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import { MediaGenerationRequestEventLog } from '../../services/media-generation-request-event-log.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'

const REQUEST = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST
const liveSubjectFor = (userId: string, workspaceId: string, generationRequestId: string): string => [
    getMediaGenerationUserEventSubject(userId, REQUEST.STATUS),
    workspaceId.replace(/[^A-Za-z0-9_-]/gu, '_'),
    generationRequestId.replace(/[^A-Za-z0-9_-]/gu, '_'),
].join('.')

export const mediaGenerationRequestSubjects = [
    {
        subject: REQUEST.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.GET] }, sub: { allow: [`${REQUEST.STATUS}.{userIdToken}.>`] } },
        handler: async (data: any) => {
            const request = await MediaGenerationRequestModel.getAuthorized({
                generationRequestId: data.generationRequestId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
                requiredAccess: 'read',
            })
            if ('error' in request) return request
            const checkpoint = data.includeCheckpoint === false
                || request.status === 'completed'
                || request.status === 'cancelled'
                ? undefined
                : await new MediaGenerationRequestService().getCheckpoint(request)
            return {
                request,
                ...(checkpoint ? { checkpoint } : {}),
                liveSubject: liveSubjectFor(data.user.userId, data.workspaceId, data.generationRequestId),
            }
        },
    },
    {
        subject: REQUEST.REPLAY,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.REPLAY] }, sub: { allow: [`${REQUEST.STATUS}.{userIdToken}.>`] } },
        handler: async (data: any) => {
            const request = await MediaGenerationRequestModel.getAuthorized({
                generationRequestId: data.generationRequestId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
                requiredAccess: 'read',
            })
            if ('error' in request) return request
            const replay = await MediaGenerationRequestEventLog.fromSingleton().replay({
                workspaceId: data.workspaceId,
                generationRequestId: data.generationRequestId,
                startStreamSequence: data.startStreamSequence,
                maxMessages: data.maxMessages,
            })
            return {
                request,
                liveSubject: liveSubjectFor(data.user.userId, data.workspaceId, data.generationRequestId),
                replay,
            }
        },
    },
    {
        subject: REQUEST.RESOLVE_REFERENCE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.RESOLVE_REFERENCE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const request = await new MediaGenerationRequestService().resolveReference({
                generationRequestId: data.generationRequestId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
                requestRevision: data.requestRevision,
                bindingId: data.bindingId,
                assetId: data.assetId,
                requester: await getAssetRequesterContext(data.user.userId),
            })
            if (request.unresolvedBindings.length === 0) {
                await resumeAiInteractionMediaGenerationRequest({ request, user: data.user })
            }
            return request
        },
    },
    {
        subject: REQUEST.CANCEL,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.CANCEL] }, sub: { allow: [] } },
        handler: async (data: any) => await new MediaGenerationRequestService().cancel({
            generationRequestId: data.generationRequestId,
            workspaceId: data.workspaceId,
            userId: data.user.userId,
            requestRevision: data.requestRevision,
        }),
    },
    {
        subject: REQUEST.VERIFICATION_START,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.VERIFICATION_START] }, sub: { allow: [] } },
        handler: async (data: any) => await new ProviderVerificationCoordinator().start({
            generationRequestId: data.generationRequestId,
            workspaceId: data.workspaceId,
            userId: data.user.userId,
            requestRevision: data.requestRevision,
            generationRun: data.generationRun,
            assetId: data.assetId,
            requester: await getAssetRequesterContext(data.user.userId),
        }),
    },
    {
        subject: REQUEST.VERIFICATION_COMPLETE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [REQUEST.VERIFICATION_COMPLETE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const request = await new ProviderVerificationCoordinator().complete({
                stateToken: data.state,
                resultToken: data.resultToken,
                userId: data.user.userId,
                requester: await getAssetRequesterContext(data.user.userId),
            })
            if (request.status === 'submitted') {
                await resumeAiInteractionMediaGenerationRequest({ request, user: data.user })
            }
            return request
        },
    },
]
