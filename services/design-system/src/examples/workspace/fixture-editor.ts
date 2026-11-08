import {
    EditorState,
    type Plugin,
} from 'prosemirror-state'
import {
    EditorView,
    type NodeViewConstructor,
    type ViewMutationRecord,
} from 'prosemirror-view'
import {
    DOMParser as ProseMirrorDOMParser,
    type Schema,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import { aiPromptInputNodeType } from '@lixpi/prosemirror'
import { createProseMirrorSchema } from '@lixpi/prosemirror/shared/schema-builder'
import { createCodeBlockPlugin } from '@lixpi/prosemirror/frontend/code-block'
import {
    parseAiModelSelectionAttr,
    serializeAiModelSelectionAttr,
    parseCapabilityInputsAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { select } from 'd3-selection'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    bindCanvasTheme,
    type CanvasThemeSource,
} from '@lixpi/canvas-components/theme'
import { BubbleMenu } from '@lixpi/ui-kit/components/bubble-menu'
import {
    createSlidingDropdown,
    type SlidingDropdownInstance,
} from '@lixpi/ui-kit/components/sliding-dropdown'
import {
    imageIcon,
    videoIcon,
    gptAvatarIcon,
} from '@lixpi/ui-kit/svg'
import { getExampleTheme } from '../example-theme.ts'
import {
    PromptInputSurface,
    createPromptMediaModeSwitch,
    createPromptModelMenuTrigger,
    createPromptSubmitButton,
    PromptModelDropdownOptionView,
    PromptControlPortalScope,
    type PromptComposerEditorRequest,
    type PromptMediaMode,
    type PromptMediaModeSwitch,
    type PromptModelMenuTrigger,
} from '@lixpi/canvas-components/workspace/composer'
import {
    type CanvasConversationEditorMount,
    type WorkspacePromptEditorIntegration,
} from '@lixpi/canvas-components/workspace'

export const paragraphDocument = (text: string): object => ({
    type: 'doc',
    content: [{
        type: 'paragraph',
        content: text ? [{
            type: 'text',
            text,
        }] : [],
    }],
})

// EditorView supplies editing and document authority through the product's
// typed editor port. Fixture content never connects to collaboration or models.
type DocumentContent = string | HTMLElement | object

const resolveDocumentContent = (
    content: DocumentContent,
    schema: Schema,
): object => typeof content === 'string'
    ? paragraphDocument(content)
    : content instanceof HTMLElement
        ? ProseMirrorDOMParser.fromSchema(schema).parse(content).toJSON()
        : content

export class FixtureEditor {
    readonly editorView: EditorView
    private destroyed = false

    static readOnly(
        host: HTMLElement,
        content: DocumentContent,
    ): FixtureEditor {
        const schema = createProseMirrorSchema('assetContent')

        return new FixtureEditor(
            host,
            resolveDocumentContent(content, schema),
            schema,
            [createCodeBlockPlugin(schema)],
            undefined,
            true,
        )
    }

    constructor(
        host: HTMLElement,
        content: object,
        schema: Schema = createProseMirrorSchema('assetContent'),
        plugins: Plugin[] = [],
        private readonly onChange: (content: object) => void = () => {},
        readOnly = false,
        nodeViews: Record<string, NodeViewConstructor> = {},
    ) {
        const doc = Object.keys(content).length
            ? schema.nodeFromJSON(content)
            : schema.topNodeType.createAndFill()

        if (!doc)
            throw new Error('Fixture schema could not create an initial document')

        this.editorView = new EditorView(
            host,
            {
                state: EditorState.create({
                    doc,
                    schema,
                    plugins,
                }),
                editable: () => !readOnly,
                nodeViews,
                dispatchTransaction: transaction => {
                    if (this.destroyed)
                        return

                    const state = this.editorView.state.apply(transaction)
                    this.editorView.updateState(state)

                    if (transaction.docChanged)
                        this.onChange(
                            state.doc.toJSON(),
                        )
                },
            },
        )
    }

    setContent(content: DocumentContent): void {
        this.restoreContent(
            resolveDocumentContent(content, this.editorView.state.schema),
        )
    }

    restoreContent = (content: object): void => {
        if (this.destroyed)
            return

        const schema = this.editorView.state.schema
        const doc = Object.keys(content).length
            ? schema.nodeFromJSON(content)
            : schema.topNodeType.createAndFill()

        if (!doc)
            throw new Error('Fixture document is empty')

        this.editorView.updateState(
            EditorState.create({
                schema,
                doc,
                plugins: this.editorView.state.plugins,
            }),
        )
    }

    updateDocument = (content: object): void => void this.restoreContent(content)

    destroy = (): void => {
        if (this.destroyed)
            return

        this.destroyed = true
        this.editorView.destroy()
    }
}

type FixtureModelKind = 'reasoning' | 'image' | 'video'
type FixtureModelOption = {
    id: string
    title: string
    providerTitle: string
    icon: string
}
const fixtureModelOptions: Record<FixtureModelKind, FixtureModelOption[]> = {
    reasoning: [
        {
            id: 'local:planning',
            title: 'Planning',
            providerTitle: 'Local',
            icon: gptAvatarIcon,
        },
        {
            id: 'local:direct',
            title: 'Direct',
            providerTitle: 'Local',
            icon: gptAvatarIcon,
        },
    ],
    image: [
        {
            id: 'local:studio-image',
            title: 'Studio image',
            providerTitle: 'Local',
            icon: imageIcon,
        },
        {
            id: 'local:detail-image',
            title: 'Detail image',
            providerTitle: 'Local',
            icon: imageIcon,
        },
    ],
    video: [
        {
            id: 'local:motion-video',
            title: 'Motion video',
            providerTitle: 'Local',
            icon: videoIcon,
        },
        {
            id: 'local:loop-video',
            title: 'Loop video',
            providerTitle: 'Local',
            icon: videoIcon,
        },
    ],
}
const fixtureModelAttributes = {
    reasoning: 'aiReasoningModels',
    image: 'aiImageModels',
    video: 'aiVideoModels',
} as const

class FixturePromptNodeView {
    readonly dom: HTMLDivElement
    readonly contentDOM: HTMLDivElement
    private readonly surface: PromptInputSurface

    constructor(
        node: ProseMirrorNode,
        document: Document,
        controls: HTMLDivElement,
    ) {
        this.surface = new PromptInputSurface(
            document,
            'Describe what you want to create',
            controls,
        )
        this.dom = this.surface.dom
        this.contentDOM = this.surface.contentDOM
        this.update(node)
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type.name !== aiPromptInputNodeType)
            return false

        this.surface.setEmpty(node.content.size === 0 || !node.textContent.trim())

        return true
    }

    ignoreMutation(mutation: ViewMutationRecord): boolean {
        return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target)
    }

    stopEvent(event: Event): boolean {
        return event.target instanceof Node && this.surface.controls.contains(event.target)
    }

    destroy(): void {
        this.surface.destroy()
    }
}

