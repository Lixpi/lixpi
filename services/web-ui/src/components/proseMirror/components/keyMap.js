import {
    wrapIn,
    setBlockType,
    chainCommands,
    toggleMark,
    exitCode,
    joinUp,
    joinDown,
    lift,
    selectParentNode
} from "prosemirror-commands"
import { TextSelection } from 'prosemirror-state';
import {wrapInList, splitListItem, liftListItem, sinkListItem} from "prosemirror-schema-list"
import {undo, redo} from "prosemirror-history"
import {undoInputRule} from "prosemirror-inputrules"

import { documentTitleNodeType } from "../customNodes/documentTitleNode.js"
import { useAiInput, insertAiChatThread } from "./commands.js"

const mac = typeof navigator != "undefined" ? /Mac|iP(hone|[oa]d)/.test(navigator.platform) : false

export const buildKeymap = (schema, mapKeys) => {
    let keys = {}, type
    const bind = (key, cmd) => {
        if (mapKeys) {
            let mapped = mapKeys[key]
            if (mapped === false) return
            if (mapped) key = mapped
        }
        keys[key] = cmd
    }

    bind("Mod-z", undo)
    bind("Shift-Mod-z", redo)
    bind("Backspace", undoInputRule)
    if (!mac) bind("Mod-y", redo)

    bind("Alt-ArrowUp", joinUp)
    bind("Alt-ArrowDown", joinDown)
    bind("Mod-BracketLeft", lift)
    bind("Escape", selectParentNode)

    /**
     * This 'Mod-a' keybinding customized the 'Select All' (Ctrl/Cmd+A) action in the context of our editor.
     *
     * When the cursor is inside a `documentTitleNodeType` node, it selects only the content within that node.
     * If the cursor is outside, it selects all content from the first non-title node to the end.
     *
     * If a title node is not found, or the document only contains the title node, the function will not modify the selection.
     */
    bind("Mod-a", (state, dispatch) => {
        const {doc, tr, selection} = state;
        const {nodes} = state.schema;
        let selFrom, selTo;

        if (selection.$head.parent.type.name === documentTitleNodeType) {
            // Cursor is inside node of `documentTitleNodeType`
            const parentNode = selection.$head.parent;
            selFrom = selection.$head.start();
            selTo = selFrom + parentNode.content.size;
        } else {
            // Cursor is outside node of `documentTitleNodeType`
            doc.forEach((node, pos) => {
                if (node.type === nodes[documentTitleNodeType]) {
                    selFrom = pos + node.nodeSize;
                }
            });
            // If `documentTitleNodeType` not found or it's the only node in the doc
            if (selFrom == null || selFrom >= doc.content.size) return false;
            selTo = doc.content.size - 1; //- excluding end-of-document node
        }

        if (selTo > selFrom) {
            const textSelection = TextSelection.create(doc, selFrom, selTo);
            dispatch(tr.setSelection(textSelection));
            return true;
        }
        return false;
    });


    if (type = schema.marks.strong) {
        bind("Mod-b", toggleMark(type))
        bind("Mod-B", toggleMark(type))
    }

    // AI Input trigger - needs to be before italic binding to take precedence
    bind("Mod-i", useAiInput)
    bind("Mod-I", useAiInput)

    // AI Chat Thread trigger
    bind("Mod-Shift-i", insertAiChatThread)
    bind("Mod-Shift-I", insertAiChatThread)

    if (type = schema.marks.em) {
        // Note: Mod-i is now used for AI Input, Mod-Shift-i for AI Chat Thread
        // Original italic binding moved to different keys if needed
        bind("Mod-Alt-i", toggleMark(type))
        bind("Mod-Alt-I", toggleMark(type))
    }
    if (type = schema.marks.code)
    bind("Mod-`", toggleMark(type))

    if (type = schema.nodes.bullet_list)
    bind("Shift-Ctrl-8", wrapInList(type))
    if (type = schema.nodes.ordered_list)
    bind("Shift-Ctrl-9", wrapInList(type))
    if (type = schema.nodes.blockquote)
    bind("Ctrl->", wrapIn(type))
    if (type = schema.nodes.hard_break) {
        let br = type, cmd = chainCommands(exitCode, (state, dispatch) => {
            if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView())
            return true
        })
        bind("Mod-Enter", cmd)
        bind("Shift-Enter", cmd)
        if (mac) bind("Ctrl-Enter", cmd)
    }
    if (type = schema.nodes.list_item) {
        bind("Enter", splitListItem(type))
        bind("Mod-[", liftListItem(type))
        bind("Mod-]", sinkListItem(type))
    }
    if (type = schema.nodes.paragraph)
    bind("Shift-Ctrl-0", setBlockType(type))
    if (type = schema.nodes.code_block)
    bind("Shift-Ctrl-\\", setBlockType(type))
    if (type = schema.nodes.heading)
    for (let i = 1; i <= 6; i++) bind("Shift-Ctrl-" + i, setBlockType(type, {level: i}))
    if (type = schema.nodes.horizontal_rule) {
        let hr = type
        bind("Mod-_", (state, dispatch) => {
            if (dispatch) dispatch(state.tr.replaceSelectionWith(hr.create()).scrollIntoView())
            return true
        })
    }

    return keys
}