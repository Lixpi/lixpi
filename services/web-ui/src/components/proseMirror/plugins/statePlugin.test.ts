'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import {
    doc,
    p,
    response,
    createEditorState,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import { statePlugin } from '$src/components/proseMirror/plugins/statePlugin.js'

describe('statePlugin', () => {
    let onUpdateCallback: ReturnType<typeof vi.fn>
    let onTitleChangeCallback: ReturnType<typeof vi.fn>
    let onLiveUpdateCallback: ReturnType<typeof vi.fn>

    beforeEach(() => {
        onUpdateCallback = vi.fn()
        onTitleChangeCallback = vi.fn()
        onLiveUpdateCallback = vi.fn()
    })

    it('dispatches live update callbacks on every document change, even when skipDispatch is set', () => {
        const plugin = statePlugin({}, onUpdateCallback, onTitleChangeCallback, onLiveUpdateCallback)
        let state = EditorState.create({
            schema: testSchema,
            doc: createEditorState(doc(p('hello'))).doc,
            plugins: [plugin],
        })

        const tr = state.tr
            .insertText('!', state.selection.from)
            .setMeta('skipDispatch', true)
        state = state.apply(tr)

        expect(onLiveUpdateCallback).toHaveBeenCalledTimes(1)
        expect(onUpdateCallback).not.toHaveBeenCalled()
        expect(onTitleChangeCallback).not.toHaveBeenCalled()
    })

    it('does not dispatch callbacks when transaction does not change document content', () => {
        const plugin = statePlugin({}, onUpdateCallback, onTitleChangeCallback, onLiveUpdateCallback)
        let state = EditorState.create({
            schema: testSchema,
            doc: doc(p('hello')),
            plugins: [plugin],
        })

        const tr = state.tr.setMeta('skipDispatch', true)
        state = state.apply(tr)

        expect(onLiveUpdateCallback).not.toHaveBeenCalled()
        expect(onUpdateCallback).not.toHaveBeenCalled()
        expect(onTitleChangeCallback).not.toHaveBeenCalled()
    })

    it('dispatches update and title callbacks when title text changes and no streaming is in progress', () => {
        const plugin = statePlugin({}, onUpdateCallback, onTitleChangeCallback, onLiveUpdateCallback)
        let state = EditorState.create({
            schema: testSchema,
            doc: doc(p('')),
            plugins: [plugin],
        })

        const tr = state.tr.insertText('New title', state.selection.from)
        state = state.apply(tr)

        expect(onUpdateCallback).toHaveBeenCalledTimes(1)
        expect(onTitleChangeCallback).toHaveBeenCalledWith('New title')
        expect(onLiveUpdateCallback).toHaveBeenCalledTimes(1)
    })

    it('suppresses update and title callbacks while streaming attrs are present in doc', () => {
        const plugin = statePlugin({}, onUpdateCallback, onTitleChangeCallback, onLiveUpdateCallback)
        let state = EditorState.create({
            schema: testSchema,
            doc: doc(response({ isReceivingAnimation: true }, p('streaming'))),
            plugins: [plugin],
        })

        const tr = state.tr.insertText('!', state.selection.from)
        state = state.apply(tr)

        expect(onUpdateCallback).not.toHaveBeenCalled()
        expect(onTitleChangeCallback).not.toHaveBeenCalled()
        expect(onLiveUpdateCallback).toHaveBeenCalledTimes(1)
    })
})
