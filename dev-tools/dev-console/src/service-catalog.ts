// What a service reports about itself when asked for its catalog. The console renders
// this and holds no list of its own, so a service's commands can't drift from it.
export type ServiceCommand = {
    name: string
    label: string
    description?: string
    effect: 'read' | 'change' | 'destroy'
    available: boolean
    blockedReason?: string
    takesEnvFile?: boolean
    arguments?: {
        name: string
        prompt: string
    }[]
}

export type ServiceCatalog = {
    target: {
        summary: string
        rows: {
            label: string
            value: string
        }[]
    }
    commands: ServiceCommand[]
}

// What an action's script reports about the radio rows marked `reported`, which only
// the host can judge.
export type OptionState = {
    name: string
    available: boolean
    blockedReason?: string
}

export type OptionCatalog = {
    options: OptionState[]
}

// Build tools can print around the catalog, so it's the last line that holds an object.
const readCatalogLine = (text: string): unknown => {
    const line = text
        .split('\n').map(candidate => candidate.trim()).findLast(candidate => candidate.startsWith('{'))

    if (!line)
        return undefined

    try {
        return JSON.parse(line)
    } catch {
        return undefined
    }
}

export const parseServiceCatalog = (text: string): ServiceCatalog | undefined => {
    const catalog = readCatalogLine(text) as ServiceCatalog | undefined

    return Array.isArray(catalog?.commands)
        && Array.isArray(catalog.target?.rows)
        ? catalog
        : undefined
}

export const parseOptionCatalog = (text: string): OptionCatalog | undefined => {
    const catalog = readCatalogLine(text) as OptionCatalog | undefined

    return Array.isArray(catalog?.options)
        && catalog.options.every(option => typeof option?.name === 'string' && typeof option.available === 'boolean')
        ? catalog
        : undefined
}
