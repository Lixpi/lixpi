import * as process from 'node:process'
import { createHash } from 'node:crypto'
import { v4 as uuid } from 'uuid'

import {
    DEFAULT_ASSET_SUBJECT_IDENTITY,
    NATS_SUBJECTS,
    getDynamoDbTableStageName,
    type Asset,
    type AssetRequesterContext,
    type AssetSubjectIdentity,
    type AssetSubjectIdentityAttestation,
    type DepictionMedium,
    type ProviderIdentityVerification,
    type SubjectIdentityClassification,
} from '@lixpi/constants'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

import AssetModel, {
    buildAssetProjectionOperations,
    canEditAssetMetadata,
    publishAssetEvent,
} from '../models/asset.ts'

const {
    ORG_NAME,
    STAGE,
} = process.env
const assetsTableName = (): string => getDynamoDbTableStageName(
    'ASSETS',
    ORG_NAME,
    STAGE,
)
const attestationsTableName = (): string => getDynamoDbTableStageName(
    'ASSET_SUBJECT_IDENTITY_ATTESTATIONS',
    ORG_NAME,
    STAGE,
)

export const ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION = 'asset-subject-identity-lineage-v1'

export const SUBJECT_IDENTITY_STATEMENT_VERSIONS: Readonly<Record<SubjectIdentityClassification, string>> = {
    unknown: 'unknown-2026-07-01',
    'no-person': 'no-person-2026-07-01',
    fictional: 'fictional-2026-07-01',
    self: 'self-2026-07-01',
    'authorized-real-person': 'authorized-real-person-2026-07-01',
}

const normalizeDescriptorText = (asset: Pick<Asset, 'descriptor'>): string => [
    asset.descriptor?.summary ?? '',
    ...(asset.descriptor?.entityTags ?? []),
    ...(asset.descriptor?.styleTags ?? []),
].join(' ').normalize('NFKC').toLocaleLowerCase('en-US')

export const deriveDepictionMedium = (asset: Pick<Asset, 'media' | 'descriptor'>): DepictionMedium => {
    const descriptor = normalizeDescriptorText(asset)

    if (/\b(?:mixed media|photomontage|collage)\b/.test(descriptor))
        return 'mixed'

    if (/\b(?:watercolou?r|oil paint|painting|gouache|acrylic)\b/.test(descriptor))
        return 'painting'

    if (/\b(?:3d|cgi|rendered|render)\b/.test(descriptor))
        return '3d-render'

    if (/\b(?:animation|animated|anime|cartoon)\b/.test(descriptor))
        return 'animation'

    if (/\b(?:illustration|drawing|sketch|ink|line art|comic)\b/.test(descriptor))
        return 'illustration'

    if (
        asset.media?.kind === 'video'
        && /\b(?:live action|camera|footage|photoreal|recorded video)\b/.test(descriptor)
    )
        return 'live-action-video'

    if (
        asset.media?.kind === 'image'
        && /\b(?:photo|photograph|camera|portrait)\b/.test(descriptor)
    )
        return 'photograph'

    return 'unknown'
}

const makeInheritedIdentityGroupId = (inputs: Asset[]): string | undefined => {
    const groups = [...new Set(
        inputs.map(asset => asset.subjectIdentity.identityGroupId).filter(Boolean),
    )]

    if (groups.length === 1)
        return groups[0]

    if (groups.length > 1)
        return undefined

    const sourceIds = inputs.map(asset => asset.assetId).sort()

    if (sourceIds.length === 0)
        return undefined

    return `subject-${createHash('sha256').update(
        sourceIds.join(':'),
    ).digest('hex').slice(0, 24)}`
}

const inheritProviderVerifications = (inputs: Asset[]): ProviderIdentityVerification[] => {
    if (inputs.length === 0)
        return []

    const verificationSets = inputs.map(
        asset =>
            asset.subjectIdentity.providerVerifications.filter(
                verification => (
                    verification.status === 'valid'
                    && verification.derivativeReuse === 'documented-lineage'
                    && (verification.expiresAt === undefined || verification.expiresAt > Date.now())
                ),
            ),
    )
    const first = verificationSets[0] ?? []

    return first.filter(
        candidate =>
            verificationSets.every(
                verifications =>
                    verifications.some(
                        verification => (
                            verification.provider === candidate.provider
                            && verification.providerAccountScope === candidate.providerAccountScope
                            && verification.subjectHandle === candidate.subjectHandle
                            && verification.policyProfileVersion === candidate.policyProfileVersion
                        ),
                    ),
            ),
    )
}

