import { access, readdir, readFile } from 'node:fs/promises'
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
    const capabilitiesRoot = new URL(
        '../../../shared/capability-system/src/capabilities/',
        import.meta.url,
    )

    it('keeps every concrete Capability in the shared package', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort()

        expect(moduleDirectories).toEqual([
            'action-timeline',
            'character-creator',
            'style-extraction',
        ])
        await expect(access(new URL('../capability-modules/', import.meta.url))).rejects.toThrow()
    })

    it('keeps packaged Capability modules independent of service implementations', async () => {
        const moduleSources = await readSources(capabilitiesRoot.pathname)
        for (const { path, source } of moduleSources) {
            expect(source.includes('services/api'), `${path} imports the API service`).toBe(false)
            expect(source.includes('services/web-ui'), `${path} imports the web UI service`).toBe(false)
        }
    })

    it('imports CapabilityError from the shared error contract', async () => {
        const moduleSources = await readSources(capabilitiesRoot.pathname)
        const invalidRegistryImport = /import\s*\{[^}]*\bCapabilityError\b[^}]*\}\s*from\s*['"][^'"]*backend\/capability-action-registry\.ts['"]/su
        for (const { path, source } of moduleSources) {
            expect(
                invalidRegistryImport.test(source),
                `${path} imports CapabilityError from a module that does not export it`,
            ).toBe(false)
        }
    })

    it('keeps each Capability module self-contained', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        for (const entry of moduleDirectories) {
            const moduleRoot = new URL(`${entry.name}/`, capabilitiesRoot)
            const files = await readdir(moduleRoot)
            expect(files.includes('backend'), `${entry.name} must expose backend behavior`).toBe(true)
            expect(files.includes('skills'), `${entry.name} must own its Skills`).toBe(true)
            for (const other of moduleDirectories.filter(candidate => candidate.name !== entry.name)) {
                const sources = await readSources(moduleRoot.pathname)
                for (const { path, source } of sources) {
                    expect(source.includes(`/capabilities/${other.name}/`), `${path} imports ${other.name}`).toBe(false)
                }
            }
        }
    })

    it('keeps module-local Skills instruction-first and free of Tool action registration', async () => {
        const moduleDirectories = (await readdir(capabilitiesRoot, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())

        for (const moduleDirectory of moduleDirectories) {
            const skillsDirectory = new URL(`${moduleDirectory.name}/skills/`, capabilitiesRoot)
            const skillEntries = await readdir(skillsDirectory, { withFileTypes: true })
            const subSkills = skillEntries.filter(entry => entry.isDirectory())
            expect(subSkills.length, `${moduleDirectory.name} must contain sub-Skills`).toBeGreaterThan(0)
            for (const subSkill of subSkills) {
                const files = await readdir(new URL(`${subSkill.name}/`, skillsDirectory))
                expect(files.includes('SKILL.md'), `${moduleDirectory.name}/${subSkill.name} must contain SKILL.md`).toBe(true)
                expect(files.includes('index.ts'), `${moduleDirectory.name}/${subSkill.name} must contain index.ts`).toBe(true)
            }
            const sources = await readSources(skillsDirectory.pathname)
            for (const { path, source } of sources) {
                expect(source.includes('registerActions'), `${path} registers executable Tool actions`).toBe(false)
                expect(source.includes('ActionDependencies'), `${path} owns executable Tool dependencies`).toBe(false)
            }
        }
    })
})
