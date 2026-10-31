import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createSkillsMiddleware } from 'deepagents'
import { type CapabilityModuleCatalog } from '@lixpi/capability-system/backend'
import { AgentSkills } from './agent-skills.ts'
import { AgentScopedBackend } from './agent-harness.ts'
import { AgentScratchStore } from './agent-scratch-store.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const fixture = vi.hoisted(() => ({
    authorized: true,
    installed: true,
    instructions: '---\nname: test-skill\ndescription: Test sealed instructions.\n---\nUse the original sealed instructions.',
    bundle: {
        name: 'test-skill',
        files: { instructions: 'SKILL.md' },
    } as {
        name: string
        files: Record<string, string>
    } | undefined,
    companions: new Map<string, string>(),
    manifestReads: vi.fn(),
    resourceReads: vi.fn(),
}))

vi.mock('../../models/capability.ts', () => ({
    getAuthorizedCapabilityRecords: async () => new Map(fixture.authorized ? [['test-skill', { capabilityId: 'test-skill' }]] : []),
    readAuthorizedCapabilityManifestSnapshot: async () => {
        fixture.manifestReads()

        return { manifest: { resources: [{
            role: 'instructions',
            resourceId: 'instructions',
            mediaType: 'text/markdown',
        }, ...[...fixture.companions.keys()].map(resourceId => ({
            role: 'reference',
            resourceId,
            mediaType: 'text/markdown',
        }))] } }
    },
    readAuthorizedCapabilityResourceSnapshot: async ({ resourceId }: { resourceId: string }) => {
        fixture.resourceReads()

        return { bytes: Buffer.from(resourceId === 'instructions' ? fixture.instructions : fixture.companions.get(resourceId)!) }
    },
}))

const catalog = {
    listModuleIds: () => fixture.installed ? ['test-module'] : [],
    getModule: () => ({
        agentTools: [{ name: 'test-tool' }],
        skills: [{
            capabilityId: 'test-skill',
            agentSkill: fixture.bundle,
        }],
    }),
} as unknown as CapabilityModuleCatalog

beforeEach(() => {
    fixture.authorized = true
    fixture.installed = true
    fixture.instructions = '---\nname: test-skill\ndescription: Test sealed instructions.\n---\nUse the original sealed instructions.'
    fixture.bundle = {
        name: 'test-skill',
        files: { instructions: 'SKILL.md' },
    }
    fixture.companions.clear()
    vi.clearAllMocks()
})

