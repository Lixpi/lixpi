import { Plugin, PluginKey } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import { nodeTypes } from '$src/components/proseMirror/customNodes'

const key = new PluginKey('aiUserInputPlugin')
// const transactionName = `insert:${nodeTypes.aiUserMessageNodeType}`
const transactionName = `insert:${nodeTypes.aiUserInputNodeType}`

const initPluginState = () => ({
	attrs: 'defaultAttrs',
	pendingAiChatTransaction: false,
	aiUserMessagePos: null
});

const applyPluginState = (tr, prev) => {
	const newState = tr.getMeta(key);
	return newState ? { ...prev, ...newState } : prev;
}

const handleEnterKey = (view, event) => {
	event.preventDefault()

	const { dispatch } = view
	const { from, to } = view.state.selection

	let aiUserMessagePos = null
	let aiUserInputContent = null
	let transaction = null

	view.state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.type.name === nodeTypes.aiUserInputNodeType) {
            // Check if the last three characters are backticks
            const text = node.textContent;
            if (text.slice(-3) === '```') {
                // Execute the input rule to replace the backticks with a code block
                const tr = view.state.tr.replaceWith(
                    pos + text.length - 3,
                    pos + text.length,
                    view.state.schema.nodes.code_block.createAndFill()
                );
                dispatch(tr);
            }
        }
		if (node.type.name === nodeTypes.aiUserInputNodeType && node.textContent.trim() !== '') {
			aiUserMessagePos = pos
			aiUserInputContent = node.content

			const emptyParagraph = view.state.schema.nodes.paragraph.create()
			const newNode = view.state.schema.nodes[nodeTypes.aiUserInputNodeType].create(node.attrs, emptyParagraph)

			// Replace current node with the same node but with an empty paragraph as content
			transaction = view.state.tr.replaceWith(pos, pos + node.nodeSize, newNode)
			// Set the selection to the position inside the new node
			transaction = transaction.setSelection(TextSelection.create(transaction.doc, pos + 1))
			dispatch(transaction)

			// Dispatch a transaction to insert a new aiUserMessageNode
			transaction = view.state.tr.setMeta(`insert:${nodeTypes.aiUserMessageNodeType}`, {
				pos: aiUserMessagePos,
				content: aiUserInputContent
			})
			dispatch(transaction)

			// Instead of dispatching a transaction here, we'll store some metadata in the plugin state
			transaction = view.state.tr.setMeta(key, { pendingAiChatTransaction: true, aiUserMessagePos: aiUserMessagePos + node.nodeSize })
			dispatch(transaction)
		}
	})

	return true
}

const handlePasteEvent = (view, event, slice) => {
    const { state, dispatch } = view;
    const { $from } = state.selection;
    const node = $from.node($from.depth - 1); // Get the parent node

	// console.log('handlePasteEvent', {node, event, slice})

    if (node && node.type.name === nodeTypes.aiUserInputNodeType) {
        const text = event.clipboardData.getData('text/plain');
		console.log({text})

        // Detect if the pasted content is a code block
        if (text.startsWith('```') && text.endsWith('```')) {
            // Remove the backticks and create a code block node
            const code = text.slice(3, -3);
            const codeBlock = state.schema.nodes.code_block.create({}, state.schema.text(code));

            // Insert the code block into the document
            const tr = state.tr.replaceSelectionWith(codeBlock);
            dispatch(tr);

            // Prevent the default paste behavior
            event.preventDefault();
            return true;
        }
    }

    return false;
}


function createNodeViews(nodeTypes) {
    return {
        [nodeTypes.aiUserInputNodeType](node, view, getPos, decorations) {
            // Create DOM structure for the node
            const dom = document.createElement('div');
            dom.className = 'ai-user-input-wrapper';

            const contentDOM = document.createElement('div');
            contentDOM.className = 'ai-user-input';

			const controlsRow = document.createElement('div');
            controlsRow.className = 'ai-user-input-control-buttons';


            const stopButton = document.createElement('button');
            stopButton.className = 'stop-button';
            stopButton.innerText = 'Stop';

			const regenerateButton = document.createElement('button');
            regenerateButton.className = 'regenerate-button';
            regenerateButton.innerText = 'Regenerate';

			const closeButton = document.createElement('button');
            closeButton.className = 'close-button';
            closeButton.innerText = 'Close';

			controlsRow.appendChild(stopButton);
			controlsRow.appendChild(regenerateButton);
			controlsRow.appendChild(closeButton);

            // dom.appendChild(stopButton);
			// dom.appendChild(regenerateButton);
			// dom.appendChild(closeButton);
            dom.appendChild(contentDOM);
			dom.appendChild(controlsRow);

            // Handle events for the button
            stopButton.addEventListener('click', (event) => {
                // handle button click event...
				console.log('button click event', event)
            });
			regenerateButton.addEventListener('click', (event) => {
                // handle button click event...
				console.log('button click event', event)
            });

            return {
                dom,
                contentDOM,
                update(node) {
                    // Handle node updates...
                },
                destroy() {
                    // Handle node destruction...
                },
            };
        },
    }
}


export const createAiUserInputPlugin = (callback) => {
	const state = {
		init: initPluginState,
		apply: (tr, prev) => applyPluginState(tr, prev)
	}

	const appendTransaction = (transactions, oldState, newState) => {
		let tr = null;

		const transaction = transactions.find(tr => tr.getMeta(transactionName));
		if (transaction) {
			const attrs = transaction.getMeta(transactionName);
			const nodeType = newState.schema.nodes[nodeTypes.aiUserInputNodeType];
			const paragraph = newState.schema.nodes.paragraph.create();

			const taskNode = nodeType.create(attrs, paragraph);
			const { $from, $to } = newState.selection;

			tr = newState.tr.replaceWith($from.pos, $to.pos, taskNode);

			const pos = $from.pos + 1;
			const selection = TextSelection.create(tr.doc, pos);
			tr = tr.setSelection(selection);

			// Insert a new paragraph after the taskNode, if the next node does not exist or is a paragraph
			const newNodePos = pos + taskNode.nodeSize;
			const nextNode = tr.doc.nodeAt(newNodePos);
			if (!nextNode || nextNode.type.name === 'paragraph') {
				const newParagraph = newState.schema.nodes.paragraph.create();
				tr = tr.insert(newNodePos, newParagraph);
			}
		}

		const pendingAiChatTransaction = newState.aiUserInputPlugin$?.pendingAiChatTransaction;
		if (pendingAiChatTransaction) {
			const pos = newState.aiUserInputPlugin$.aiUserMessagePos
			tr = newState.tr.setMeta('use:aiChat', { pos });
			tr = tr.setMeta(key, { pendingAiChatTransaction: false });
		}

		if (tr) {
			return tr;
		}
	}

	return new Plugin({
		key,
		state,
		props: {
			nodeViews: createNodeViews(nodeTypes),
			handleDOMEvents: {
				keydown: (view, event) => {
					const { state } = view
					const { from, to } = state.selection

					if (event.key === 'Enter' && !event.shiftKey) {
						state.doc.nodesBetween(from, to, (node, pos) => {
							if (node.type.name === nodeTypes.aiUserInputNodeType) {
								return handleEnterKey(view, event)
							}
						})
					}
					return false
				},
			},
			handlePaste: handlePasteEvent,
		},
		appendTransaction
	})
}
