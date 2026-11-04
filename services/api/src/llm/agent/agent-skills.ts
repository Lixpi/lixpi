import {
    type CapabilityModuleCatalog,
} from '@lixpi/capability-system/backend'
import { DynamicStructuredTool } from '@langchain/core/tools'
import {
    getAuthorizedCapabilityRecords,
    readAuthorizedCapabilityManifestSnapshot,
    readAuthorizedCapabilityResourceSnapshot,
} from '../../models/capability.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

type SkillSnapshot = {
    payload: AgentPayload
    capabilityIds: string[]
}

export class AgentSkills {
    constructor(
        private readonly catalog: CapabilityModuleCatalog,
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
    ) {}

    async load(owner: ConversationOwner): Promise<ReadonlyMap<string, string>> {
        const run = (await owner.read()).run

        if (!run)
            throw new Error('AGENT_RUN_MISSING')

        const key = `SKILLS#${run.turnId}`
        const saved = await this.repository.read<SkillSnapshot>(owner.partition, key)

        if (saved) {
            await this.authorize(owner, saved.capabilityIds)
            const entries = JSON.parse(
                Buffer.from(await this.payloads.read(saved.payload)).toString('utf8'),
            ) as Array<[string, string]>

            return new Map(entries)
        }

        const skills = this.catalog.listModuleIds().flatMap(moduleId => {
            const module = this.catalog.getModule(moduleId)!

            return module.agentTools?.length ? module.skills.map(
                skill => ({
                    moduleId,
                    capabilityId: skill.capabilityId,
                    bundle: skill.agentSkill,
                }),
            ) : []
        })
        const requester = {
            userId: owner.job.userId,
            organizationIds: [owner.job.organizationId],
        }
        const records = await getAuthorizedCapabilityRecords({
            capabilityIds: skills.map(skill => skill.capabilityId),
            requester,
        })
        const files = new Map<string, string>()
        const names = new Set<string>()
        let byteSize = 0

        for (const skill of skills) {
            const record = records.get(skill.capabilityId)

            if (!record)
                continue

            const invalid = (reason: string): never => {
                throw new Error(`AGENT_SKILL_INVALID:${skill.capabilityId.slice(0, 128)}:${reason}`)
            }
            const bundle = skill.bundle

            if (!bundle)
                invalid('MISSING_FILE_MAP')

            if (
                !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(bundle.name)
                || bundle.name.length > 64
            )
                invalid('INVALID_NAME')

            if (names.has(bundle.name))
                invalid('DUPLICATE_NAME')

            names.add(bundle.name)
            const { manifest } = await readAuthorizedCapabilityManifestSnapshot({
                record,
                requester,
            })

            const root = `/skills/${encodeURIComponent(skill.capabilityId)}/${bundle.name}/`
            const paths = Object.values(bundle.files)
            const resourceIds = new Set(
                manifest.resources.map(resource => resource.resourceId),
            )

            if (
                paths.filter(path => path === 'SKILL.md').length !== 1
                || new Set(paths).size !== paths.length
                || resourceIds.size !== paths.length
                || Object.keys(bundle.files).some(id => !resourceIds.has(id))
            )
                invalid('INCOMPLETE_FILE_MAP')

            for (const resource of manifest.resources) {
                const relativePath = bundle.files[resource.resourceId]

                if (
                    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(relativePath)
                    || relativePath.split('/').some(segment => segment === '.' || segment === '..')
                    || root.length + relativePath.length > 512
                    || relativePath.endsWith('/SKILL.md')
                )
                    invalid('INVALID_RESOURCE_PATH')

                if (
                    !resource.mediaType.startsWith('text/')
                    && !['application/json', 'application/schema+json'].includes(resource.mediaType)
                )
                    invalid('UNSUPPORTED_RESOURCE_TYPE')

                if (
                    relativePath === 'SKILL.md'
                    && resource.role !== 'instructions'
                )
                    invalid('INVALID_INSTRUCTIONS_ROLE')

                const { bytes } = await readAuthorizedCapabilityResourceSnapshot({
                    record,
                    manifest,
                    resourceId: resource.resourceId,
                    requester,
                })
                byteSize += bytes.byteLength

                if (byteSize > 128_000)
                    throw new Error('AGENT_SKILL_RESOURCES_TOO_LARGE')

                let content: string

                try {
                    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
                } catch {
                    invalid('INVALID_RESOURCE_ENCODING')
                }

                files.set(`${root}${relativePath}`, content)
            }
        }

        const capabilityIds = this.capabilityIds(files)
        const prepared = await this.payloads.prepare(
            'sealed-agent-skills',
            Buffer.from(
                JSON.stringify([...files.entries()]),
            ),
            key,
        )

        try {
            await this.repository.commit([
                ...await owner.fences(run.continuationEpoch),
                this.repository.put(
                    owner.partition,
                    key,
                    {
                        payload: prepared.payload,
                        capabilityIds,
                    },
                ),
                ...prepared.operations,
            ])
        } catch (error) {
            const committed = await this.repository.read<SkillSnapshot>(owner.partition, key)

            if (committed?.payload.hash !== prepared.payload.hash)
                throw error

            await owner.fences(run.continuationEpoch)
        }

        return files
    }

