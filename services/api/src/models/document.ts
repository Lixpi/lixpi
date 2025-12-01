'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import { getDynamoDbTableStageName, type Document, type DocumentMeta, type DocumentAccessList } from '@lixpi/constants'
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
		userId
	}: Pick<Document, 'documentId' | 'revision'> & { userId: string }): Promise<Document | { error: string }> => {
		// console.log('key', { documentId, revision })
		const document = await dynamoDBService.getItem({
			tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
			key: { documentId, revision },
			origin: `model::Document->get(${documentId}:${revision})`
		})

		if (!document || Object.keys(document).length === 0) {
			return { error: 'NOT_FOUND' }
		}

		// Check if user has permission to access document
		return document?.accessList?.some(entry => entry.userId === userId)
			? document
			: { error: 'PERMISSION_DENIED'}
	},

	getUserDocuments: async ({
		userId
	}: { userId: string }): Promise<DocumentMeta[]> => {
		const userDocuments = await dynamoDBService.queryItems({
			tableName: getDynamoDbTableStageName('DOCUMENTS_ACCESS_LIST', ORG_NAME, STAGE),
			indexName: 'updatedAt',
			keyConditions: { userId: userId },
			limit: 25,
        	fetchAllItems: true,
			scanIndexForward: false,
			origin: 'model::Document->getUserDocuments()',
		})

		if (!userDocuments.items.length) {
			return []
		}

		const documentsMeta = await dynamoDBService.batchReadItems({
			queries: [{
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				keys: userDocuments.items.map(({documentId}) => ({documentId})),
			}],
			readBatchSize: 100,
        	fetchAllItems: true,
        	scanIndexForward: false,
			origin: 'model::Document->getUserDocuments()'
		})
		const documentsMetaItems = documentsMeta.items[getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE)]

		return userDocuments.items.map(document => documentsMetaItems.find(meta => meta.documentId === document.documentId)).filter(document => document)
	},

	createDocument: async ({
		title,
		content,
		permissions
	}: Pick<Document, 'title' | 'content'> & { permissions: { userId: string; accessLevel: string } }): Promise<Document | undefined> => {
		const currentDate = new Date().getTime()
		const revision = 1    // Default non-expiring revision

		const newDocumentData = {
			documentId: uuid(),    // Partition key    // TODO: guarantee that documentId is unique by checking if it already exists in the database
			revision,    // Sort key
			title,
			content,
			prevRevision: 1,
			createdAt: currentDate,
			updatedAt: currentDate,
			accessType: 'private',
			accessList: [{
				userId: permissions.userId,
				accessLevel: permissions.accessLevel
			}],
		}

		try {
			// Insert the new document data into the database
			await dynamoDBService.putItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				item: newDocumentData,
				origin: 'createDocument'
			})

			// Insert the new document metadata into the database
			await dynamoDBService.putItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				item: {
					documentId: newDocumentData.documentId,    // Partition key
					title: newDocumentData.title,
					tags: [],
					createdAt: newDocumentData.createdAt,
					updatedAt: newDocumentData.updatedAt
				},
				origin: 'createDocument'
			})

			// Insert the new document permissions into the database
			await dynamoDBService.putItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS_ACCESS_LIST', ORG_NAME, STAGE),
				item: {
					userId: permissions.userId,	// Partition key
					documentId: newDocumentData.documentId,	// Sort key
					accessLevel: permissions.accessLevel,
					createdAt: newDocumentData.createdAt,
					updatedAt: newDocumentData.updatedAt
				},
				origin: 'createDocument'
			})

			return newDocumentData
		} catch (e) {
			console.error(e)
		}
	},

	update: async ({
		title,
		content,
		documentId,
		prevRevision,
		permissions,
		userId
	}: Partial<Document> & { documentId: string; userId: string; permissions?: any }): Promise<void> => {
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
		userId
	}: Pick<Document, 'documentId'> & { userId: string }): Promise<{ status: string; documentId: string }> => {

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		//TODO check if user has permission to delete document

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		try {
			const result = await dynamoDBService.softDeleteItem({
				tableName: getDynamoDbTableStageName('DOCUMENTS', ORG_NAME, STAGE),
				key: { documentId, revision: 1 },
				timeToLiveAttributeName: 'revisionExpiresAt',
				timeToLiveAttributeValue: sliceTime({ precision: 'hours', modify: { operation: 'add', amount: 1, unit: 'hours' } }),
				origin: 'deleteDocument:Documents'
			})

			const result2 = await dynamoDBService.deleteItems({
				tableName: getDynamoDbTableStageName('DOCUMENTS_META', ORG_NAME, STAGE),
				key: { documentId },
				origin: 'deleteDocument:Meta'
			})

			const result3 = await dynamoDBService.deleteItems({
				tableName: getDynamoDbTableStageName('DOCUMENTS_ACCESS_LIST', ORG_NAME, STAGE),
				key: { userId: userId, documentId },
				origin: 'deleteDocument'
			})

			return { status: 'deleted', documentId } //TODO is this necessary? Probably just a rudiement of the old code
		}
		catch (e) {
			throw e;
		}
	}
}
