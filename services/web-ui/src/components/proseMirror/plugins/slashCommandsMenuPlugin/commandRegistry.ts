import type { EditorView } from 'prosemirror-view'
import { TextSelection } from 'prosemirror-state'
import { setBlockType } from 'prosemirror-commands'
import {
    codeBlockIcon,
    imageIcon,
    documentIcon,
} from '$src/svgIcons/index.ts'
import { ImageUploadModal } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/ImageUploadModal.ts'
import RouterService from '$src/services/router-service.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { v4 as uuidv4 } from 'uuid'
import { html } from '$src/utils/domTemplates.ts'

type SlashCommand = {
    name: string
    aliases: string[]
    icon: string
    description: string
    execute: (view: EditorView) => boolean
}

type FeaturePickerItem = {
    featureId: string
    name: string
    category: string
    summary?: string
    tags?: string[]
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

const tableIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v18H3V3zm16 2H5v4h14V5zm0 6H5v4h14v-4zm0 6H5v2h14v-2zM9 9V5H5v4h4zm0 6v-4H5v4h4zm0 4v-2H5v2h4z"/></svg>'
const featureIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="m12 1 0 4m0 14 0 4m-11-11 4 0m14 0 4 0"/></svg>'

const createUseFeatureCommand = (): SlashCommand['execute'] => (view: EditorView) => {
    console.log('[featurePicker] execute() called')
    const workspaceId = RouterService.getRouteParams().workspaceId as string
    const nats = servicesStore.getData('nats')
    console.log('[featurePicker] workspaceId=', workspaceId, 'nats=', !!nats)
    if (!nats) {
        console.warn('[featurePicker] nats service not available — aborting')
        return false
    }

    const { from } = view.state.selection
    const coords = view.coordsAtPos(from)
    const insertPos = from
    console.log('[featurePicker] from=', from, 'coords=', coords)

    let allFeatures: FeaturePickerItem[] = []
    let selectedIndex = 0
    let filterQuery = ''
    let closed = false

    const pickerStyle = {
        position: 'fixed' as const,
        zIndex: '99999',
        top: `${coords.bottom + 4}px`,
        left: `${coords.left}px`,
    }
    const picker = html`<div
        className="feature-picker-dropdown"
        style=${pickerStyle}
        onmousedown=${(event: MouseEvent) => {
            console.log('[featurePicker] picker onmousedown target=', event.target)
            event.preventDefault()
            event.stopPropagation()
        }}
    >
        <input className="feature-picker-dropdown__search" placeholder="Search features..." />
        <div className="feature-picker-dropdown__list"></div>
    </div>` as HTMLDivElement

    const searchInput = picker.querySelector('.feature-picker-dropdown__search') as HTMLInputElement
    const listEl = picker.querySelector('.feature-picker-dropdown__list') as HTMLDivElement
    document.body.appendChild(picker)
    console.log('[featurePicker] picker appended. rect=', picker.getBoundingClientRect(), 'isConnected=', picker.isConnected, 'computedDisplay=', window.getComputedStyle(picker).display, 'computedVisibility=', window.getComputedStyle(picker).visibility)

    function getFilteredFeatures(): FeaturePickerItem[] {
        const q = filterQuery.toLowerCase()
        return allFeatures.filter((feature) => {
            if (!q) return true
            return feature.name.toLowerCase().includes(q)
                || feature.category.toLowerCase().includes(q)
                || (feature.summary ?? '').toLowerCase().includes(q)
                || (feature.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
        })
    }

    function updateSelectedRow() {
        listEl.querySelectorAll('.feature-picker-dropdown__row').forEach((row, index) => {
            row.classList.toggle('feature-picker-dropdown__row--selected', index === selectedIndex)
        })
    }

    function clampSelectedIndex(filteredLength: number) {
        selectedIndex = filteredLength > 0 ? Math.max(0, Math.min(selectedIndex, filteredLength - 1)) : 0
    }

    function insertFeature(feature: FeaturePickerItem) {
        closePicker()
        const featureRefType = view.state.schema.nodes.feature_reference
        if (!featureRefType) {
            console.error('[featurePicker] feature_reference not in schema')
            view.focus()
            return
        }

        try {
            const node = featureRefType.create({
                featureId: feature.featureId,
                featureName: feature.name,
                category: feature.category,
            })
            const safeInsertPos = Math.min(insertPos, view.state.doc.content.size)
            let tr = view.state.tr.insert(safeInsertPos, node)
            tr = tr.setSelection(TextSelection.create(tr.doc, safeInsertPos + node.nodeSize)).scrollIntoView()
            view.dispatch(tr)
            view.focus()
        } catch (error) {
            console.error('[featurePicker] insert failed:', error)
            view.focus()
        }
    }

    function renderList() {
        listEl.replaceChildren()
        const filtered = getFilteredFeatures()
        if (filtered.length === 0) {
            listEl.appendChild(html`<div className="feature-picker-dropdown__empty">No features found</div>` as HTMLElement)
            return
        }
        clampSelectedIndex(filtered.length)
        filtered.forEach((feature, index) => {
            const row = html`<div className=${`feature-picker-dropdown__row${index === selectedIndex ? ' feature-picker-dropdown__row--selected' : ''}`}>
                <span className="feature-picker-dropdown__category">${feature.category}</span>
                <span className="feature-picker-dropdown__name">@${feature.name}</span>
                <span className="feature-picker-dropdown__summary">${feature.summary ?? ''}</span>
            </div>` as HTMLElement
            row.addEventListener('mousedown', (event) => {
                event.preventDefault()
                event.stopPropagation()
                insertFeature(feature)
            })
            row.addEventListener('mouseenter', () => {
                selectedIndex = index
                updateSelectedRow()
            })
            listEl.appendChild(row)
        })
    }

    function closePicker() {
        console.log('[featurePicker] closePicker() called. closed=', closed, 'isConnected=', picker.isConnected)
        console.trace('[featurePicker] closePicker stack')
        closed = true
        picker.remove()
        document.removeEventListener('mousedown', outsideMouseDown, false)
        document.removeEventListener('keydown', onKeyDown, true)
    }

    function outsideMouseDown(e: MouseEvent) {
        const inside = picker.contains(e.target as Node)
        console.log('[featurePicker] document mousedown — target=', e.target, 'inside picker?', inside, 'eventPhase=', e.eventPhase)
        if (!inside) closePicker()
    }

    function onKeyDown(e: KeyboardEvent) {
        const filtered = getFilteredFeatures()
        if (e.key === 'Escape') {
            e.preventDefault()
            closePicker()
            view.focus()
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            selectedIndex += 1
            clampSelectedIndex(filtered.length)
            updateSelectedRow()
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            selectedIndex -= 1
            clampSelectedIndex(filtered.length)
            updateSelectedRow()
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            if (filtered[selectedIndex]) insertFeature(filtered[selectedIndex])
        }
    }

    searchInput.addEventListener('input', () => {
        filterQuery = searchInput.value
        selectedIndex = 0
        renderList()
    })
    document.addEventListener('mousedown', outsideMouseDown, false)
    document.addEventListener('keydown', onKeyDown, true)

    async function loadFeatures() {
        try {
            console.log('[featurePicker] loadFeatures: requesting token')
            const token = await AuthService.getTokenSilently()
            console.log('[featurePicker] loadFeatures: token ok, requesting scopes')
            const scopes: Array<{ scope: string; scopeOwnerId?: string }> = [
                { scope: 'workspace', scopeOwnerId: workspaceId },
                { scope: 'user' },
            ]
            const features: FeaturePickerItem[] = []
            for (const scope of scopes) {
                try {
                    const result = await nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.LIST_BY_SCOPE, { token, workspaceId, ...scope })
                    console.log('[featurePicker] loadFeatures: scope', scope.scope, 'returned', result?.items?.length ?? 0, 'items')
                    features.push(...(result?.items ?? []))
                } catch (error) {
                    console.warn('[featurePicker] failed to load scope:', scope.scope, error)
                }
            }
            allFeatures = features
            console.log('[featurePicker] loadFeatures: total=', features.length, 'closed=', closed, 'isConnected=', picker.isConnected)
            renderList()
            searchInput.focus()
        } catch (error) {
            console.error('[featurePicker] failed to load features:', error)
            renderList()
            searchInput.focus()
        }
    }

    void loadFeatures()

    console.log('[featurePicker] execute() returning true')
    return true
}

const createExtractFeatureCommand = (): SlashCommand['execute'] => (_view: EditorView) => {
    const workspaceId = RouterService.getRouteParams().workspaceId as string
    const extractionRunId = uuidv4()
    window.dispatchEvent(new CustomEvent('lixpi:open-extraction-tab', { detail: { extractionRunId, workspaceId } }))
    return true
}

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
    {
        name: 'Use Feature',
        aliases: ['use', 'feature', 'f'],
        icon: featureIcon,
        description: 'Insert a feature reference chip',
        execute: createUseFeatureCommand(),
    },
    {
        name: 'Extract Feature',
        aliases: ['extract', 'extract-feature', 'ext'],
        icon: featureIcon,
        description: 'Extract a feature from this context',
        execute: createExtractFeatureCommand(),
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