export class FixturePromptEditor {
    readonly editorView: EditorView
    private readonly editor: FixtureEditor
    private readonly lifetime = new Lifetime()
    private readonly modeSwitch: PromptMediaModeSwitch
    private readonly modelTrigger: PromptModelMenuTrigger
    private readonly menu: BubbleMenu
    private readonly dropdowns = new Map<FixtureModelKind, SlidingDropdownInstance>()
    private readonly sections = new Map<FixtureModelKind, HTMLElement>()
    private readonly html: ReturnType<typeof createDocumentHtml>
    private disposed = false

    constructor(
        private readonly request: PromptComposerEditorRequest,
        integration?: WorkspacePromptEditorIntegration,
        theme?: CanvasThemeSource,
        private readonly report: (message: string) => void = () => {},
    ) {
        theme ??= getExampleTheme(request.host)
        this.html = createDocumentHtml(request.host.ownerDocument)
        const html = this.html
        const controls = html`
            <div
                className="ai-prompt-input-controls"
                contenteditable="false"
            ></div>
        ` as HTMLDivElement
        this.editor = new FixtureEditor(
            request.host,
            request.initialContent,
            createProseMirrorSchema('aiPromptInput'),
            [],
            request.onContentChange,
            false,
            { [aiPromptInputNodeType]: node => new FixturePromptNodeView(
                node,
                request.host.ownerDocument,
                controls,
            ) },
        )
        this.editorView = this.editor.editorView
        this.lifetime.own(() => this.editor.destroy())
        this.modeSwitch = createPromptMediaModeSwitch({
            document: request.host.ownerDocument,
            theme,
            value: this.mode(),
            onChange: value => {
                this.setAttributes({ mediaGenerationMode: value })
                this.report(`Selected ${value} generation in the local composer.`)
            },
        })
        this.lifetime.own(() => this.modeSwitch.destroy())
        this.modelTrigger = createPromptModelMenuTrigger({
            document: request.host.ownerDocument,
            theme,
            onClick: event => {
                event.preventDefault()
                event.stopPropagation()

                if (this.menu.isVisible)
                    this.menu.hide()
                else {
                    this.syncControls()
                    this.menu.show(
                        'modelSettings',
                        {
                            targetRect: this.modelTrigger.element.getBoundingClientRect(),
                            placement: 'above',
                            horizontalAlignment: 'end',
                            clampToParent: false,
                        },
                    )
                }
            },
        })
        this.lifetime.own(() => this.modelTrigger.destroy())
        const menuContent = html`<div className="ai-prompt-model-menu-content"></div>` as HTMLDivElement

        for (const kind of ['reasoning', 'image', 'video'] as const) {
            const host = html`<span className="ai-model-sliding-dropdown-host"></span>` as HTMLSpanElement
            const title = kind === 'reasoning'
                ? 'Reasoning model'
                : kind === 'image'
                    ? 'Image model'
                    : 'Video model'
            const section = html`
                <section
                    className="ai-prompt-model-menu-section"
                    data=${{ visible: 'true' }}
                >
                    <div className="ai-prompt-model-menu-section-heading">
                        <div className="ai-prompt-model-menu-section-heading-main">
                            <div className="ai-prompt-model-menu-section-title">${title}</div>
                        </div>
                    </div>
                    <div className="ai-prompt-model-menu-section-controls">
                        <div className="ai-prompt-model-menu-control">
                            <span className="ai-prompt-model-menu-control-label">Model</span>
                            <span className="ai-prompt-model-menu-control-field">${host}</span>
                        </div>
                    </div>
                </section>
            ` as HTMLElement
            this.sections.set(kind, section)
            menuContent.append(section)
            const options = fixtureModelOptions[kind]
            const scope = new PromptControlPortalScope(host)
            const dropdown = createSlidingDropdown(
                select(host).append('svg').attr('class', 'ai-model-sliding-dropdown-svg'),
                {
                    id: `fixture-${kind}-${crypto.randomUUID()}`,
                    ...scope.options,
                    x: 0,
                    y: 0,
                    width: 190,
                    height: 38,
                    optionHorizontalPadding: 7,
                    options: options.map(
                        option => ({
                            value: option.id,
                            label: `${option.providerTitle}: ${option.title}`,
                        }),
                    ),
                    selectedValue: this.selectedModel(kind).id,
                    ariaLabel: title,
                    observeParentResize: false,
                    renderOption: (parent, state) => new PromptModelDropdownOptionView(
                        parent,
                        state,
                        options.find(option => option.id === state.option.value) ?? options[0],
                    ),
                    onChange: value => {
                        this.setAttributes({ [fixtureModelAttributes[kind]]: serializeAiModelSelectionAttr([value]) })
                        this.report(`Selected ${options.find(option => option.id === value)?.title ?? value} in the local composer.`)
                    },
                },
            )
            this.dropdowns.set(kind, dropdown)
            this.lifetime.own(() => dropdown.destroy())
        }

        this.menu = new BubbleMenu({
            parentEl: request.host,
            items: [{
                element: menuContent,
                context: ['modelSettings'],
            }],
            onShow: () => this.modelTrigger.setExpanded(true),
            onHide: () => {
                for (const dropdown of this.dropdowns.values())
                    dropdown.setOpen(false)

                this.modelTrigger.setExpanded(false)
            },
        })
        this.menu.element.classList.add(
            'ai-prompt-model-menu-info-bubble',
            'nopan',
            'nowheel',
        )
        this.menu.element.ariaLabel = 'Model settings'
        this.lifetime.own(() => this.menu.destroy())
        const dismissMenu = (event: MouseEvent): void => {
            const target = event.target as Node

            if (
                this.menu.element.contains(target)
                || this.modelTrigger.element.contains(target)
            )
                return

            if (
                target instanceof Element
                && target.closest('.sliding-dropdown-scroll-portal, .sliding-dropdown-chevron-portal, [data-sliding-dropdown-open="true"]')
            )
                return

            this.menu.hide()
        }
        const dismissOnEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape')
                this.menu.hide()
        }
        request.host.ownerDocument.addEventListener(
            'mousedown',
            dismissMenu,
            true,
        )
        request.host.ownerDocument.addEventListener('keydown', dismissOnEscape)
        this.lifetime.own(
            () => request.host.ownerDocument.removeEventListener(
                'mousedown',
                dismissMenu,
                true,
            ),
        )
        this.lifetime.own(() => request.host.ownerDocument.removeEventListener('keydown', dismissOnEscape))

