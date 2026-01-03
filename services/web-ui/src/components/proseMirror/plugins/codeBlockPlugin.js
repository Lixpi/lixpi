'use strict'

import { Decoration, DecorationSet } from 'prosemirror-view';
import { TextSelection, Selection, Plugin, PluginKey } from 'prosemirror-state';
import { inputRules } from "prosemirror-inputrules"
import {
    EditorView as CodeMirrorEditorView,
    keymap as cmKeymap,
    drawSelection,
    highlightSpecialChars,
    lineNumbers
} from '@codemirror/view';
import { EditorState as CodeMirrorEditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

// Themes
// import { basicLight } from 'cm6-theme-basic-light'
// import { basicDark } from 'cm6-theme-basic-dark'
// import { solarizedDark } from 'cm6-theme-solarized-dark'
// import { solarizedLight } from 'cm6-theme-solarized-light'
// import { materialDark } from 'cm6-theme-material-dark'
// import { nord } from 'cm6-theme-nord'
import { gruvboxLight } from '$src/components/proseMirror/themes/cm6-themes/packages/gruvbox-light/src/index'
import { gruvboxDark } from '$src/components/proseMirror/themes/cm6-themes/packages/gruvbox-dark/src/index'

import { undo, redo } from 'prosemirror-history';
import { exitCode } from 'prosemirror-commands';

const key = new PluginKey('codeBlockPlugin')
const transactionName = 'insertCodeBlock'

const THEMES = {
    // cm6 themes
    // basicLight,
    // basicDark,
    // solarizedDark,
    // solarizedLight,
    // materialDark,
    // nord,
    gruvboxLight,
    gruvboxDark,

}


class CodeBlockView {
    constructor(node, view, getPos, schema) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.schema = schema;
        this.updating = false;

        // console.log('node.attrs', node.attrs)

        // Create a new instance of CodeMirror
        this.cm = new CodeMirrorEditorView({
            state: CodeMirrorEditorState.create({
                doc: node.textContent,
                extensions: [
                    // basicLight,      // Light :: Shit, hard to read
                    // basicDark,           // Dark :: !!! Quite decent
                    // solarizedDark,           // Dark :: !!! Quite decent
                    // solarizedLight,        // Light, yellow :: shit
                    // materialDark,            // Dark :: Not shit, but not the greatest
                    // nord,                    // Dark :: Shit
                    gruvboxLight,               // Light :: !!!!!!! awesome
                    // gruvboxDark,                  // Dark :: !!!!!!! awesome

                    // THEMES[node.attrs.theme] || THEMES['gruvboxDark'],             // In case if I would ever want allow user to select their theme, which mostly likely isn't going to happen
                    cmKeymap.of([
                        ...this.codeMirrorKeymap(),
                        ...defaultKeymap,
                        indentWithTab
                    ]),
                    drawSelection(),
                    syntaxHighlighting(defaultHighlightStyle),
                    javascript(),
                    highlightSpecialChars(),
                    // highlightActiveLine(),
                    CodeMirrorEditorView.lineWrapping,
                    CodeMirrorEditorState.allowMultipleSelections.of(true),
                    CodeMirrorEditorView.updateListener.of(update => this.forwardUpdate(update)),
                    lineNumbers(),
                ]
            }),
            parent: document.createElement('div')
        });

        // The wrapper element holds the editor and is used as the node view's DOM
        this.wrapper = this.cm.dom.parentNode;

        // Append CodeMirror to the NodeView
        this.wrapper.classList.add('code-block-wrapper');
        this.dom = this.wrapper;

        this.dom.CodeMirrorView = this;

        // Listen to mouseup events on the CodeMirror editor's DOM element
        this.cm.dom.addEventListener('mouseup', this.handleMouseUpOutOfCodeMirror.bind(this), false);
        this.selectAllCommand = this.selectAllCommand.bind(this);

        // Make sure that the cursor is moved inside the CodeMirror node when CodeMirror node is inserted
        // FINDME This causes cursor to jump into codeMirror whenever enter is pressed :(
        // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
        // setTimeout(() => {
        //     this.cm.focus();
        // }, 0);
    }

    handleMouseUpOutOfCodeMirror(event) {
        // Check if we have a valid selection within this CodeMirror instance before potentially clearing selections.
        if (!this.updating && this.cm.hasFocus) {
            // Check if there is text selected within this CodeMirror instance
            if (this.cm.state.selection.ranges.some(range => !range.empty)) {
                // The selection should be preserved in this case, without calling clearAllCodeMirrorSelections
                return;
            }
            this.clearAllCodeMirrorSelections();
            this.syncProseMirrorSelection();
        }
    }

    clearAllCodeMirrorSelections() {
        this.view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'code_block') {
                const nodeDOM = this.view.nodeDOM(pos);
                const codeMirrorInstance = nodeDOM && nodeDOM.CodeMirrorView;
                if (codeMirrorInstance && codeMirrorInstance.cm) {
                    codeMirrorInstance.cm.dispatch({
                        selection: { anchor: codeMirrorInstance.cm.state.selection.main.head, head: codeMirrorInstance.cm.state.selection.main.head }
                    });
                }
            }
        });
    }

    // Add integration with new sync methods
    setupEventHandlers() {
        // Call this method right after initializing this.cm in the constructor
        this.cm.dom.addEventListener('focus', this.forwardToProseMirror.bind(this));
        this.cm.dom.addEventListener('blur', this.forwardToProseMirror.bind(this));
        this.cm.dom.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.cm.dom.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    forwardToProseMirror(event) {
        if (event.type === 'blur') {
            console.log('Blurring CodeMirror.');
            this.syncProseMirrorSelection();
        } else if (event.type === 'focus') {
            console.log('Focusing CodeMirror.');
            this.syncCodeMirrorSelection(this.view.state, this.view.dispatch);
        }
    }

    handleMouseDown(event) {
        const { state, dispatch } = this.view;

        this.selectionInProgress = true;

        if (!state.selection.empty) {
            return
        }

        this.forSelectionSync = setTimeout(() => {
            // Sync selections once the mouse is released
            this.syncProseMirrorSelection();
            this.syncCodeMirrorSelection(state, dispatch);
        }, 0);
    }

    // handleMouseUp(event) {
    //     if (this.selectionInProgress) {
    //         this.selectionInProgress = false;
    //         this.syncProseMirrorSelection();
    //     }
    // }

    handleMouseUp(event) {
        if (this.selectionInProgress) {
            this.selectionInProgress = false;

            // Sync the selection that was just made
            this.syncProseMirrorSelection();

            // Clear the selections from all other CodeMirror instances
            // Except the current instance to keep its selection
            const pos = this.getPos();
            this.view.state.doc.descendants((node, nodePos) => {
                // Find other CodeMirror instances
                if (node.type.name === 'code_block' && nodePos !== pos) {
                    const nodeDOM = this.view.nodeDOM(nodePos);
                    const otherCodeMirrorView = nodeDOM && nodeDOM.CodeMirrorView;
                    if (otherCodeMirrorView && otherCodeMirrorView.cm) {
                        // Clear selection only if it is not the current clicked instance
                        if (otherCodeMirrorView !== this) {
                            // Dispatch an empty selection to clear it
                            otherCodeMirrorView.cm.dispatch({
                                selection: { anchor: nodePos + 1, head: nodePos + 1 }
                            });
                        }
                    }
                }
            });
        }
    }

    clearOtherCodeMirrorSelections() {
        // Clear the selection from all other CodeMirror instances in the ProseMirror document
        this.view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'code_block' && pos !== this.getPos()) {
                const codeMirrorInstance = this.view.nodeViews[node.attrs.id];
                if (codeMirrorInstance && codeMirrorInstance !== this && codeMirrorInstance.cm) {
                    codeMirrorInstance.cm.dispatch({
                        selection: { anchor: codeMirrorInstance.cm.state.selection.main.head, head: codeMirrorInstance.cm.state.selection.main.head }
                    });
                }
            }
        });
    }

    // Sync PM selection when it touches a CodeMirror instance
    syncProseMirrorSelection() {
        // Determine if the current ProseMirror selection extends into the CodeMirror instance

        const {from, to} = this.view.state.selection;
        const pos = this.getPos();
        const start = pos + 1; // start position of node's content
        const end = pos + this.node.nodeSize - 1; // end position of node's content

        // Check if the selection is within the CodeMirror instance
        if (from < start || to > end) return;

        // Find selection range within the CodeMirror instance
        const cmFrom = from - start;
        const cmTo = to - start;

        // Translate this position to a CodeMirror selection
        const cmSelection = {anchor: cmFrom, head: cmTo};

        // Dispatch a transaction on the CodeMirror instance to update its selection
        this.cm.dispatch({
            selection: cmSelection
        });
    }

    // Sync CM selection to ProseMirror when it hits boundaries
    syncCodeMirrorSelection(state, dispatch) {
        let {from, to} = state.selection;
        if (state.selection.empty) to = from;

        // Check if selection extends beyond the CM instance
        // (Simplified for illustration; actual implementation may require handling more edge cases)
        if (from === 0 || to === state.doc.length) {
            let pmSelection;
            if (from === 0) {
                // If at the start, move selection into PM before the CM instance
                pmSelection = Selection.near(this.view.state.doc.resolve(this.getPos()), -1);
            } else {
                // If at the end, move selection into PM after the CM instance
                pmSelection = Selection.near(this.view.state.doc.resolve(this.getPos() + this.node.nodeSize), 1);
            }

            if (dispatch) {
                dispatch(this.view.state.tr.setSelection(pmSelection).scrollIntoView());
                this.view.focus();
            }
        }
    }

    selectAll() {
        this.cm.dispatch({
          selection: { anchor: 0, head: this.cm.state.doc.length }
        });
      }

    selectAllCommand() {
        console.log("selectAllCommand");
        const { state, dispatch } = this.view;

        // If focus is within CodeMirror, extend the selection to the entire document.
        if (this.cm.hasFocus) {
            // Programmatically select all CodeMirror content.
            this.cm.dispatch({
                selection: { anchor: 0, head: this.cm.state.doc.length }
            });
            // Move focus to ProseMirror to ensure that the rest of the document is selected.
            this.view.focus();

            // Extend the selection to the entire ProseMirror document.
            dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
        } else {
            // If the selection starts from outside CodeMirror, select all text in ProseMirror.
            dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
            this.view.focus();
        }

        return true;
    }

    forwardUpdate(update) {
        if (!update || this.updating || !this.cm.hasFocus) {
            return;
        }

        let offset = this.getPos() + 1
        const {main} = update.state.selection
        let selFrom = offset + main.from, selTo = offset + main.to
        let pmSel = this.view.state.selection

        if (update.docChanged || pmSel.from != selFrom || pmSel.to != selTo) {
            let tr = this.view.state.tr
            update.changes.iterChanges((fromA, toA, fromB, toB, text) => {
                if (text.length) {
                    tr.replaceWith(offset + fromA, offset + toA,
                    this.schema.text(text.toString()))
                } else {
                    tr.delete(offset + fromA, offset + toA)
                    offset += (toB - fromB) - (toA - fromA)
                }
            })
            tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo))
            this.view.dispatch(tr)
        }
    }

    maybeEscape(unit, dir) {
        let {state} = this.cm
        let {main} = state.selection
        if (!main.empty) return false
        if (unit == "line") main = state.doc.lineAt(main.head)
        if (dir < 0 ? main.from > 0 : main.to < state.doc.length) return false
        let targetPos = this.getPos() + (dir < 0 ? 0 : this.node.nodeSize)
        let selection = Selection.near(this.view.state.doc.resolve(targetPos), dir)
        let tr = this.view.state.tr.setSelection(selection).scrollIntoView()
        this.view.dispatch(tr)
        this.view.focus()
    }

    codeMirrorKeymap() {
        let view = this.view;
        return [
            { key: "ArrowUp", run: () => this.maybeEscape("line", -1), preventDefault: true },
            { key: "ArrowLeft", run: () => this.maybeEscape("char", -1), preventDefault: true },
            { key: "ArrowDown", run: () => this.maybeEscape("line", 1), preventDefault: true },
            { key: "Shift-Enter", run: () => this.maybeEscape("line", 1), preventDefault: true },
            { key: "ArrowRight", run: () => this.maybeEscape("char", 1), preventDefault: true },
            { key: "Mod-a", run: (state, dispatch, view) => {
                this.selectAllCommand();
                return true;
            }},
            { key: "Mod-Enter", run: () => {
                if (!exitCode(view.state, view.dispatch)) return false;
                view.focus();
                return true;
            }},
            { key: "Mod-z", run: () => undo(view.state, view.dispatch), preventDefault: true },
            { key: "Mod-Shift-z", run: () => redo(view.state, view.dispatch), preventDefault: true },
            { key: "Mod-y", mac: "Mod-Shift-z", run: () => redo(view.state, view.dispatch), preventDefault: true }
        ];
    }

    update(node) {
        console.log("CodeMirror update", node)
        if (node.type != this.node.type) {
            return false
        }
        if (this.updating) {
            return true
        }
        this.node = node
        let newText = node.textContent
        let curText = this.cm.state.doc.toString()
        if (newText != curText) {
            let start = 0, curEnd = curText.length, newEnd = newText.length
            while (start < curEnd && curText.charCodeAt(start) == newText.charCodeAt(start)) {
                ++start
            }
            while (curEnd > start && newEnd > start && curText.charCodeAt(curEnd - 1) == newText.charCodeAt(newEnd - 1)) {
                curEnd--
                newEnd--
            }
            this.updating = true
            this.cm.dispatch({
                changes: {
                    from: start, to: curEnd,
                    insert: newText.slice(start, newEnd)
                }
            })
            this.updating = false
        }
        return true
    }

    // stopEvent(event) {
    //     return this.cm.dom.contains(event.target);
    // }

    stopEvent(event) {
        // On mousedown, clear selections if the event is outside the current CodeMirror instance
        if (event.type === 'mousedown' && !this.cm.dom.contains(event.target)) {
            this.clearOtherCodeMirrorSelections();
        }
        // Always return true to indicate that almost all ProseMirror events should not be handled by CodeMirror
        return true;
    }

    destroy() {
        this.cm.destroy();
        this.wrapper.remove();
    }
}

