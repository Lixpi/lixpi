import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import {
    type RouteViewDefinition,
} from '@lixpi/web-client-service-factory'

import { createOverviewPage } from '$src/views/pages/overviewPage.ts'
import { createMotionPage } from '$src/views/pages/primitives/motionPage.ts'
import { createGradientsPage } from '$src/views/pages/primitives/gradientsPage.ts'
import { createSvgGeometryPage } from '$src/views/pages/primitives/svgGeometryPage.ts'
import { createIconsPage } from '$src/views/pages/uiKit/iconsPage.ts'
import { createSwitchesPage } from '$src/views/pages/uiKit/switchesPage.ts'
import { createSelectionPage } from '$src/views/pages/uiKit/selectionPage.ts'
import { createOverlaysPage } from '$src/views/pages/uiKit/overlaysPage.ts'
import { createSidePanelPage } from '$src/views/pages/uiKit/sidePanelPage.ts'
import { createProgressPage } from '$src/views/pages/uiKit/progressPage.ts'
import { createMediaControlsPage } from '$src/views/pages/uiKit/mediaControlsPage.ts'
import { createAuthPanelPage } from '$src/views/pages/uiKit/authPanelPage.ts'
import { createGentelellaFoundationPage } from '$src/views/pages/gentelella/foundationPage.ts'
import { createGentelellaButtonsPage } from '$src/views/pages/gentelella/buttonsPage.ts'
import { createGentelellaLayoutPage } from '$src/views/pages/gentelella/layoutPage.ts'
import { createGentelellaFeedbackPage } from '$src/views/pages/gentelella/feedbackPage.ts'
import { createGentelellaFormsPage } from '$src/views/pages/gentelella/formsPage.ts'
import { createGentelellaFormControlsPage } from '$src/views/pages/gentelella/formControlsPage.ts'
import { createGentelellaTablesPage } from '$src/views/pages/gentelella/tablesPage.ts'
import { createGentelellaChartsPage } from '$src/views/pages/gentelella/chartsPage.ts'
import { createGentelellaWidgetsPage } from '$src/views/pages/gentelella/widgetsPage.ts'
import { createGentelellaApplicationsPage } from '$src/views/pages/gentelella/applicationsPage.ts'
import { createGentelellaCommercePage } from '$src/views/pages/gentelella/commercePage.ts'
import { createGentelellaAdminPage } from '$src/views/pages/gentelella/adminPage.ts'
import { createGentelellaAuthPage } from '$src/views/pages/gentelella/authPage.ts'
import { createGentelellaMarketingPage } from '$src/views/pages/gentelella/marketingPage.ts'
import { createGentelellaMediaPage } from '$src/views/pages/gentelella/mediaPage.ts'
import { createGentelellaNavigationPage } from '$src/views/pages/gentelella/navigationPage.ts'
import { createGentelellaOverlaysPage } from '$src/views/pages/gentelella/overlaysPage.ts'
import { createGentelellaThemePage } from '$src/views/pages/gentelella/themePage.ts'
import { createCanvasScenePage } from '$src/views/pages/canvas/scenePage.ts'
import { createCanvasMediaPage } from '$src/views/pages/canvas/mediaPage.ts'
import { createCanvasEffectsPage } from '$src/views/pages/canvas/effectsPage.ts'
import { createCanvasLoadingPage } from '$src/views/pages/canvas/loadingPage.ts'
import { createWorkspaceRendererPage } from '$src/views/pages/canvas/workspaceRendererPage.ts'
import { createWorkspaceNodesPage } from '$src/views/pages/canvas/workspaceNodesPage.ts'
import { createWorkspaceOutputPage } from '$src/views/pages/canvas/workspaceOutputPage.ts'
import { createWorkspaceGenerationPage } from '$src/views/pages/canvas/workspaceGenerationPage.ts'
import { createWorkspaceComposerPage } from '$src/views/pages/canvas/workspaceComposerPage.ts'
import { createWorkspacePanelsPage } from '$src/views/pages/canvas/workspacePanelsPage.ts'

export type DesignSystemMode = 'canvas' | 'components'

export const OVERVIEW_ROUTE_PATH = '/components'
export const CANVAS_ROUTE_PATH = '/canvas'

export const DESIGN_SYSTEM_MODES: ReadonlyArray<{
    homePath: string
    label: string
    mode: DesignSystemMode
}> = [{
    homePath: OVERVIEW_ROUTE_PATH,
    label: 'Components',
    mode: 'components',
}, {
    homePath: CANVAS_ROUTE_PATH,
    label: 'Canvas',
    mode: 'canvas',
}]

export type DesignSystemRouteDefinition = RouteViewDefinition & {
    group: string
    iconHtml: string
    label: string
    mode: DesignSystemMode
    title: string
}