describe('sealed conversation Skills', () => {
    it('resumes the accepted Skill bytes after a published package changes', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const original = await new AgentSkills(catalog, repository, payloads).load(owner)
        fixture.instructions = 'Updated package instructions must apply only to a later turn.'
        const resumed = await new AgentSkills(catalog, repository, payloads).load(owner)
        expect([...resumed]).toEqual([...original])
        expect(fixture.manifestReads).toHaveBeenCalledTimes(1)
        expect(fixture.resourceReads).toHaveBeenCalledTimes(1)
    })

    it('recovers a committed snapshot after a lost transaction acknowledgement', async () => {
        const {
            repository,
            payloads,
            owner,
            database,
        } = await createConversationExecutionFixture()
        database.failAfterCommit = true
        const files = await new AgentSkills(catalog, repository, payloads).load(owner)
        expect(files.get('/skills/test-skill/test-skill/SKILL.md')).toBe(fixture.instructions)
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('SKILLS#'))).toHaveLength(1)
    })

    it('denies a retained Skill when its access is revoked or its module is removed', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const skills = new AgentSkills(catalog, repository, payloads)
        const files = await skills.load(owner)
        fixture.authorized = false
        await expect(skills.load(owner)).rejects.toThrow('AGENT_CAPABILITY_UNAVAILABLE')
        await expect(skills.assertCurrent(owner, files)).rejects.toThrow('AGENT_CAPABILITY_UNAVAILABLE')
        fixture.authorized = true
        fixture.installed = false
        await expect(skills.load(owner)).rejects.toThrow('AGENT_CAPABILITY_UNAVAILABLE')
    })

    it('rejects oversized instructions before persisting a Skill snapshot', async () => {
        const {
            repository,
            payloads,
            owner,
            database,
        } = await createConversationExecutionFixture()
        fixture.instructions = 'a'.repeat(128_001)
        await expect(new AgentSkills(catalog, repository, payloads).load(owner)).rejects.toThrow('AGENT_SKILL_RESOURCES_TOO_LARGE')
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('SKILLS#'))).toHaveLength(0)
    })

    it('retains every resource under one native Skill root and freezes their paths with their bytes', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        fixture.bundle!.files.reference = 'references/editing.md'
        fixture.companions.set('reference', 'Original reference bytes.')
        fixture.instructions += '\nRead [editing](references/editing.md).'
        const skills = new AgentSkills(catalog, repository, payloads)
        const files = await skills.load(owner)
        const root = '/skills/test-skill/test-skill/'
        expect(skills.sources(files)).toEqual([root])
        expect(files.get(`${root}references/editing.md`)).toBe('Original reference bytes.')
        const backend = new AgentScopedBackend(new AgentScratchStore(repository, payloads, owner, 'skills-test', 0, files).ports())
        expect((await backend.read(`${root}references/editing.md`)).content).toBe('Original reference bytes.')
        const search = skills.tools(owner, files).find(tool => tool.name === 'search_capabilities')!
        expect(JSON.parse(await search.invoke({ query: '' }))).toMatchObject({ data: [{
            capabilityId: 'test-skill',
            path: `${root}SKILL.md`,
        }] })
        fixture.bundle!.files.reference = 'changed.md'
        fixture.companions.set('reference', 'Updated reference bytes.')
        expect([...await skills.load(owner)]).toEqual([...files])
    })

    it('keeps a previously sealed flat path readable even when installer paths change', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const run = (await owner.read()).run!
        const entries = [['/skills/test-skill/SKILL.md', fixture.instructions]]
        const key = `SKILLS#${run.turnId}`
        const prepared = await payloads.prepare('sealed-agent-skills', Buffer.from(JSON.stringify(entries)), key)
        await repository.commit([repository.put(owner.partition, key, {
            payload: prepared.payload,
            capabilityIds: ['test-skill'],
        }), ...prepared.operations])
        const skills = new AgentSkills(catalog, repository, payloads)
        const files = await skills.load(owner)
        expect([...files]).toEqual(entries)
        expect(skills.sources(files)).toEqual(['/skills/test-skill/'])
        const backend = new AgentScopedBackend(new AgentScratchStore(repository, payloads, owner, 'skills-test', run.continuationEpoch, files).ports())
        expect((await backend.read('/skills/test-skill/SKILL.md')).content).toBe(fixture.instructions)
        expect(fixture.resourceReads).not.toHaveBeenCalled()
    })

    it.each([
        ['missing', undefined, 'MISSING_FILE_MAP'],
        ['incomplete', {
            name: 'test-skill',
            files: {
                instructions: 'SKILL.md',
                absent: 'references/absent.md',
            },
        }, 'INCOMPLETE_FILE_MAP'],
        ['escaping', {
            name: 'test-skill',
            files: { instructions: '../SKILL.md' },
        }, 'INCOMPLETE_FILE_MAP'],
    ])('reports an explicit invalid-Skill diagnostic for a %s resource map', async (_label, bundle, reason) => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        fixture.bundle = bundle
        await expect(new AgentSkills(catalog, repository, payloads).load(owner)).rejects.toThrow(`AGENT_SKILL_INVALID:test-skill:${reason}`)
    })

    it('discovers both module-owned sealed instructions with the actual native loader and no warnings', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const packageEntry = import.meta.resolve('@lixpi/capability-system/backend')
        const files = new Map<string, string>()

        for (const [moduleId, directory, name] of [
            ['media-sequence', 'editing', 'media-sequence-editing'],
            ['media-pipeline', 'planning', 'media-pipeline-planning'],
        ]) {
            const content = await readFile(new URL(`../capabilities/${moduleId}/skills/${directory}/SKILL.md`, packageEntry), 'utf8')
            files.set(`/skills/global.${name}/${name}/SKILL.md`, content)
        }

        const skills = new AgentSkills(catalog, repository, payloads)
        const run = (await owner.read()).run!
        const backend = new AgentScopedBackend(new AgentScratchStore(repository, payloads, owner, 'native-skills', run.continuationEpoch, files).ports())
        const middleware = createSkillsMiddleware({
            backend,
            sources: skills.sources(files),
        })
        const beforeModel = middleware.beforeModel
        const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        try {
            if (typeof beforeModel !== 'function')
                throw new Error('Native Skills middleware must expose its beforeModel hook')

            const update = await beforeModel({
                messages: [],
                skillsMetadata: undefined,
                pinnedSkills: [],
            } as never, {} as never)
            expect(update).toMatchObject({ skillsMetadata: [
                {
                    name: 'media-sequence-editing',
                    path: '/skills/global.media-sequence-editing/media-sequence-editing/SKILL.md',
                },
                {
                    name: 'media-pipeline-planning',
                    path: '/skills/global.media-pipeline-planning/media-pipeline-planning/SKILL.md',
                },
            ] })
            expect(warnings).not.toHaveBeenCalled()
        } finally {
            warnings.mockRestore()
        }
    })
})
