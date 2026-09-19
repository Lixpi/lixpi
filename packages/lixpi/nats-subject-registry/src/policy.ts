import { createHash } from 'node:crypto'
import {
    activeContracts,
    permissionTemplates,
} from './contracts.ts'
import { builtInPermissions } from './service-permissions.ts'

export const policySchemaVersion = 3

export const authPolicy = {
    schema: policySchemaVersion,
    contracts: activeContracts,
    browser: permissionTemplates,
    services: Object.entries(builtInPermissions).map(
        ([name, permissions]) => ({
            name,
            publicKeyEnv: `NATS_${name}_NKEY_PUBLIC`,
            userId: `svc:${name.toLowerCase().replaceAll('_', '-')}`,
            account: name === 'NEX_NODE' ? 'NEX' : 'AUTH',
            required: ['API', 'FILE_CONVERSION', 'CHARACTER_FIDELITY', 'BACKUP', 'OPERATOR'].includes(name),
            permissions,
        }),
    ),
}

export const createPolicyArtifact = (policy = authPolicy) => {
    const serialized = JSON.stringify(policy)

    return {
        schema: policySchemaVersion,
        digest: createHash('sha256').update(serialized).digest('hex'),
        policy,
    }
}

export const policyDigest = createPolicyArtifact().digest

export const serializePolicyArtifact = (): string => `${JSON.stringify(
    createPolicyArtifact(),
)}\n`