export const createCodeBlockPlugin = (schema) => {
    return new Plugin({
        key,
        props: {
            decorations(state) {
                let { doc, selection } = state;
                let decorations = [];

                // Traverse the document and create decorations for selection inside CodeMirror instances
                doc.descendants((node, pos) => {
                    if (node.type.name === "code_block") {
                        // Check if selection intersects with this CodeMirror instance
                        let from = pos + 1; // start of code block content
                        let to = from + node.content.size;

                        if (selection.from < to && selection.to > from) {
                            // Calculate intersection of selection with code block
                            let selectionFrom = Math.max(selection.from, from);
                            let selectionTo = Math.min(selection.to, to);

                            // Create decoration for visual representation of selection
                            let decoration = Decoration.inline(selectionFrom, selectionTo, { class: "selected" });
                            decorations.push(decoration);
                        }
                    }
                });

                return DecorationSet.create(doc, decorations);
            },
            nodeViews: {
                code_block(node, view, getPos) {
                    return new CodeBlockView(node, view, getPos, schema);
                }
            },
            handleKeyDown: (view, event) => {
                // console.log('handleKeyDown')
                if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
                    const codeBlockPluginState = key.getState(view.state);
                    if (codeBlockPluginState) {
                        codeBlockPluginState.selectAllCommand();
                        event.preventDefault();
                        return true;
                    }
                }
                return false;
            },
            handleDOMEvents: {
                // Further refine mousedown event to handle selection properly
                mousedown: (view, event) => {
                    clearAllCodeMirrorSelections(view);
                    return false;
                },
                keydown: (view, event) => {
                    if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
                        // Execute function to select all across CodeMirror instances and ProseMirror
                        selectAllContentIncludingCodeBlocks(view);
                        event.preventDefault();
                        return true;
                    }
                    // Continue with other handlers if available
                    return false;
                },
            },
            createSelectionBetween(view, anchor, head) {
                // Safeguard against null and non-finite coordinates
                if (anchor && isFinite(anchor.left) && isFinite(anchor.top) &&
                    head && isFinite(head.left) && isFinite(head.top)) {
                    try {
                        const anchorPos = view.posAtCoords(anchor);
                        const headPos = view.posAtCoords(head);
                        if (anchorPos && headPos) {
                            return new TextSelection(view.state.doc.resolve(anchorPos.pos), view.state.doc.resolve(headPos.pos));
                        }
                    } catch (error) {
                        console.error("Failed to create selection between points:", error);
                    }
                }
                return null;
            },
        },
        view() {
            return {
                update(view, prevState) {
                    // Add custom update logic if needed
                },
                destroy() {
                    // Cleanup when the view is destroyed
                }
            };
        },
        appendTransaction(transactions, oldState, newState) {
            let tr;
            transactions.forEach(transaction => {
                const meta = transaction.getMeta(transactionName);
                if (meta) {
                    const {type, start, end, theme} = meta;
                    const codeBlock = type.createAndFill({theme});

                    tr = newState.tr.replaceWith(start, end, codeBlock);
                    tr.scrollIntoView();
                }
            });
            return tr;
        },
    });
}

