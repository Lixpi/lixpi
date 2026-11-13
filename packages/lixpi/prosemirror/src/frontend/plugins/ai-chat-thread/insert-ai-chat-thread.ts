import { aiChatThreadNodeType } from '@lixpi/prosemirror'
import {
    type Command,
} from 'prosemirror-state'

export const insertAiChatThread: Command = (
    state,
    dispatch,
) => {
    const attrs = {
        threadId: crypto.randomUUID(),
        status: 'active',
    }

    const tr = state.tr.setMeta(`insert:${aiChatThreadNodeType}`, attrs)

    if (dispatch) {
        dispatch(tr)

        return true
    }

    return false
}
