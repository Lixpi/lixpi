import { describe, expect, it } from 'vitest'

import {
    ASSET_PROSEMIRROR_STEP_SUBJECT_PREFIX,
    getAssetStepSubject,
    getOrganizationAssetStepStreamName,
    getOrganizationAssetStepStreamSubject,
} from './transport-types.ts'

describe('stream name sanitization', () => {
    it('replaces illegal characters in organization IDs', () => {
        expect(getOrganizationAssetStepStreamName('organization/one two')).toBe('ASSET_STEPS_organization_one_two')
        expect(getOrganizationAssetStepStreamName('org!@#')).toBe('ASSET_STEPS_org___')
    })
})

describe('organization subject sanitization', () => {
    it('normalizes wildcard subjects for subscriptions', () => {
        expect(getOrganizationAssetStepStreamSubject('organization/one two')).toBe(
            `${ASSET_PROSEMIRROR_STEP_SUBJECT_PREFIX}.organization_one_two.>`,
        )
    })
})

describe('asset document subject composition', () => {
    it('normalizes organization and asset coordinates consistently', () => {
        const subject = getAssetStepSubject({
            organizationId: 'org/one two',
            assetId: 'asset:1/2',
            role: 'conversation',
        })
        expect(subject).toBe('asset.document.steps.org_one_two.asset_1_2.conversation')
    })

    it('uses the shared Capability Artifact document role', () => {
        expect(getAssetStepSubject({
            organizationId: 'organization-1',
            assetId: 'artifact-1',
            role: 'capabilityArtifact',
        })).toBe('asset.document.steps.organization-1.artifact-1.capabilityArtifact')
    })
})
