import { createHash } from 'node:crypto'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { builtInPermissions } from './service-permissions.ts'
import {
    authPolicy,
    createPolicyArtifact,
    serializePolicyArtifact,
} from './policy.ts'

describe('application permission declarations', () => {
    it('exports deterministic complete policy with a verifiable digest', () => {
        const artifact = JSON.parse(serializePolicyArtifact())
        expect(serializePolicyArtifact()).toBe(serializePolicyArtifact())
        expect(artifact.digest).toBe(createHash('sha256').update(JSON.stringify(artifact.policy)).digest('hex'))
        expect(Object.fromEntries(artifact.policy.services.map(service => [service.name, service.permissions]))).toEqual(builtInPermissions)
        expect(artifact.policy).not.toHaveProperty('subjects')
        expect(artifact.policy).not.toHaveProperty('workerPermissions')
    })

    it('changes the digest for service and browser permission changes', () => {
        const baseline = createPolicyArtifact().digest
        const serviceChange = structuredClone(authPolicy)
        serviceChange.services[0].permissions.pub.allow.push('changed.service.permission')
        expect(createPolicyArtifact(serviceChange).digest).not.toBe(baseline)
        const browserChange = structuredClone(authPolicy)
        browserChange.browser.push({ pub: { allow: ['changed.browser.permission'] } })
        expect(createPolicyArtifact(browserChange).digest).not.toBe(baseline)
    })

    it('excludes transport worker grants from browsers', () => {
        expect(authPolicy.browser.flatMap(policy => [...(policy.pub?.allow ?? []), ...(policy.sub?.allow ?? [])])
            .some(subject => subject.startsWith('$TRANSPORT.'))).toBe(false)
    })
})
