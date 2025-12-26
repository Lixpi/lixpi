'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import { getDynamoDbTableStageName, type Document, type DocumentMeta, type DocumentFile } from '@lixpi/constants'
import type { Partial, Pick } from 'type-fest'

const {
	ORG_NAME,
	STAGE
} = process.env

import { sliceTime } from '../helpers/time-operations.ts'
import User from './user.ts'

export default {
	getDocument: async ({
		documentId,
		revision,
		workspaceId
	}: Pick<Document, 'documentId' | 'revision' | 'workspaceId'>): Promise<Document | { error: string }> => {
		const document = await dynamoDBService.getItem({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			key: { documentId, revision },
			origin: `model::Document->get(${documentId}:${revision})`
		})

		if (!document || Object.keys(document).length === 0) {
			return { error: 'NOT_FOUND' }
		}

		if (document.workspaceId !== workspaceId) {
			return { error: 'DOCUMENT_NOT_IN_WORKSPACE' }
		}

		return document
	},

	getWorkspaceDocuments: async ({
		workspaceId
	}: { workspaceId: string }): Promise<Document[]> => {
		const documents = await dynamoDBService.queryItems({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			indexName: 'workspaceId',
			keyConditions: { workspaceId },
			fetchAllItems: true,
			scanIndexForward: false,
			origin: 'model::Document->getWorkspaceDocuments()'
		})

		// Filter to only get the latest revision (revision = 1) in memory
		const latestRevisions = (documents?.items || []).filter((doc: Document) => doc.revision === 1)
		return latestRevisions
	},

	createDocument: async ({
		workspaceId,
		title,
		content
	}: Pick<Document, 'workspaceId' | 'title' | 'content'>): Promise<Document | undefined> => {
		const currentDate = new Date().getTime()
		const revision = 1

		const newDocumentData: Document = {
			documentId: uuid(),
			workspaceId,
			revision,
			title,
			content,
			prevRevision: 1,
			createdAt: currentDate,
			updatedAt: currentDate
		}

		try {
			await dynamoDBService.putItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				item: newDocumentData,
				origin: 'createDocument'
			})

			await dynamoDBService.putItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				item: {
					documentId: newDocumentData.documentId,
					workspaceId: newDocumentData.workspaceId,
					title: newDocumentData.title,
					tags: [],
					createdAt: newDocumentData.createdAt,
					updatedAt: newDocumentData.updatedAt
				},
				origin: 'createDocument'
			})

			return newDocumentData
		} catch (error) {
			console.error('Failed to create document:', error)
		}
	},

	update: async ({
		title,
		content,
		documentId,
		prevRevision,
		workspaceId
	}: Partial<Document> & { documentId: string; workspaceId: string }): Promise<void> => {
		const currentDate = new Date().getTime()
		const currentRevision = sliceTime({ precision: 'hours' })

		// TODO: Check if user has permission to update document

		try {
			// Create a new revision save point if the current revision is greater than the previous revision
			// if(prevRevision < currentRevision) {
			// 	await dynamoDBService.putItem({
			// 		tableName: DYNAMODB_TABLES.DOCUMENTS,
			// 		partitionKeyName: 'documentId',
			// 		partitionKeyValue: documentId,
			// 		sortKeyName: 'revision',
			// 		sortKeyValue: currentRevision,
			// 		item: {
			// 			title,
			// 			aiModel,
			// 			content,
			// 			prevRevision,
			// 			revisionExpiresAt: sliceTime({ precision: 'hours', modify: { operation: 'add', amount: 1, unit: 'hours' } }),
			// 			createdAt: currentDate,
			// 			updatedAt: currentDate,
			// 		},
			// 		origin: 'updateDocument::revisionSavePoint'
			// 	})
			// }

			await dynamoDBService.updateItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				updates: {
					title,
					// prevRevision: currentRevision,    // TODO: turn back on when versioning is ready
					content,
					updatedAt: currentDate
				},
				origin: 'updateDocument'
			})

			await dynamoDBService.updateItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				updates: {
					title,
					updatedAt: currentDate
				},
				origin: 'updateDocument'
			})
		}
		catch (e) {
			console.error(e)
		}
	},

	addTagToDocument: async ({
		documentId,
		tagId,
		userId
	}: Pick<DocumentMeta, 'documentId'> & { tagId: string; userId: string }): Promise<{ tagId: string; status: string } | null> => {
		const currentDate = new Date().getTime();

		try {
			// Retrieve the current tags
			const currentDocumentMeta = await dynamoDBService.getItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				origin: 'model::Document->addTagToDocument()'
			});

			const currentTags = currentDocumentMeta?.tags || [];

			// Check if the tag is already present
			if (!currentTags.includes(tagId)) {
				currentTags.push(tagId);

				// Update the document with the new tag
				await dynamoDBService.updateItem({
					tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
					key: { documentId },
					updates: {
						tags: currentTags,
						updatedAt: currentDate
					},
					origin: 'model::Document->addTagToDocument()'
				});
			}

			// Add tag to user's recent tags
			await User.addRecentTag({ userId: userId, tagId });

			return { tagId, status: 'added' };
		} catch (e) {
			console.error(e);
			return null;
		}
	},

	removeTagFromDocument: async ({
		documentId,
		tagId
	}: Pick<DocumentMeta, 'documentId'> & { tagId: string }): Promise<{ status: string; tagId: string } | null> => {
		const currentDate = new Date().getTime();

		try {
			// Retrieve the current tags
			const currentDocumentMeta = await dynamoDBService.getItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				origin: 'model::Document->removeTagFromDocument()'
			});

			const currentTags = currentDocumentMeta?.tags || [];

			// Remove the tag if it exists
			const updatedTags = currentTags.filter((tag: string) => tag !== tagId);

			// Update the document with the modified tags
			await dynamoDBService.updateItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				updates: {
					tags: updatedTags,
					updatedAt: currentDate
				},
				origin: 'model::Document->removeTagFromDocument()'
			});

			return { status: 'removed', tagId };
		} catch (e) {
			console.error(e);
			return null;
		}
	},

	delete: async ({
		documentId,
		workspaceId
	}: Pick<Document, 'documentId' | 'workspaceId'>): Promise<{ status: string; documentId: string }> => {
		try {
			await dynamoDBService.softDeleteItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				timeToLiveAttributeName: 'revisionExpiresAt',
				timeToLiveAttributeValue: sliceTime({ precision: 'hours', modify: { operation: 'add', amount: 1, unit: 'hours' } }),
				origin: 'deleteDocument:Documents'
			})

			await dynamoDBService.deleteItems({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				origin: 'deleteDocument:Meta'
			})

			return { status: 'deleted', documentId }
		} catch (error) {
			throw error
		}
	},

	addFile: async ({
		documentId,
		file
	}: { documentId: string; file: DocumentFile }): Promise<void> => {
		try {
			// Get current document to append to files array
			const document = await dynamoDBService.getItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				origin: 'addFile:getDocument'
			})

			const currentFiles = document?.files || []
			const updatedFiles = [...currentFiles, file]

			await dynamoDBService.updateItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				updates: {
					files: updatedFiles,
					updatedAt: Date.now()
				},
				origin: 'addFile'
			})
		} catch (e) {
			throw e
		}
	},

	removeFile: async ({
		documentId,
		fileId
	}: { documentId: string; fileId: string }): Promise<void> => {
		try {
			// Get current document to filter out the file
			const document = await dynamoDBService.getItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				origin: 'removeFile:getDocument'
			})

			const currentFiles = document?.files || []
			const updatedFiles = currentFiles.filter((f: DocumentFile) => f.id !== fileId)

			await dynamoDBService.updateItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				updates: {
					files: updatedFiles,
					updatedAt: Date.now()
				},
				origin: 'removeFile'
			})
		} catch (e) {
			throw e
		}
	}
}
