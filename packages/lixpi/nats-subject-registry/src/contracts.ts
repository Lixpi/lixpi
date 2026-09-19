import { NATS_SUBJECTS } from '@lixpi/constants'
import { contracts as user } from './subjects/user.ts'
import { contracts as membership } from './subjects/organization-membership.ts'
import { contracts as models } from './subjects/ai-model.ts'
import { contracts as chat } from './subjects/ai-interaction.ts'
import { contracts as generation } from './subjects/media-generation-request.ts'
import { contracts as descriptor } from './subjects/media-descriptor.ts'
import { contracts as workspace } from './subjects/workspace.ts'
import { contracts as asset } from './subjects/asset.ts'
import { contracts as capability } from './subjects/capability.ts'
import { contracts as references } from './subjects/prompt-reference.ts'
import {
    type SubjectPermissions,
    type EndpointContract,
} from './types.ts'

export const activeContractGroups = {
    user,
    'organization-membership': membership,
    'ai-model': models,
    'ai-interaction': chat,
    'media-generation-request': generation,
    'media-descriptor': descriptor,
    workspace,
    asset,
    capability,
    'prompt-reference': references,
} as const

export type ContractGroup = keyof typeof activeContractGroups

export const portalPermissions: SubjectPermissions = {
    pub: { allow: [NATS_SUBJECTS.PORTAL_MODULE_SUBJECTS.USER_REQUESTS] },
    sub: { allow: [NATS_SUBJECTS.PORTAL_MODULE_SUBJECTS.USER_EVENTS] },
}

export const validateContracts = (
    contracts: readonly EndpointContract[],
    extensions: readonly SubjectPermissions[] = [],
): void => {
    const ids = new Set<string>()
    const subjects = new Set<string>()
    const validateSubject = (subject: string): void => {
        const expanded = subject.replaceAll('{userIdToken}', 'identity').replaceAll('{userId}', 'identity')
        const tokens = expanded.split('.')

        if (
            !expanded
            || /[\s{}]/u.test(expanded)
            || tokens.some(
                (token, index) =>
                    !token || (token.includes('>') && (token !== '>' || index !== tokens.length - 1)) || (token.includes('*') && token !== '*'),
            )
        )
            throw new Error(`Invalid NATS subject template: ${subject}`)
    }

    for (const contract of contracts) {
        if (
            !contract.id
            || ids.has(contract.id)
            || subjects.has(contract.subject)
        )
            throw new Error(`Duplicate or missing endpoint: ${contract.id}`)

        ids.add(contract.id)
        subjects.add(contract.subject)
        validateSubject(contract.subject)

        if (contract.permissions === 'none')
            continue

        if (
            !contract.permissions
            || (!contract.permissions.pub && !contract.permissions.sub)
        )
            throw new Error(`Missing explicit permissions: ${contract.id}`)
    }

    const policies = [...contracts.flatMap(contract => (contract.permissions === 'none' ? [] : [contract.permissions])), ...extensions]

    for (const policy of policies) {
        for (const subject of [...(policy.pub?.allow ?? []), ...(policy.sub?.allow ?? [])]) {
            validateSubject(subject)

            if (subject.startsWith('_INBOX.'))
                throw new Error('Browser inbox permissions belong to the identity resolver')
        }
    }
}

export const activeContracts: readonly EndpointContract[] = Object.values(activeContractGroups).flat()
validateContracts(activeContracts, [portalPermissions])

export const permissionTemplates = [
    ...activeContracts.flatMap(contract => contract.permissions === 'none' ? [] : [contract.permissions]),
    portalPermissions,
].map(
    policy => ({
        ...(policy.pub ? { pub: { allow: [...policy.pub.allow] } } : {}),
        ...(policy.sub ? { sub: { allow: [...policy.sub.allow] } } : {}),
    }),
)
