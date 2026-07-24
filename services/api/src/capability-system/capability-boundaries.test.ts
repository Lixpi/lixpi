import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

async function listTypeScriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...await listTypeScriptFiles(path))
        if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path)
    }
    return files
}

async function readSources(directory: string): Promise<Array<{ path: string; source: string }>> {
    const paths = await listTypeScriptFiles(directory)
    return await Promise.all(paths.map(async path => ({
        path,
        source: await readFile(path, 'utf8'),
    })))
}

describe('Capability module architecture boundaries', () => {
    it('keeps the abstract system free of concrete Tool and Skill imports and identities', async () => {
        const packageSources = await readSources(new URL(
            '../../packages/lixpi/capability-system/src/',
            import.meta.url,
        ).pathname)
        const integrationSources = await readSources(new URL('.', import.meta.url).pathname)
        const systemSources = [...packageSources, ...integrationSources]

        for (const { path, source } of systemSources) {
            expect(source.includes('capability-packages/'), `${path} imports the concrete package layer`).toBe(false)
            expect(source.includes('../capability-modules/'), `${path} imports concrete Capability modules`).toBe(false)
            expect(source.includes('character-creator'), `${path} names Character Creator`).toBe(false)
            expect(source.includes('style-extraction'), `${path} names Style Extraction`).toBe(false)
        }
    })

    it('keeps each Capability module self-contained with Tool or Skill entry points', async () => {
        const modulesRoot = new URL('../capability-modules/', import.meta.url)
        const moduleDirectories = (await readdir(modulesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        expect(moduleDirectories.map(entry => entry.name).sort()).toEqual([
            'character-creator',
            'style-extraction',
        ])
        for (const entry of moduleDirectories) {
            const moduleRoot = new URL(`${entry.name}/`, modulesRoot)
            const files = await readdir(moduleRoot)
            expect(files.includes('index.ts'), `${entry.name} must expose one module entry point`).toBe(true)
            const hasTools = files.includes('tools')
            const hasSkills = files.includes('skills')
            expect(hasTools || hasSkills, `${entry.name} must contain Tools, Skills, or both`).toBe(true)
            if (hasTools) {
                expect((await readdir(new URL('tools/', moduleRoot))).includes('index.ts'), `${entry.name}/tools must expose its Tool modules`).toBe(true)
            }
            if (hasSkills) {
                expect((await readdir(new URL('skills/', moduleRoot))).includes('index.ts'), `${entry.name}/skills must expose its Skill modules`).toBe(true)
            }
        }
        const characterSources = await readSources(new URL('character-creator/', modulesRoot).pathname)
        const styleSources = await readSources(new URL('style-extraction/', modulesRoot).pathname)

        for (const { path, source } of characterSources) {
            expect(source.includes('/style-extraction/'), `${path} imports Style Extraction`).toBe(false)
        }
        for (const { path, source } of styleSources) {
            expect(source.includes('/character-creator/'), `${path} imports Character Creator`).toBe(false)
        }
    })

    it('keeps module-local Skills instruction-first and free of Tool action registration', async () => {
        const modulesRoot = new URL('../capability-modules/', import.meta.url)
        const moduleDirectories = (await readdir(modulesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        for (const moduleDirectory of moduleDirectories) {
            const moduleFiles = await readdir(new URL(`${moduleDirectory.name}/`, modulesRoot))
            if (!moduleFiles.includes('skills')) continue
            const skillsDirectory = new URL(`${moduleDirectory.name}/skills/`, modulesRoot)
            const skillEntries = await readdir(skillsDirectory, { withFileTypes: true })
            const subSkills = skillEntries.filter(entry => entry.isDirectory())
            expect(subSkills.length, `${moduleDirectory.name} must contain sub-Skills`).toBeGreaterThan(0)
            for (const subSkill of subSkills) {
                const subSkillDirectory = new URL(`${subSkill.name}/`, skillsDirectory)
                const files = await readdir(subSkillDirectory)
                expect(files.includes('SKILL.md'), `${moduleDirectory.name}/skills/${subSkill.name} must contain SKILL.md`).toBe(true)
                expect(files.includes('index.ts'), `${moduleDirectory.name}/skills/${subSkill.name} must contain index.ts`).toBe(true)
            }
            const sources = await readSources(skillsDirectory.pathname)
            for (const { path, source } of sources) {
                expect(source.includes('registerActions'), `${path} registers executable Tool actions`).toBe(false)
                expect(source.includes('ActionDependencies'), `${path} owns executable Tool dependencies`).toBe(false)
            }
        }
    })
})
