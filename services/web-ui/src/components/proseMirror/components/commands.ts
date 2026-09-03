import { v4 as uuidv4 } from 'uuid'
import { aiChatThreadNodeType } from '@lixpi/prosemirror'
import {
    type Command,
} from 'prosemirror-state'

export const insertAiChatThread: Command = (state, dispatch) => {
    const attrs = {
        threadId: uuidv4(),
        status: 'active',
    }

    const tr = state.tr.setMeta(`insert:${aiChatThreadNodeType}`, attrs)

    if (dispatch) {
        dispatch(tr)
        return true
    }

    return false
}
