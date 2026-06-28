import { v4 as uuidv4 } from 'uuid'
import { aiChatThreadNodeType } from '@lixpi/prosemirror'

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