export const deriveSubjectIdentityFromLineage = (
    sourceAssets: Asset[],
    options: { generatedOutput?: boolean } = {},
): AssetSubjectIdentity => {
    const visualSources = sourceAssets.filter(asset => asset.media?.kind === 'image' || asset.media?.kind === 'video')
    const personBearingSources = visualSources.filter(asset => asset.subjectIdentity.classification !== 'no-person')

    if (personBearingSources.length === 0) {
        return options.generatedOutput
            ? {
                classification: 'fictional',
                source: 'automatic-lineage',
                inheritedFromAssetIds: visualSources.map(asset => asset.assetId),
                derivationVersion: ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION,
                providerVerifications: [],
            }
            : structuredClone(DEFAULT_ASSET_SUBJECT_IDENTITY)
    }

    const classifications = [...new Set(
        personBearingSources.map(asset => asset.subjectIdentity.classification),
    )]
    const identityGroups = [
        ...new Set(
            personBearingSources.map(asset => asset.subjectIdentity.identityGroupId).filter((value): value is string => Boolean(value)),
        ),
    ]
    const hasInvalidAttestation = personBearingSources.some(
        asset => (
            asset.subjectIdentity.classification === 'unknown'
            || (asset.subjectIdentity.source === 'user-attestation' && !asset.subjectIdentity.currentAttestationId)
        ),
    )
    const realClassification = classifications[0] === 'self' || classifications[0] === 'authorized-real-person'
    const incompatibleGroups = realClassification
        && (identityGroups.length !== 1 || personBearingSources.some(asset => !asset.subjectIdentity.identityGroupId))

    if (
        classifications.length !== 1
        || hasInvalidAttestation
        || incompatibleGroups
    ) {
        return {
            classification: 'unknown',
            source: 'inherited-lineage',
            inheritedFromAssetIds: personBearingSources.map(asset => asset.assetId),
            derivationVersion: ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION,
            providerVerifications: [],
        }
    }

    return {
        classification: classifications[0]!,
        source: 'inherited-lineage',
        ...(makeInheritedIdentityGroupId(personBearingSources)
            ? {
                identityGroupId: makeInheritedIdentityGroupId(personBearingSources),
            }
            : {}),
        inheritedFromAssetIds: personBearingSources.map(asset => asset.assetId),
        derivationVersion: ASSET_SUBJECT_IDENTITY_DERIVATION_VERSION,
        providerVerifications: inheritProviderVerifications(personBearingSources),
    }
}

