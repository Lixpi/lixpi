import { describe, expect, it } from 'vitest'

import {
    taskRowDefaultAttrs as packageTaskRowDefaultAttrs,
    taskRowNodeSpec as packageTaskRowNodeSpec,
    taskRowNodeType as packageTaskRowNodeType,
} from '@lixpi/prosemirror'
import { createProseMirrorSchema, DOCUMENT_TYPE } from '@lixpi/prosemirror'
import {
    defaultAttrs,
    taskRowNodeSpec,
    taskRowNodeType,
} from '$src/components/proseMirror/customNodes/taskRowNode.js'

const documentSchema = createProseMirrorSchema(DOCUMENT_TYPE.DOCUMENT)
const aiChatSchema = createProseMirrorSchema(DOCUMENT_TYPE.AI_CHAT_THREAD)

describe('taskRowNode re-exports', () => {
    it('re-exports the package node type and attrs constants', () => {
        expect(taskRowNodeType).toBe(packageTaskRowNodeType)
        expect(defaultAttrs).toBe(packageTaskRowDefaultAttrs)
    })

    it('re-exports the shared task row node spec by reference', () => {
        expect(taskRowNodeSpec).toBe(packageTaskRowNodeSpec)
    })

    it('exports default attrs that match the schema declaration', () => {
        expect(defaultAttrs).toEqual({
            taskKey: 'LIX-1',
            status: 'New Task Status',
            title: 'New Task Title',
            description: 'New Task Description',
        })
        expect(documentSchema.nodes[taskRowNodeType]).toBeDefined()
        expect(documentSchema.nodes[taskRowNodeType].spec).toBe(packageTaskRowNodeSpec)
        expect(aiChatSchema.nodes[taskRowNodeType].spec).toBe(packageTaskRowNodeSpec)
    })
})