// Utility function to clear selections from all CodeMirror instances in ProseMirror
function clearAllCodeMirrorSelections(view) {
    view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') {
            const nodeDOM = view.nodeDOM(pos);
            const codeMirrorInstance = nodeDOM && nodeDOM.CodeMirrorView;
            if (codeMirrorInstance && codeMirrorInstance.cm) {
                codeMirrorInstance.cm.dispatch({
                    selection: { anchor: null, head: null }
                });
            }
        }
    });
}

function selectAllContentIncludingCodeBlocks(view) {
    // Start by selecting all text within ProseMirror
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, view.state.doc.content.size));
    view.dispatch(tr);

    // Iterate over all code_block nodes and select contents in CodeMirror instances
    tr.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') {
            const codeMirrorDom = view.nodeDOM(pos);
            const codeMirrorView = codeMirrorDom && codeMirrorDom.CodeMirrorView;

            if (codeMirrorView && typeof codeMirrorView.selectAll === 'function') {
                // Call selectAll method to select the content within CodeMirror instance
                codeMirrorView.selectAll();
            }
        }
    });

    // Focus back to ProseMirror at the end
    view.focus();
}



export const codeBlockInputRulef = (schema) => {
    return inputRules({
        rules: [
            {
                match: /^```$/,
                handler: (state, match, start, end) => {
                    const tr = state.tr;
                    tr.setMeta(transactionName, { type: schema.nodes.code_block, start, end, theme: 'gruvboxDark' });
                    return tr;
                },
            },
        ],
    });
}

export const codeBlockInputRule = (schema) => {
    return inputRules({
        rules: [
            {
                match: /^```$/,
                handler: (state, match, start, end) => {
                    const { schema } = state;
                    let tr = state.tr;

                    const $start = state.doc.resolve(start);
                    const paragraphStart = $start.before($start.depth);
                    const paragraphEnd = $start.after($start.depth);

                    const codeBlock = schema.nodes.code_block.createAndFill({ theme: 'gruvboxDark' });
                    tr.replaceWith(paragraphStart, paragraphEnd, codeBlock);

                    // Now call the refactored function with the transaction and schema
                    tr = ensureEmptyLineAfterNode(tr, 'code_block', schema);

                    // Continue the transaction chain if needed or directly dispatch the transaction
                    // For example, with editorView.dispatch(tr);
                    return tr;
                },
            },
        ],
    });
}

const ensureEmptyLineAfterNode = (tr, nodeType, schema) => {
    const { doc } = tr;
    let posToEndLineAfter;  // Position where the end line should be added

    // Find the position where the last node of the specified type ends
    doc.descendants((node, position) => {
        if (node.type.name === nodeType) {
            posToEndLineAfter = position + node.nodeSize;
        }
    });

    if (posToEndLineAfter !== undefined) {
        const nextNode = doc.nodeAt(posToEndLineAfter);

        // Check whether a new paragraph needs to be inserted
        if (!nextNode || (nextNode.type.name !== 'paragraph' || nextNode.textContent !== '')) {
            const paragraphNode = schema.nodes.paragraph.createAndFill();

            // Append the transaction with the new paragraph insertion
            tr.insert(posToEndLineAfter, paragraphNode);
        }
    }

    // The transaction is modified and returned so it can be used further
    return tr;
};