export class AssetSubjectIdentityService {
    async addProviderVerification({
        assetId,
        assetRevision,
        verification,
        requester,
    }: {
        assetId: string
        assetRevision: number
        verification: ProviderIdentityVerification
        requester: AssetRequesterContext
    }): Promise<Asset | { error: string }> {
        const asset = await AssetModel.get({
            assetId,
            requester,
        })

        if ('error' in asset)
            return asset

        if (!(await canEditAssetMetadata(asset, requester)))
            return { error: 'PERMISSION_DENIED' }

        if (asset.revision !== assetRevision)
            return { error: 'REVISION_CONFLICT' }

        if (
            asset.subjectIdentity.classification !== 'self'
            && asset.subjectIdentity.classification !== 'authorized-real-person'
        )
            return { error: 'PROVIDER_VERIFICATION_IDENTITY_CLASSIFICATION_REQUIRED' }

        const now = Date.now()
        const providerVerifications = [
            ...asset.subjectIdentity.providerVerifications.filter(
                existing =>
                    !(
                        existing.provider === verification.provider
                        && existing.providerAccountScope === verification.providerAccountScope
                    ),
            ),
            verification,
        ]
        const next: Asset = {
            ...asset,
            subjectIdentity: {
                ...asset.subjectIdentity,
                providerVerifications,
            },
            revision: asset.revision + 1,
            updatedAt: now,
        }

        try {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: assetsTableName(),
                        key: { assetId },
                        updates: {
                            subjectIdentity: next.subjectIdentity,
                            revision: next.revision,
                            updatedAt: now,
                        },
                        conditionExpression: '#revision = :expectedRevision',
                        expressionAttributeNames: { '#revision': 'revision' },
                        expressionAttributeValues: { ':expectedRevision': assetRevision },
                    },
                    ...await buildAssetProjectionOperations(next),
                ],
                logConditionalCheckFailures: false,
                origin: 'AssetSubjectIdentity.addProviderVerification',
            })
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error))
                return { error: 'REVISION_CONFLICT' }

            throw error
        }

        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)

        return next
    }

    async attest({
        assetId,
        assetRevision,
        classification,
        requester,
    }: {
        assetId: string
        assetRevision: number
        classification: SubjectIdentityClassification
        requester: AssetRequesterContext
    }): Promise<Asset | { error: string }> {
        if (!Object.hasOwn(SUBJECT_IDENTITY_STATEMENT_VERSIONS, classification))
            return { error: 'INVALID_SUBJECT_IDENTITY_CLASSIFICATION' }

        const asset = await AssetModel.get({
            assetId,
            requester,
        })

        if ('error' in asset)
            return asset

        if (!(await canEditAssetMetadata(asset, requester)))
            return { error: 'PERMISSION_DENIED' }

        if (asset.revision !== assetRevision)
            return { error: 'REVISION_CONFLICT' }

        const now = Date.now()
        const attestationId = uuid()
        const nextRevision = asset.revision + 1
        const status = classification === 'unknown' ? ('revoked' as const) : ('active' as const)
        const attestation: AssetSubjectIdentityAttestation = {
            attestationId,
            assetId,
            assetRevision: nextRevision,
            organizationId: asset.organizationId,
            attestedByUserId: requester.userId,
            classification,
            statementVersion: SUBJECT_IDENTITY_STATEMENT_VERSIONS[classification],
            status,
            ...(asset.subjectIdentity.currentAttestationId
                ? {
                    supersedesAttestationId: asset.subjectIdentity.currentAttestationId,
                }
                : {}),
            createdAt: now,
        }
        const subjectIdentity: AssetSubjectIdentity = {
            classification,
            source: 'user-attestation',
            ...(classification === 'self'
                || classification === 'authorized-real-person'
                ? { identityGroupId: asset.subjectIdentity.identityGroupId ?? `subject-${uuid()}` }
                : {}),
            currentAttestationId: attestationId,
            providerVerifications: classification === 'self'
                || classification === 'authorized-real-person'
                ? asset.subjectIdentity.providerVerifications
                : asset.subjectIdentity.providerVerifications.map(
                    verification => ({
                        ...verification,
                        status: 'revoked',
                    }),
                ),
        }
        const next: Asset = {
            ...asset,
            subjectIdentity,
            revision: nextRevision,
            updatedAt: now,
        }

        try {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'put',
                        tableName: attestationsTableName(),
                        item: attestation,
                        conditionExpression: 'attribute_not_exists(#attestationId)',
                        expressionAttributeNames: { '#attestationId': 'attestationId' },
                    },
                    {
                        type: 'update',
                        tableName: assetsTableName(),
                        key: { assetId },
                        updates: {
                            subjectIdentity,
                            revision: nextRevision,
                            updatedAt: now,
                        },
                        conditionExpression: '#revision = :expectedRevision',
                        expressionAttributeNames: { '#revision': 'revision' },
                        expressionAttributeValues: { ':expectedRevision': assetRevision },
                    },
                    ...await buildAssetProjectionOperations(next),
                ],
                logConditionalCheckFailures: false,
                origin: 'AssetSubjectIdentity.attest',
            })
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error))
                return { error: 'REVISION_CONFLICT' }

            throw error
        }

        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)

        return next
    }

    async listAttestations(
        assetId: string,
        requester: AssetRequesterContext,
    ): Promise<AssetSubjectIdentityAttestation[] | { error: string }> {
        const asset = await AssetModel.get({
            assetId,
            requester,
        })

        if ('error' in asset)
            return asset

        const result = await dynamoDBService.queryItems({
            tableName: attestationsTableName(),
            keyConditions: { assetId },
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'AssetSubjectIdentity.listAttestations',
        })

        return (result?.items ?? []) as AssetSubjectIdentityAttestation[]
    }
}

export default AssetSubjectIdentityService
