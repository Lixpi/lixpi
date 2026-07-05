import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    LoadingStatus,
    NATS_SUBJECTS,
} from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getTokenSilently: vi.fn(),
    getRouteParams: vi.fn(),
    request: vi.fn(),
    setDocuments: vi.fn(),
    setMetaValues: vi.fn(),
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: { getTokenSilently: mocks.getTokenSilently },
}))

vi.mock('$src/services/router-service.ts', () => ({
    default: { getRouteParams: mocks.getRouteParams },
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: vi.fn((key: string) => {
            if (key === 'nats') return { request: mocks.request }
            return null
        }),
    },
}))

vi.mock('$src/stores/documentsStore.ts', () => ({
    documentsStore: {
        setDocuments: mocks.setDocuments,
        setMetaValues: mocks.setMetaValues,
    },
}))

vi.mock('$src/stores/documentStore.ts', () => ({
    documentStore: {
        setDataValues: vi.fn(),
        setMetaValues: vi.fn(),
    },
}))

import DocumentService from './document-service.ts'
import { WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS } from './requestTimeouts.ts'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

describe('DocumentService.getWorkspaceDocuments', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getTokenSilently.mockResolvedValue('token-1')
        mocks.getRouteParams.mockReturnValue({ workspaceId: 'workspace-1' })
        mocks.request.mockResolvedValue([{ documentId: 'document-1' }])
    })

    it('uses the workspace route-load timeout and stores current-route documents', async () => {
        const service = new DocumentService()

        await service.getWorkspaceDocuments({ workspaceId: 'workspace-1' })

        expect(mocks.request).toHaveBeenCalledWith(WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS, {
            token: 'token-1',
            workspaceId: 'workspace-1',
        }, WORKSPACE_ROUTE_LOAD_REQUEST_TIMEOUT_MS)
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.loading })
        expect(mocks.setDocuments).toHaveBeenCalledWith([{ documentId: 'document-1' }])
        expect(mocks.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })
    })
})
