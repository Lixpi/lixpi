import { canvasNodeExamples } from './nodes.ts'

export type DocumentationDomain = {
    id: string
    title: string
    section: string
    examples: readonly string[]
}

export const documentationDomains: readonly DocumentationDomain[] = [
    {
        id: 'connectors',
        title: 'Connectors',
        section: 'canvas-engine',
        examples: ['engine-connector-matrix', 'engine-routing', 'engine-proximity'],
    },
    {
        id: 'interaction',
        title: 'Interaction',
        section: 'canvas-engine',
        examples: ['engine-multiple', 'engine-validation'],
    },
    {
        id: 'arrangement',
        title: 'Arrangement',
        section: 'canvas-engine',
        examples: ['engine-parenting'],
    },
    {
        id: 'trees',
        title: 'Tree layout',
        section: 'canvas-engine',
        examples: ['engine-tidy-tree'],
    },
    {
        id: 'collisions',
        title: 'Collisions',
        section: 'canvas-engine',
        examples: ['engine-collisions'],
    },
    {
        id: 'stress',
        title: 'Large scenes',
        section: 'canvas-engine',
        examples: ['engine-large-scene'],
    },
    {
        id: 'nodes',
        title: 'Nodes',
        section: 'canvas-components',
        examples: canvasNodeExamples.map(example => example.id),
    },
    {
        id: 'diagrams',
        title: 'Diagrams',
        section: 'canvas-components',
        examples: ['workspace-diagram'],
    },
    {
        id: 'effects',
        title: 'Effects and loading',
        section: 'canvas-components',
        examples: ['effects-glass', 'effects-outline', 'loading-overlay', 'loading-layer'],
    },
    {
        id: 'workspace',
        title: 'Workspace components',
        section: 'canvas-components',
        examples: ['workspace-libraries', 'workspace-context', 'workspace-progress-review'],
    },
    {
        id: 'input',
        title: 'Input and agentic chat',
        section: 'canvas-components',
        examples: ['workspace-conversation', 'workspace-history', 'workspace-right-panel'],
    },
    {
        id: 'theme-presets',
        title: 'Presets and roles',
        section: 'themes',
        examples: ['themes-presets'],
    },
    {
        id: 'theme-scopes',
        title: 'Scoped themes',
        section: 'themes',
        examples: ['themes-scope'],
    },
    {
        id: 'theme-binding',
        title: 'Application binding',
        section: 'themes',
        examples: ['themes-binding'],
    },
    {
        id: 'action-panel',
        title: 'Action panel',
        section: 'ui-kit',
        examples: ['ui-kit-action-panel'],
    },
    {
        id: 'button',
        title: 'Button',
        section: 'ui-kit',
        examples: ['ui-kit-button'],
    },
    {
        id: 'text-fields',
        title: 'Text fields',
        section: 'ui-kit',
        examples: ['ui-kit-text-input'],
    },
    {
        id: 'application-panel',
        title: 'Application panel',
        section: 'ui-kit',
        examples: ['ui-kit-application-panel'],
    },
    {
        id: 'dropdowns',
        title: 'Dropdowns',
        section: 'ui-kit',
        examples: ['ui-kit-dropdown', 'ui-kit-sliding-dropdown', 'ui-kit-bubble-menu-dropdown'],
    },
    {
        id: 'switches',
        title: 'Switches and sliders',
        section: 'ui-kit',
        examples: ['ui-kit-toggle-switch', 'ui-kit-sliding-switch', 'ui-kit-sliding-tabs-switch', 'ui-kit-slider'],
    },
    {
        id: 'tag-pill',
        title: 'Tag pill',
        section: 'ui-kit',
        examples: ['ui-kit-tag-pill'],
    },
    {
        id: 'bubble-menu',
        title: 'Bubble menu',
        section: 'ui-kit',
        examples: ['ui-kit-bubble-menu'],
    },
    {
        id: 'tooltips',
        title: 'Tooltips and popovers',
        section: 'ui-kit',
        examples: ['ui-kit-help-tooltip', 'ui-kit-info-bubble', 'ui-kit-context-preview', 'ui-kit-interactive-preview'],
    },
    {
        id: 'progress',
        title: 'Progress',
        section: 'ui-kit',
        examples: ['ui-kit-progress-timeline', 'ui-kit-progress-ripple', 'ui-kit-canvas-node-footer'],
    },
    {
        id: 'error-placeholder',
        title: 'Error placeholder',
        section: 'ui-kit',
        examples: ['ui-kit-error-placeholder'],
    },
    {
        id: 'media-controls',
        title: 'Media controls',
        section: 'ui-kit',
        examples: ['ui-kit-video-controls', 'ui-kit-media-model-badge'],
    },
    {
        id: 'block-card-tiles',
        title: 'Block card tiles',
        section: 'ui-kit',
        examples: ['ui-kit-block-card-tiles'],
    },
    {
        id: 'auth-panel',
        title: 'Auth panel',
        section: 'ui-kit',
        examples: ['ui-kit-auth-panel'],
    },
    {
        id: 'typography',
        title: 'Typography and rows',
        section: 'ui-kit',
        examples: ['ui-kit-typography'],
    },
    {
        id: 'icons',
        title: 'Icons',
        section: 'ui-kit',
        examples: ['icons', 'ui-kit-animated-icons'],
    },
    {
        id: 'dom-templates',
        title: 'DOM templates',
        section: 'ui-primitives',
        examples: ['primitives-dom'],
    },
    {
        id: 'svg-geometry',
        title: 'SVG geometry',
        section: 'ui-primitives',
        examples: ['primitives-svg-icons', 'primitives-svg-paths'],
    },
    {
        id: 'easing',
        title: 'Easing',
        section: 'ui-primitives',
        examples: ['primitives-easing'],
    },
    {
        id: 'gradients',
        title: 'Gradients and color',
        section: 'ui-primitives',
        examples: ['primitives-shifting-gradient', 'primitives-color'],
    },
    {
        id: 'scrollbars',
        title: 'Scrollbars',
        section: 'ui-primitives',
        examples: ['primitives-scrollbars'],
    },
    {
        id: 'nested-list',
        title: 'Nested list',
        section: 'prosemirror',
        examples: ['nested-list'],
    },
    {
        id: 'rich-text',
        title: 'Rich text editing',
        section: 'prosemirror',
        examples: ['prosemirror-rich-text'],
    },
    {
        id: 'code-block',
        title: 'Code block',
        section: 'prosemirror',
        examples: ['prosemirror-code-block'],
    },
    {
        id: 'document-views',
        title: 'Document views',
        section: 'prosemirror',
        examples: ['prosemirror-document-view'],
    },
    {
        id: 'code-themes',
        title: 'Code editor themes',
        section: 'prosemirror-themes',
        examples: ['prosemirror-themes-gallery'],
    },
    {
        id: 'routing',
        title: 'Routing',
        section: 'web-client-service-factory',
        examples: ['web-client-router'],
    },
    {
        id: 'route-views',
        title: 'Route views',
        section: 'web-client-service-factory',
        examples: ['web-client-route-views'],
    },
    {
        id: 'stores',
        title: 'Stores',
        section: 'web-client-service-factory',
        examples: ['web-client-stores'],
    },
    {
        id: 'application',
        title: 'Application lifecycle',
        section: 'web-client-service-factory',
        examples: ['web-client-application'],
    },
]

export const getDocumentationDomain = (exampleId: string): DocumentationDomain | undefined => documentationDomains.find(
    domain => domain.examples.includes(exampleId),
)
