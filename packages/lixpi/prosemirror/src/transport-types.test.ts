import { describe, expect, it } from 'vitest'

import {
    getDocumentStepSubject,
    getWorkspaceStepStreamName,
    getWorkspaceStepStreamSubject,
    PROSEMIRROR_STEP_SUBJECT_PREFIX,
} from './transport-types.ts'

describe('stream name sanitization', () => {
    it('replaces illegal characters in workspace IDs', () => {
        expect(getWorkspaceStepStreamName('workspace/one two')).toBe('PM_STEPS_workspace_one_two')
        expect(getWorkspaceStepStreamName('ws!@#')).toBe('PM_STEPS_ws___')
    })
})

describe('workspace subject sanitization', () => {
    it('normalizes wildcard subjects for subscriptions', () => {
        expect(getWorkspaceStepStreamSubject('workspace/one two')).toBe(
            `${PROSEMIRROR_STEP_SUBJECT_PREFIX}.workspace_one_two.>`,
        )
    })
})

describe('document subject composition', () => {
    it('normalizes workspace, docType, and docId consistently', () => {
        const subject = getDocumentStepSubject({
            workspaceId: 'ws/one two',
            docType: 'aiChatThread',
            docId: 'doc:1/2',
        })
        expect(subject).toBe('document.steps.ws_one_two.aiChatThread.doc_1_2')
    })
})
