'use strict'

import {
	DOCUMENT_SUBJECTS,
	LoadingStatus,
} from '@lixpi/constants'

import AuthService from './auth0-service.ts'
import RouterService from './router-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import { documentStore } from '$src/stores/documentStore.ts'

class DocumentService {
    constructor() {}

	public async getDocument({ documentId }: { documentId: string }): Promise<void> {
		documentStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

		try {
			const document: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.GET_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
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


	public async getUserDocuments() {
        try {
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

			const documents: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.GET_USER_DOCUMENTS, {
				token: await AuthService.getTokenSilently(),
			})
			documentsStore.setDocuments(documents)
		} catch (error) {
			console.error('Failed to load user documents:', error)
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
			documentsStore.setDataValues({ error: error })
		}
    }


	async createDocument({ title, content }) {
		try {
			const document: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.CREATE_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				title,
				content
			})

			if (document.error) {
				documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
				documentStore.setDataValues({ error: document.error })
				return
			}

			documentStore.setDataValues(document)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.success })

			// Add document to the documents list in sidebar
			documentsStore.addDocuments([document])

			RouterService.navigateTo('/document/:documentId', {
				params: { documentId: document.documentId },
				shouldFetchData: true
			})
        	documentStore.setMetaValues({ isRendered: false })    // Trigger editor re-render after project creation

		} catch (error) {
			console.error('Failed to load document:', error)
			documentStore.setMetaValues({ loadingStatus: LoadingStatus.error })
			documentStore.setDataValues({ error: error })
		}
	}


	public async updateDocument({ title, prevRevision, content, documentId }) {
		try {
			const documentUpdateResult: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.UPDATE_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				documentId,
				title,
				prevRevision,
				content,
			})
		} catch (error) {
			console.error('Failed to load update document:', error)
			documentsStore.setDataValues({ error: error })
		}
    }

	public async deleteDocument({ documentId }) {
		try {
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

			const documentDeleteResult: any = await servicesStore.getData('nats')!.request(DOCUMENT_SUBJECTS.DELETE_DOCUMENT, {
				token: await AuthService.getTokenSilently(),
				documentId
			})

			const { documentId: deletedDocumentId, success } = documentDeleteResult

			if(!success)
				throw new Error('Failed to delete document')

			const currentDocumentIndex = documentsStore.getData().findIndex(document => document.documentId === deletedDocumentId)

			// Remove project from the sidebar
			documentsStore.deleteDocument(deletedDocumentId)    // Order matters, delete project from documentsStore first

			// And then navigate to the next available project
			const currentdocumentId = RouterService.getRouteParams().documentId
			const isDeletingCurrentlyOpenedDocument = currentdocumentId === deletedDocumentId
			const shiftedProjectIndex = Math.max(currentDocumentIndex -1, 0)
			const prevDocumentId = documentsStore.getData()[shiftedProjectIndex]?.documentId

			if (isDeletingCurrentlyOpenedDocument) {
				if (prevDocumentId) {
					RouterService.navigateTo('/document/:documentId', {
						params: { documentId: prevDocumentId },
						shouldFetchData: true
					})
					documentStore.setMetaValues({ isRendered: false })    // Trigger editor re-render after project creation

				} else {
					RouterService.navigateTo('/', { params: {} })
					documentStore.setMetaValues({ isRendered: false, isLoaded: false })    // Trigger editor re-render after project creation
				}
			}


		} catch (error) {
			console.error('Failed to delete user documents:', error)
			documentsStore.setMetaValues({ loadingStatus: LoadingStatus.error })
			documentsStore.setDataValues({ error: error })
		}
	}

	addTagToDocument({ documentId, tagId, organizationId }) {
        // SocketService.emit({
        //     event: DOCUMENT_SUBJECTS.ADD_TAG_TO_DOCUMENT,
        //     data: {
        //         documentId,
        //         tagId,
        //         organizationId
        //     }
        // })
    }
    _addTagToDocumentResponse(data) {
		// if (data.error) {
		// 	// Handle error case
		// 	documentStore.setMetaValues({ isLoaded: true, errorLoading: data.error });
		// } else {
		// 	// Assuming data contains updated project tags
		// 	const updatedTags = data.tags;

		// 	// Update the tags in the project data
		// 	documentStore.setDataValues({ tags: updatedTags });

		// 	// Set metadata indicating successful loading
		// 	documentStore.setMetaValues({ isLoaded: true, errorLoading: false });
		// }
	}

    removeTagFromDocument({ documentId, tagId }) {
        // SocketService.emit({
        //     event: DOCUMENT_SUBJECTS.REMOVE_TAG_FROM_DOCUMENT,
        //     data: {
        //         documentId,
        //         tagId
        //     }
        // })
    }

    _removeTagFromDocumentResponse(data) {
    }
}

export default DocumentService
