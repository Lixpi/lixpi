// The navigation has top-level groups, each holding blocks of packages. The
// User Interface group has two blocks: canvas packages, and the general UI
// packages every Lixpi browser application shares. Each package is one
// collapsible section whose children are its domains.

export type DocumentationGroup = {
    id: string
    title: string
}

export type DocumentationBlock = {
    id: string
    title: string
    group: string
}

export type DocumentationSection = {
    id: string
    title: string
    block: string
    packageName: string
}

export const documentationGroups: readonly DocumentationGroup[] = [
    {
        id: 'user-interface',
        title: 'User Interface',
    },
]

export const documentationBlocks: readonly DocumentationBlock[] = [
    {
        id: 'canvas',
        title: 'Canvas',
        group: 'user-interface',
    },
    {
        id: 'ui',
        title: 'UI components',
        group: 'user-interface',
    },
]

export const documentationSections: readonly DocumentationSection[] = [
    {
        id: 'canvas-engine',
        title: 'Canvas engine',
        block: 'canvas',
        packageName: '@lixpi/canvas-engine',
    },
    {
        id: 'canvas-components',
        title: 'Canvas components',
        block: 'canvas',
        packageName: '@lixpi/canvas-components',
    },
    {
        id: 'themes',
        title: 'Themes',
        block: 'ui',
        packageName: '@lixpi/themes',
    },
    {
        id: 'ui-kit',
        title: 'UI kit',
        block: 'ui',
        packageName: '@lixpi/ui-kit',
    },
    {
        id: 'ui-primitives',
        title: 'UI primitives',
        block: 'ui',
        packageName: '@lixpi/ui-primitives',
    },
    {
        id: 'prosemirror',
        title: 'ProseMirror',
        block: 'ui',
        packageName: '@lixpi/prosemirror',
    },
    {
        id: 'prosemirror-themes',
        title: 'ProseMirror themes',
        block: 'ui',
        packageName: '@lixpi/prosemirror-themes',
    },
    {
        id: 'web-client-service-factory',
        title: 'Web client service factory',
        block: 'ui',
        packageName: '@lixpi/web-client-service-factory',
    },
]

export const getDocumentationSection = (sectionId: string): DocumentationSection | undefined => documentationSections.find(
    section => section.id === sectionId,
)
