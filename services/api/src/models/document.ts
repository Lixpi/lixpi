'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import { getDynamoDbTableStageName, type Document, type DocumentMeta } from '@lixpi/constants'
import type { Partial, Pick } from 'type-fest'

const {
	ORG_NAME,
	STAGE
} = process.env

import User from './user.ts'

export default {
	getDocument: async ({
		documentId,
		workspaceId
	}: Pick<Document, 'documentId' | 'workspaceId'>): Promise<Document | { error: string }> => {
		const document = await dynamoDBService.getItem({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			key: { workspaceId, documentId },
			origin: `model::Document->get(${documentId})`
		})

		if (!document || Object.keys(document).length === 0) {
			return { error: 'NOT_FOUND' }
		}

		return document
	},

	getWorkspaceDocuments: async ({
		workspaceId
	}: { workspaceId: string }): Promise<Document[]> => {
		const documents = await dynamoDBService.queryItems({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			keyConditions: { workspaceId },
			fetchAllItems: true,
			origin: 'model::Document->getWorkspaceDocuments()'
		})

		// Newest-first in memory over the workspace partition
		return (documents?.items || [])
			.sort((left: Document, right: Document) => right.updatedAt - left.updatedAt)
	},

	createDocument: async ({
		workspaceId,
		title,
		content
	}: Pick<Document, 'workspaceId' | 'title' | 'content'>): Promise<Document | undefined> => {
		const currentDate = new Date().getTime()

		const newDocumentData: Document = {
			documentId: uuid(),
			workspaceId,
			title,
			content,
			createdAt: currentDate,
			updatedAt: currentDate
		}

		try {
			await dynamoDBService.transactWrite({
				operations: [
					{
						type: 'put',
						tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
						item: newDocumentData
					},
					{
						type: 'put',
						tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
						item: {
							documentId: newDocumentData.documentId,
							workspaceId: newDocumentData.workspaceId,
							title: newDocumentData.title,
							tags: [],
							createdAt: newDocumentData.createdAt,
							updatedAt: newDocumentData.updatedAt
						}
					}
				],
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
		workspaceId,
		proseMirrorVersion
	}: Partial<Document> & { documentId: string; workspaceId: string }): Promise<void> => {
		const currentDate = new Date().getTime()

		// TODO: Check if user has permission to update document

		try {
			const documentUpdates: Record<string, unknown> = {
				updatedAt: currentDate
			}
			if (title !== undefined) documentUpdates.title = title
			if (content !== undefined) documentUpdates.content = content
			if (proseMirrorVersion !== undefined) documentUpdates.proseMirrorVersion = proseMirrorVersion

			const documentMetaUpdates: Record<string, unknown> = {
				updatedAt: currentDate
			}
			if (title !== undefined) documentMetaUpdates.title = title

			await dynamoDBService.transactWrite({
				operations: [
					{
						type: 'update',
						tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
						key: { workspaceId, documentId },
						updates: documentUpdates
					},
					{
						type: 'update',
						tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
						key: { documentId },
						updates: documentMetaUpdates
					}
				],
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
			await dynamoDBService.transactWrite({
				operations: [
					{
						type: 'delete',
						tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
						key: { workspaceId, documentId }
					},
					{
						type: 'delete',
						tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
						key: { documentId }
					}
				],
				origin: 'deleteDocument'
			})

			return { status: 'deleted', documentId }
		} catch (error) {
			throw error
		}
	},

	importDocument: async ({
		documentId,
		workspaceId,
		title,
		content,
		createdAt,
		updatedAt
	}: Pick<Document, 'documentId' | 'workspaceId' | 'title' | 'content' | 'createdAt' | 'updatedAt'>): Promise<Document | undefined> => {
		const documentData: Document = {
			documentId,
			workspaceId,
			title,
			content,
			createdAt,
			updatedAt
		}

		try {
			await dynamoDBService.transactWrite({
				operations: [
					{
						type: 'put',
						tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
						item: documentData
					},
					{
						type: 'put',
						tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
						item: {
							documentId,
							workspaceId,
							title,
							tags: [],
							createdAt,
							updatedAt
						}
					}
				],
				origin: 'importDocument'
			})

			return documentData
		} catch (error) {
			console.error('Failed to import document:', error)
		}
	},

	deleteWorkspaceDocuments: async ({
		workspaceId
	}: { workspaceId: string }): Promise<number> => {
		const documents = await dynamoDBService.queryItems({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			keyConditions: { workspaceId },
			fetchAllItems: true,
			origin: 'deleteWorkspaceDocuments:query'
		})

		const allDocuments = documents?.items || []
		let deletedCount = 0

		// One transaction per document: its row and its meta row commit or fail together
		for (const doc of allDocuments) {
			try {
				await dynamoDBService.transactWrite({
					operations: [
						{
							type: 'delete',
							tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
							key: { workspaceId, documentId: doc.documentId }
						},
						{
							type: 'delete',
							tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
							key: { documentId: doc.documentId }
						}
					],
					origin: 'deleteWorkspaceDocuments'
				})

				deletedCount++
			} catch (error) {
				console.error(`Failed to delete document ${doc.documentId}:`, error)
			}
		}

		return deletedCount
	}
}
