'use strict'

import { NATS_SUBJECTS, LoadingStatus } from '@lixpi/constants'

const { DOCUMENT_SUBJECTS, WORKSPACE_SUBJECTS } = NATS_SUBJECTS

import AuthService from './auth-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import { documentStore } from '$src/stores/documentStore.ts'

class DocumentService {
    constructor() {}

	public async getDocument({ workspaceId, documentId }: { workspaceId: string; documentId: string }): Promise<void> {
		documentStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

		try {
			const document: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.GET_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				workspaceId,
				documentId
			})

			if (document.error) {
				documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
				documentStore.setDataValues({ error: document.error })
				return
			}

			documentStore.setDataValues(document)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.success })

		} catch (error) {
			console.error('Failed to load document:', error)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
			documentStore.setDataValues({ error: error })
		}
	}


	public async getWorkspaceDocuments({ workspaceId }: { workspaceId: string }): Promise<void> {
        try {
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

			const documents: any = await servicesStore.getData('nats')!.request(WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS, {
				token: await AuthService.getTokenSilently(),
				workspaceId
			})
			documentsStore.setDocuments(Array.isArray(documents) ? documents : [])
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.success })
		} catch (error) {
			console.error('Failed to load workspace documents:', error)
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
		}
    }


	public async createDocument({ workspaceId, title, content }: { workspaceId: string; title: string; content: any }): Promise<any> {
		console.log('DocumentService.createDocument called with:', { workspaceId, title, content })
		try {
			const document: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.CREATE_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				workspaceId,
				title,
				content
			})
			console.log('DocumentService.createDocument response:', document)

			if (document.error) {
				console.error('Document creation error:', document.error)
				documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
				documentStore.setDataValues({ error: document.error })
				return null
			}

			documentStore.setDataValues(document)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.success })

			// Add document to the documents list
			documentsStore.addDocuments([document])

			return document

		} catch (error) {
			console.error('Failed to create document:', error)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
			documentStore.setDataValues({ error: error })
			return null
		}
	}


	public async updateDocument({ workspaceId, documentId, title, prevRevision, content }: { workspaceId?: string; documentId: string; title?: string; prevRevision?: number; content?: any }): Promise<void> {
		try {
			const updatePayload: any = {
				token: await AuthService.getTokenSilently(),
				documentId
			}
			if (workspaceId) updatePayload.workspaceId = workspaceId
			if (title !== undefined) updatePayload.title = title
			if (prevRevision !== undefined) updatePayload.prevRevision = prevRevision
			if (content !== undefined) updatePayload.content = content

			const documentUpdateResult: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.UPDATE_DOCUMENT, updatePayload)
		} catch (error) {
			console.error('Failed to update document:', error)
		}
    }

	public async deleteDocument({ workspaceId, documentId }: { workspaceId: string; documentId: string }): Promise<void> {
		try {
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

			const documentDeleteResult: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.DELETE_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				workspaceId,
				documentId
			})

			const { documentId: deletedDocumentId, success } = documentDeleteResult

			if (!success)
				throw new Error('Failed to delete document')

			// Remove document from the documents list
			documentsStore.deleteDocument(deletedDocumentId)
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.success })

		} catch (error) {
			console.error('Failed to delete document:', error)
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
		}
	}
}

export default DocumentService
