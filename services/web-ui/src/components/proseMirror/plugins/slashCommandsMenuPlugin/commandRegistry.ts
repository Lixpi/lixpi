import type { EditorView } from 'prosemirror-view'
import { setBlockType } from 'prosemirror-commands'
import {
    codeBlockIcon,
    imageIcon,
    documentIcon,
} from '$src/svgIcons/index.ts'
import { ImageUploadModal } from './ImageUploadModal.ts'
import RouterService from '$src/services/router-service.ts'

type SlashCommand = {
    name: string
    aliases: string[]
    icon: string
    description: string
    execute: (view: EditorView) => boolean
}

const createCodeBlockCommand = (): SlashCommand['execute'] => {
    return (view: EditorView) => {
        const { state, dispatch } = view
        const codeBlockType = state.schema.nodes.code_block
        if (!codeBlockType) return false
        return setBlockType(codeBlockType)(state, dispatch)
    }
}

const createImageCommand = (): SlashCommand['execute'] => {
    return (view: EditorView) => {
        const { state } = view
        const imageType = state.schema.nodes.image
        if (!imageType) {
            console.warn('[slashCommandsMenu] Image node type not found in schema')
            return false
        }

        const workspaceId = RouterService.getRouteParams().workspaceId as string

        const modal = new ImageUploadModal({
            view,
            onComplete: (result) => {
                if (result.success && result.src) {
                    const attrs: Record<string, string | null> = {
                        src: result.src,
                        alt: '',
                        title: '',
                        fileId: result.fileId || null,
                        workspaceId: result.fileId ? workspaceId : null,
                    }

                    const image = imageType.create(attrs)
                    const tr = view.state.tr.replaceSelectionWith(image).scrollIntoView()
                    view.dispatch(tr)
                    view.focus()
                }
            },
            onCancel: () => {
                view.focus()
            },
        })

        modal.show()
        return true
    }
}

const createTableCommand = (): SlashCommand['execute'] => {
    return (view: EditorView) => {
        // TODO: Phase 2 - Implement table insertion
        // Table node type needs to be added to schema first
        console.warn('[slashCommandsMenu] Table insertion not yet implemented - table node type required in schema')
        window.alert('Table insertion coming soon')
        return false
    }
}

const createFileCommand = (): SlashCommand['execute'] => {
    return (view: EditorView) => {
        // TODO: Phase 2 - Implement file attachment/upload
        console.warn('[slashCommandsMenu] File attachment not yet implemented')
        window.alert('File attachment coming soon')
        return false
    }
}

// Table icon - inline SVG since not in icons file
const tableIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v18H3V3zm16 2H5v4h14V5zm0 6H5v4h14v-4zm0 6H5v2h14v-2zM9 9V5H5v4h4zm0 6v-4H5v4h4zm0 4v-2H5v2h4z"/></svg>'

export const SLASH_COMMANDS: SlashCommand[] = [
    {
        name: 'Code Block',
        aliases: ['code', 'code-block', 'codeblock', 'pre'],
        icon: codeBlockIcon,
        description: 'Insert a code block',
        execute: createCodeBlockCommand(),
    },
    {
        name: 'Image',
        aliases: ['image', 'img', 'picture'],
        icon: imageIcon,
        description: 'Insert an image',
        execute: createImageCommand(),
    },
    {
        name: 'Table',
        aliases: ['table'],
        icon: tableIcon,
        description: 'Insert a table',
        execute: createTableCommand(),
    },
    {
        name: 'File',
        aliases: ['file', 'attachment'],
        icon: documentIcon,
        description: 'Attach a file',
        execute: createFileCommand(),
    },
]

export function filterCommands(query: string): SlashCommand[] {
    if (!query) return SLASH_COMMANDS

    const lowerQuery = query.toLowerCase()
    return SLASH_COMMANDS.filter((cmd) => {
        const nameMatch = cmd.name.toLowerCase().includes(lowerQuery)
        const aliasMatch = cmd.aliases.some((alias) => alias.includes(lowerQuery))
        return nameMatch || aliasMatch
    })
}

export type { SlashCommand }
