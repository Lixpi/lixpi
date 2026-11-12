import {
    type NestedListDocumentJson,
} from '@lixpi/prosemirror/shared/nested-list'

import {
    canvasExamples,
    type CanvasExample,
} from './catalog.ts'
import {
    canvasDomains,
    type CanvasDomain,
} from './domains.ts'
import { canvasNodeExamples } from './nodes.ts'

const text = (value: string): NestedListDocumentJson[] =>
    value ? [{
        type: 'text',
        text: value,
    }] : []

const paragraph = (
    entryId: string,
    title: string,
): NestedListDocumentJson => ({
    type: 'paragraph',
    attrs: { entryId },
    content: text(title),
})

const item = (
    entryId: string,
    title: string,
    children: NestedListDocumentJson[] = [],
): NestedListDocumentJson => ({
    type: 'list_item',
    attrs: {
        entryId,
        itemType: 'text',
        data: null,
        tagIds: [],
    },
    content: [
        paragraph(`${entryId}:title`, title),
        ...(children.length ? [{
            type: 'bullet_list',
            attrs: { entryId: `${entryId}:children` },
            content: children,
        }] : []),
    ],
})

const searchableText = (example: CanvasExample): string => [
    example.title,
    example.summary,
    example.source,
    ...(example.components ?? []),
    ...(example.nodes ?? []),
].join(' ')

const matchingDomains = (query: string): Map<string, CanvasDomain[]> => {
    const groups = new Map<string, CanvasDomain[]>()

    for (const domain of canvasDomains) {
        const examples = canvasExamples.filter(example => domain.examples.includes(example.id))
        const haystack = [domain.title, domain.group, ...examples.map(searchableText)].join(' ')

        if (!haystack.toLocaleLowerCase().includes(query))
            continue

        const entries = groups.get(domain.group) ?? []
        entries.push(domain)
        groups.set(domain.group, entries)
    }

    return groups
}

export const buildCanvasLibraryNavigationDocument = (search: string): NestedListDocumentJson => {
    const query = search.trim().toLocaleLowerCase()
    const groups = matchingDomains(query)

    if (!groups.size)
        return {
            type: 'doc',
            content: [paragraph('empty:search', 'No matching components.')],
        }

    return {
        type: 'doc',
        content: Array.from(groups).flatMap(
            ([group, domains]): NestedListDocumentJson[] => [
                {
                    type: 'heading',
                    attrs: {
                        entryId: `group:${group}`,
                        level: 1,
                    },
                    content: text(group),
                },
                {
                    type: 'bullet_list',
                    attrs: { entryId: `group:${group}:items` },
                    content: domains.map(domain => {
                        const children = domain.id === 'nodes'
                            ? canvasNodeExamples.filter(example => searchableText(example).toLocaleLowerCase().includes(query)).map(
                                example => item(`example:${example.id}`, example.title),
                            )
                            : []

                        return item(
                            `domain:${domain.id}`,
                            domain.title,
                            children,
                        )
                    }),
                },
            ],
        ),
    }
}