    async assertCurrent(
        owner: ConversationOwner,
        files: ReadonlyMap<string, string>,
    ): Promise<void> {
        await this.authorize(
            owner,
            this.capabilityIds(files),
        )
    }

    sources(files: ReadonlyMap<string, string>): string[] {
        return [...files.keys()].filter(path => path.endsWith('/SKILL.md')).map(path => path.slice(0, -'SKILL.md'.length))
    }

    private capabilityIds(files: ReadonlyMap<string, string>): string[] {
        return [...new Set(
            [...files.keys()].map(path => decodeURIComponent(path.split('/')[2])),
        )]
    }

    private async authorize(
        owner: ConversationOwner,
        capabilityIds: string[],
    ): Promise<void> {
        await owner.fences()
        const installed = new Set(
            this.catalog.listModuleIds().flatMap(moduleId => {
                const module = this.catalog.getModule(moduleId)!

                return module.agentTools?.length ? module.skills.map(skill => skill.capabilityId) : []
            }),
        )
        const records = await getAuthorizedCapabilityRecords({
            capabilityIds,
            requester: {
                userId: owner.job.userId,
                organizationIds: [owner.job.organizationId],
            },
        })

        if (capabilityIds.some(id => !installed.has(id) || !records.has(id)))
            throw new Error('AGENT_CAPABILITY_UNAVAILABLE')
    }

    tools(
        owner: ConversationOwner,
        files: ReadonlyMap<string, string>,
    ): DynamicStructuredTool[] {
        const installed = [...files.entries()].filter(([path]) => path.endsWith('/SKILL.md')).map(
            ([path, instructions]) => ({
                capabilityId: decodeURIComponent(path.split('/')[2]),
                path,
                instructions,
            }),
        )

        return [
            new DynamicStructuredTool({
                name: 'search_capabilities',
                description: 'Find installed, sealed Capability Skills available to this conversation. This reads their descriptions and does not execute work.',
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { query: {
                        type: 'string',
                        maxLength: 200,
                    } },
                },
                func: async ({ query = '' }: { query?: string }) => {
                    await this.assertCurrent(owner, files)
                    const words = query.toLowerCase().trim().split(/\s+/u).filter(Boolean)
                    const matches = installed.filter(
                        skill => words.every(word => `${skill.capabilityId} ${skill.instructions}`.toLowerCase().includes(word)),
                    )

                    return JSON.stringify({
                        status: 'succeeded',
                        data: matches.map(
                            skill => ({
                                capabilityId: skill.capabilityId,
                                path: skill.path,
                            }),
                        ),
                    })
                },
            }),
            new DynamicStructuredTool({
                name: 'use_capability',
                description: 'Load a sealed installed Capability Skill to guide the requested task. Follow its typed tools within the accepted user instruction. Reading a Skill never grants a mutation or starts generation.',
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['capabilityId'],
                    properties: { capabilityId: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 128,
                    } },
                },
                func: async ({ capabilityId }: { capabilityId: string }) => {
                    await this.assertCurrent(owner, files)
                    const skill = installed.find(item => item.capabilityId === capabilityId)

                    if (!skill)
                        return JSON.stringify({
                            status: 'failed',
                            error: {
                                code: 'AGENT_CAPABILITY_UNAVAILABLE',
                                recoverable: true,
                            },
                        })

                    return JSON.stringify({
                        status: 'succeeded',
                        data: skill,
                    })
                },
            }),
        ]
    }
}
