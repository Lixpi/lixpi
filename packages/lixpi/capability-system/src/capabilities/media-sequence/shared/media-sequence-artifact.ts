import { Schema } from 'prosemirror-model'

import {
    type CapabilityArtifactSharedDefinition,
} from '../../../shared/capability-artifact.ts'
import {
    MEDIA_SEQUENCE_ARTIFACT_TYPE_ID,
    MEDIA_SEQUENCE_SCHEMA_VERSION,
    type MediaSequence,
} from './media-sequence.ts'
import { assertMediaSequence } from './sequence-validation.ts'

export const createMediaSequenceDocument = (sequence: MediaSequence): object => {
    assertMediaSequence(sequence)

    return {
        type: 'doc',
        content: [{
            type: 'mediaSequence',
            attrs: { sequence: structuredClone(sequence) },
        }],
    }
}

export const readMediaSequenceDocument = (document: object): MediaSequence => {
    const doc = document as {
        type?: string
        content?: Array<{
            type?: string
            attrs?: { sequence?: unknown }
        }>
    }

    if (
        doc.type !== 'doc'
        || doc.content?.length !== 1
        || doc.content[0]?.type !== 'mediaSequence'
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_DOCUMENT')

    const sequence = doc.content[0].attrs?.sequence
    assertMediaSequence(sequence)

    return sequence
}

export const mediaSequenceArtifactDefinition: CapabilityArtifactSharedDefinition = {
    artifactTypeId: MEDIA_SEQUENCE_ARTIFACT_TYPE_ID,
    displayName: 'Media Sequence',
    schemaVersion: MEDIA_SEQUENCE_SCHEMA_VERSION,
    allowedEmbeddedReferenceTypes: ['media'],
    createDocumentSchema: () => new Schema({ nodes: {
        doc: { content: 'mediaSequence' },
        mediaSequence: {
            group: 'block',
            atom: true,
            attrs: { sequence: { default: null } },
            toDOM: () => ['div', { 'data-media-sequence': '' }],
        },
        text: { group: 'inline' },
    } }),
    assertInitialDocument: document => void readMediaSequenceDocument(document),
    assertEditableMutation: (previous, proposed) => {
        readMediaSequenceDocument(proposed)

        if (JSON.stringify(previous) !== JSON.stringify(proposed))
            throw new Error('MEDIA_SEQUENCE_TYPED_PATCH_REQUIRED')
    },
    collectReferencedAssetIds: document => [...new Set(
        readMediaSequenceDocument(document).sources.map(source => source.assetId),
    )],
    collectSourceReferences: document => readMediaSequenceDocument(document).sources.map(
        source => ({
            assetId: source.assetId,
            role: 'media',
            renditionId: source.renditionId,
            blobHash: source.blobHash,
        }),
    ),
    serializeForModel: document => {
        const sequence = readMediaSequenceDocument(document)

        return {
            text: JSON.stringify(sequence),
            referencedAssetIds: [...new Set(
                sequence.sources.map(source => source.assetId),
            )],
        }
    },
    buildCatalogMetadata: document => {
        const sequence = readMediaSequenceDocument(document)

        return {
            sequenceId: sequence.sequenceId,
            revision: sequence.revision,
            name: sequence.name,
            tracks: sequence.tracks.length,
            clips: sequence.clips.length,
            duration: sequence.duration,
            timeBase: sequence.timeBase,
        }
    },
}