const route = (
    mode: DesignSystemMode,
    group: string,
    path: string,
    label: string,
    icon: keyof typeof GENTELELLA_ICONS,
    createView: DesignSystemRouteDefinition['createView'],
): DesignSystemRouteDefinition => ({
    createView,
    group,
    iconHtml: GENTELELLA_ICONS[icon],
    label,
    mode,
    path,
    title: label,
})

export const routes: DesignSystemRouteDefinition[] = [
    route(
        'components',
        'Overview',
        OVERVIEW_ROUTE_PATH,
        'Overview',
        'dashboard',
        createOverviewPage,
    ),
    route(
        'components',
        'UI primitives',
        '/components/primitives/motion',
        'Motion and easing',
        'charts',
        createMotionPage,
    ),
    route(
        'components',
        'UI primitives',
        '/components/primitives/gradients',
        'Color and gradients',
        'paint',
        createGradientsPage,
    ),
    route(
        'components',
        'UI primitives',
        '/components/primitives/svg',
        'SVG and DOM utilities',
        'code',
        createSvgGeometryPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/icons',
        'Icons and artwork',
        'icons',
        createIconsPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/switches',
        'Switches and pills',
        'ui',
        createSwitchesPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/selection',
        'Sliders and dropdowns',
        'forms',
        createSelectionPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/overlays',
        'Bubbles and tooltips',
        'chat',
        createOverlaysPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/side-panel',
        'Side panel',
        'layout',
        createSidePanelPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/progress',
        'Progress, lists and errors',
        'projects',
        createProgressPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/media',
        'Media controls',
        'media',
        createMediaControlsPage,
    ),
    route(
        'components',
        'Lixpi UI kit',
        '/components/ui-kit/auth-panel',
        'Auth panel',
        'users',
        createAuthPanelPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/foundation',
        'Foundation',
        'type',
        createGentelellaFoundationPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/buttons',
        'Buttons and commands',
        'ui',
        createGentelellaButtonsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/layout',
        'Page layout',
        'layout',
        createGentelellaLayoutPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/feedback',
        'Feedback',
        'bell',
        createGentelellaFeedbackPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/forms',
        'Forms',
        'forms',
        createGentelellaFormsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/form-controls',
        'Form controls',
        'settings',
        createGentelellaFormControlsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/tables',
        'Tables',
        'tables',
        createGentelellaTablesPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/charts',
        'Charts and maps',
        'charts',
        createGentelellaChartsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/widgets',
        'Widgets',
        'dashboard',
        createGentelellaWidgetsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/applications',
        'Applications',
        'kanban',
        createGentelellaApplicationsPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/commerce',
        'Commerce',
        'shop',
        createGentelellaCommercePage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/admin',
        'Admin',
        'profile',
        createGentelellaAdminPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/auth',
        'Authentication',
        'users',
        createGentelellaAuthPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/marketing',
        'Marketing',
        'price',
        createGentelellaMarketingPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/media',
        'Icons and media',
        'media',
        createGentelellaMediaPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/navigation',
        'Navigation',
        'map',
        createGentelellaNavigationPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/overlays',
        'Overlays',
        'pages',
        createGentelellaOverlaysPage,
    ),
    route(
        'components',
        'Gentelella UI kit',
        '/components/gentelella/theme',
        'Theme and classes',
        'paint',
        createGentelellaThemePage,
    ),
    route(
        'canvas',
        'Canvas engine',
        CANVAS_ROUTE_PATH,
        'Scene and interaction',
        'dashboard',
        createCanvasScenePage,
    ),
    route(
        'canvas',
        'Canvas components',
        '/canvas/media',
        'Media surfaces',
        'media',
        createCanvasMediaPage,
    ),
    route(
        'canvas',
        'Canvas components',
        '/canvas/effects',
        'Outlines and glass',
        'paint',
        createCanvasEffectsPage,
    ),
    route(
        'canvas',
        'Canvas components',
        '/canvas/loading',
        'Loading surface',
        'bell',
        createCanvasLoadingPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/workspace',
        'Workspace renderer',
        'layout',
        createWorkspaceRendererPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/nodes',
        'Nodes and markers',
        'projects',
        createWorkspaceNodesPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/output',
        'Output chrome',
        'ui',
        createWorkspaceOutputPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/generation',
        'Generation progress',
        'charts',
        createWorkspaceGenerationPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/composer',
        'Composer and context',
        'chat',
        createWorkspaceComposerPage,
    ),
    route(
        'canvas',
        'Lixpi workspace',
        '/canvas/panels',
        'Libraries and panels',
        'files',
        createWorkspacePanelsPage,
    ),
]

export const getRouteMode = (path: string): DesignSystemMode | null => routes.find(candidate => candidate.path === path)?.mode ?? null
