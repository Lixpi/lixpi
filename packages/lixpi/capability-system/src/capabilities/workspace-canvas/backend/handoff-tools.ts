import {
    type ConversationHumanAction,
} from '@lixpi/constants'
import {
    type CapabilityAgentRegistration,
} from '../../../backend/capability-agent-registry.ts'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'
import { WORKSPACE_CANVAS_OPERATION } from './canvas-agent-tools.ts'

export type CanvasHandoffRequest =
    | { kind: 'file' }
    | {
        kind: 'download'
        assetId: string
        rendition: 'original' | 'canonical' | 'preview'
    }
    | { kind: 'workspace-export' }
    | {
        kind: 'attestation'
        assetId: string
        classification: 'self' | 'authorized-real-person'
    }
    | {
        kind: 'provider-verification'
        assetId: string
        generationRequestId: string
        generationRun: number
    }

export type CanvasHandoffAccess = (
    context: CapabilityActionAuthorizationContext,
    request: CanvasHandoffRequest,
) => Promise<ConversationHumanAction>

const schemas = {
    download_canvas_media: {
        type: 'object',
        additionalProperties: false,
        required: ['assetId', 'rendition'],
        properties: {
            assetId: {
                type: 'string',
                minLength: 1,
                maxLength: 192,
            },
            rendition: {
                type: 'string',
                enum: ['original', 'canonical', 'preview'],
            },
        },
    },
    export_canvas_workspace: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    request_canvas_file: {
        type: 'object',
        additionalProperties: false,
        properties: {},
    },
    request_canvas_identity_attestation: {
        type: 'object',
        additionalProperties: false,
        required: ['assetId', 'classification'],
        properties: {
            assetId: {
                type: 'string',
                minLength: 1,
                maxLength: 192,
            },
            classification: {
                type: 'string',
                enum: ['self', 'authorized-real-person'],
            },
        },
    },
    request_canvas_provider_verification: {
        type: 'object',
        additionalProperties: false,
        required: ['assetId', 'generationRequestId', 'generationRun'],
        properties: {
            assetId: {
                type: 'string',
                minLength: 1,
                maxLength: 192,
            },
            generationRequestId: {
                type: 'string',
                minLength: 1,
                maxLength: 192,
            },
            generationRun: {
                type: 'integer',
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
            },
        },
    },
}

const instructions = {
    download_canvas_media: 'Offer the requesting person a download of an authorized media Asset and rendition. They start the download on their device. The tool confirms that they requested the download.',
    export_canvas_workspace: 'Offer the requesting person the authorized export of the active workspace as a ZIP file. They start the download on their device.',
    request_canvas_file: 'Ask the requesting person to select a local file for this workspace. The conversation pauses until their upload succeeds. After resuming, use the returned Asset ID to continue the requested canvas work.',
    request_canvas_identity_attestation: 'Ask the requesting person to confirm that an image or video depicts them or someone who authorized its use. Supply the known Asset and requested classification. The tool waits for the person to submit the official attestation.',
    request_canvas_provider_verification: 'Ask the requesting person to complete the verification required by a workspace generation run. Use the run and Asset identified by the generation status. The tool resumes after the provider confirms verification.',
}

const questions = {
    download: 'Download the requested media.',
    'workspace-export': 'Download the workspace export.',
    file: 'Choose a file to continue.',
    attestation: 'Confirm the subject identity to continue.',
    'provider-verification': 'Complete the required provider verification to continue.',
}

const names = Object.keys(schemas) as Array<keyof typeof schemas>

export const createCanvasHandoffAgentTools = (access: CanvasHandoffAccess): CapabilityAgentRegistration[] =>
    names.map(
        name => ({
            kind: 'tool',
            name,
            description: instructions[name],
            schema: schemas[name],
            intent: 'execute',
            operationFamilies: [WORKSPACE_CANVAS_OPERATION],
            execute: async (input, context) => {
                const request: CanvasHandoffRequest = name === 'export_canvas_workspace'
                    ? { kind: 'workspace-export' }
                    : name === 'download_canvas_media'
                        ? {
                            kind: 'download',
                            assetId: input.assetId as string,
                            rendition: input.rendition as 'original' | 'canonical' | 'preview',
                        }
                        : name === 'request_canvas_file'
                            ? { kind: 'file' }
                            : name === 'request_canvas_identity_attestation'
                                ? {
                                    kind: 'attestation',
                                    assetId: input.assetId as string,
                                    classification: input.classification as 'self' | 'authorized-real-person',
                                }
                                : {
                                    kind: 'provider-verification',
                                    assetId: input.assetId as string,
                                    generationRequestId: input.generationRequestId as string,
                                    generationRun: input.generationRun as number,
                                }
                const humanAction = await access(context, request)

                return {
                    status: 'input-required',
                    question: questions[request.kind],
                    humanAction,
                }
            },
        }),
    )