        if (theme)
            this.lifetime.own(
                bindCanvasTheme(
                    this.menu.element,
                    theme,
                    () => {
                        for (const dropdown of this.dropdowns.values())
                            dropdown.render()
                    },
                ),
            )

        const submit = createPromptSubmitButton(request.host.ownerDocument, () => void this.submit())
        this.lifetime.own(() => submit.destroy())
        controls.append(submit.element)
        this.lifetime.own(() => controls.remove())

        if (integration) {
            integration.mountMediaModeSwitch(this.modeSwitch.element)
            integration.mountModelMenuControl(this.modelTrigger.element)
        } else
            controls.prepend(this.modeSwitch.element, this.modelTrigger.element)

        const dispatch = this.editorView.props.dispatchTransaction
        this.editorView.setProps({
            dispatchTransaction: transaction => {
                dispatch?.call(this.editorView, transaction)
                this.syncControls()
            },
            handleKeyDown: (_view, event) => {
                const submitKey = event.key === 'Enter'
                    && !event.isComposing
                    && (event.metaKey || event.ctrlKey || integration?.submitOnEnter && !event.shiftKey)

                if (
                    !submitKey
                    || request.signal.aborted
                )
                    return false

                event.preventDefault()
                void this.submit()

                return true
            },
        })
        request.signal.addEventListener(
            'abort',
            this.destroy,
            { once: true },
        )
        this.lifetime.own(() => request.signal.removeEventListener('abort', this.destroy))
        this.syncControls()

