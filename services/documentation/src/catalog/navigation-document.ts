import {
    type NestedListDocumentJson,
} from '@lixpi/prosemirror/shared/nested-list'

import {
    documentationDomains,
    type DocumentationDomain,
} from './domains.ts'
import { canvasNodeExamples } from './nodes.ts'
import {
    documentationBlocks,
    documentationGroups,
    documentationSections,
    type DocumentationBlock,
} from './sections.ts'

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

// Collapsible entries: every package section, and the Nodes domain whose
// children are individual node pages.
export const sectionEntryId = (sectionId: string): string => `section:${sectionId}`
export const nodesEntryId = 'domain:nodes'
export const collapsibleEntryIds: readonly string[] = [...documentationSections.map(section => sectionEntryId(section.id)), nodesEntryId]

const domainItem = (domain: DocumentationDomain): NestedListDocumentJson => item(
    `domain:${domain.id}`,
    domain.title,
    domain.id === 'nodes'
        ? canvasNodeExamples.map(example => item(`example:${example.id}`, example.title))
        : [],
)

const heading = (
    entryId: string,
    level: number,
    title: string,
): NestedListDocumentJson => ({
    type: 'heading',
    attrs: {
        entryId,
        level,
    },
    content: text(title),
})

// A block is a level-two heading over the package sections that have a
// matching page.
const blockContent = (block: DocumentationBlock): NestedListDocumentJson[] => [
    heading(
        `block:${block.id}`,
        2,
        block.title,
    ),
    {
        type: 'bullet_list',
        attrs: { entryId: `block:${block.id}:items` },
        content: documentationSections.filter(section => section.block === block.id).map(
            section => item(
                sectionEntryId(section.id),
                section.title,
                documentationDomains.filter(domain => domain.section === section.id).map(domainItem),
            ),
        ),
    },
]

export const buildDocumentationNavigationDocument = (): NestedListDocumentJson => ({
    type: 'doc',
    content: documentationGroups.flatMap(
        (group): NestedListDocumentJson[] => [
            heading(
                `group:${group.id}`,
                1,
                group.title,
            ),
            ...documentationBlocks.filter(block => block.group === group.id).flatMap(blockContent),
        ],
    ),
})
