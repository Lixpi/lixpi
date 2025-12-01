import { v4 as uuidv4 } from 'uuid'
import { nodeTypes } from "../customNodes"
import { aiChatThreadNodeType } from '../plugins/aiChatThreadPlugin/aiChatThreadNode.ts'

export const useAiInput = (state, dispatch) => {
    const attrs = {}
    const tr = state.tr.setMeta(`insert:${nodeTypes.aiUserInputNodeType}`, attrs)

    if (dispatch) {
        dispatch(tr)
        return true
    }

    return false
}

export const insertAiChatThread = (state, dispatch) => {
    const attrs = {
        threadId: uuidv4(),
        status: 'active'
    }

    const tr = state.tr.setMeta(`insert:${aiChatThreadNodeType}`, attrs)

    if (dispatch) {
        dispatch(tr)
        return true
    }

    return false
}