        if (request.signal.aborted)
            this.destroy()
    }

    private mode(): PromptMediaMode {
        return this.editorView.state.doc.firstChild?.attrs.mediaGenerationMode === 'video' ? 'video' : 'image'
    }

    private selectedModel(kind: FixtureModelKind): FixtureModelOption {
        const ids = parseAiModelSelectionAttr(this.editorView.state.doc.firstChild?.attrs[fixtureModelAttributes[kind]])

        return fixtureModelOptions[kind].find(option => ids.includes(option.id)) ?? fixtureModelOptions[kind][0]
    }

    private setAttributes(patch: Record<string, unknown>): void {
        const node = this.editorView.state.doc.firstChild

        if (
            this.disposed
            || !node
        )
            return

        this.editorView.dispatch(
            this.editorView.state.tr.setNodeMarkup(
                0,
                undefined,
                {
                    ...node.attrs,
                    ...patch,
                },
            ),
        )
    }

    private syncControls(): void {
        if (this.disposed)
            return

        const mode = this.mode()
        this.modeSwitch.setValue(mode)

        for (const [kind, dropdown] of this.dropdowns) {
            this.sections.get(kind)!.dataset.visible = String(kind === 'reasoning' || kind === mode)
            dropdown.setValue(this.selectedModel(kind).id)
            dropdown.render()
        }

        const selected = this.selectedModel(mode)
        const html = this.html
        this.modelTrigger.summary.replaceChildren(
            html`
                <span className="ai-prompt-model-menu-trigger-summary-item">
                    <span
                        className="ai-prompt-model-menu-trigger-summary-icon"
                        innerHTML=${selected.icon}
                        aria-hidden="true"
                    ></span>
                    <span className="ai-prompt-model-menu-trigger-summary-label">${selected.providerTitle}: ${selected.title}</span>
                </span>
            ` as HTMLElement,
        )
    }

    private async submit(): Promise<void> {
        if (
            this.disposed
            || this.request.signal.aborted
        )
            return

        const node = this.editorView.state.doc.firstChild

        try {
            await this.request.onSubmit({
                contentJSON: node?.content.toJSON() ?? [],
                mediaGenerationMode: this.mode(),
                aiReasoningModels: [this.selectedModel('reasoning').id],
                useMultipleReasoningModels: false,
                useMultipleImageModels: false,
                useMultipleVideoModels: false,
                imageOptions: {
                    aiImageModels: [this.selectedModel('image').id],
                    imageGenerationSize: String(node?.attrs.imageGenerationSize ?? ''),
                },
                videoOptions: { aiVideoModels: [this.selectedModel('video').id] },
                capabilityInputs: parseCapabilityInputsAttr(node?.attrs.capabilityInputs),
            })
        } catch (error) {
            if (!this.disposed)
                this.report(error instanceof Error ? error.message : String(error))
        }
    }

    restoreContent = (content: object): void => {
        this.editor.restoreContent(content)
        this.syncControls()
    }

    destroy = (): void => {
        if (this.disposed)
            return

        this.disposed = true
        this.lifetime.destroy()
    }
}

