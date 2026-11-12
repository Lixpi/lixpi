import {
    type EditorServices,
} from '@lixpi/prosemirror/frontend/editor'
import {
    type DocumentAuthorityTransport,
} from '@lixpi/prosemirror/frontend/document-authority'
import {
    type DocumentKindRegistry,
} from '@lixpi/prosemirror/shared/document-kind'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'

import { webUiDocumentKinds } from '$src/document-kinds.ts'
import {
    type AssetService,
} from '$src/services/asset-service.ts'
import { createDocumentAuthorityTransport } from './document-authority-transport.ts'
import { createWebUiEditorServices } from './editor-services.ts'

// What every web UI editor mount needs: the kinds the app registers, the
// editor services and the document authority transport.
export type WebUiEditorEnvironment = {
    registry: DocumentKindRegistry
    services: EditorServices
    authorityTransport: DocumentAuthorityTransport
}

export const createWebUiEditorEnvironment = (
    assetService: AssetService,
    auth: AuthClientInstance,
): WebUiEditorEnvironment => ({
    registry: webUiDocumentKinds,
    services: createWebUiEditorServices(auth),
    authorityTransport: createDocumentAuthorityTransport(assetService, auth),
})