export const mountPromptEditor = (
    request: PromptComposerEditorRequest,
    integration?: WorkspacePromptEditorIntegration,
    theme?: CanvasThemeSource,
    report?: (message: string) => void,
): FixturePromptEditor => new FixturePromptEditor(
    request,
    integration,
    theme,
    report,
)

class FixtureConversationEditor {
    private readonly editor: FixtureEditor

    constructor(request: CanvasConversationEditorMount) {
        this.editor = new FixtureEditor(
            request.container,
            request.thread.content ?? {},
            createProseMirrorSchema('assetConversation'),
            [],
            request.onChange,
            request.readOnly ?? true,
        )
    }

    activate = (): void => {}
    submitPersisted = (): void => {}
    readContent = (): object => this.editor.editorView.state.doc.toJSON()
    destroy = (): void => void this.editor.destroy()
}

export const mountConversationEditor = (request: CanvasConversationEditorMount): FixtureConversationEditor => new FixtureConversationEditor(request)

export const promptEditorIntegrationSource: readonly string[] = [
    "import { createPromptMediaModeSwitch, createPromptModelMenuTrigger, createPromptSubmitButton, type PromptMediaMode, type PromptComposerEditorRequest } from '@lixpi/canvas-components/workspace/composer'",
    "import { type WorkspacePromptEditorIntegration } from '@lixpi/canvas-components/workspace'",
    "import { type CanvasThemeSource } from '@lixpi/canvas-components/theme'",
    "",
    "const mountNativeControls = (",
    "    request: PromptComposerEditorRequest,",
    "    integration: WorkspacePromptEditorIntegration,",
    "    theme: CanvasThemeSource,",
    "    mode: PromptMediaMode,",
    "    onModeChange: (value: PromptMediaMode) => void,",
    "    openModelMenu: (event: MouseEvent) => void,",
    "    submitPrompt: () => void,",
    ") => {",
    "    const document = request.host.ownerDocument",
    "    const mediaMode = createPromptMediaModeSwitch({ document, value: mode, onChange: onModeChange, theme })",
    "    const modelMenu = createPromptModelMenuTrigger({ document, onClick: openModelMenu, theme })",
    "    const submit = createPromptSubmitButton(document, submitPrompt)",
    "    integration.mountMediaModeSwitch(mediaMode.element)",
    "    integration.mountModelMenuControl(modelMenu.element)",
    "    request.host.append(submit.element)",
    "    // The editor owns ProseMirror attrs, the BubbleMenu, model choices and submission.",
    "    return () => { mediaMode.destroy(); modelMenu.destroy(); submit.destroy() }",
    "}",
    "",
    "// This library's real ProseMirror adapter uses the same factories as production.",
    "import { FixturePromptEditor } from './fixture-editor.ts'"
]
