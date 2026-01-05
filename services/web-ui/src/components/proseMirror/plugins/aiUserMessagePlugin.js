import { Plugin, PluginKey } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'
import { nodeTypes, nodeViews } from '$src/components/proseMirror/customNodes'

const key = new PluginKey('aiUserMessage')
const transactionName = `insert:${nodeTypes.aiUserMessageNodeType}`

const initPluginState = () => ({ attrs: 'defaultAttrs' })

const applyPluginState = (tr, prev) => {
	const attrs = tr.getMeta(key) // This doesn't seem to do anything
	return attrs ? { attrs } : prev
}

export const createAiUserMessagePlugin = (user, callback) => {
	const state = {
		init: initPluginState,
		apply: (tr, prev) => applyPluginState(tr, prev)
	}

	const appendTransaction = (transactions, oldState, newState) => {
		const transaction = transactions.find(tr => tr.getMeta(transactionName))
		if (transaction) {
		  const attrs = transaction.getMeta(transactionName)
		  console.log({attrs})
	  
		  const nodeType = newState.schema.nodes[nodeTypes.aiUserMessageNodeType]
	  
		  // If content is present in attrs, use it as content of the node
		  const content = attrs.content ? attrs.content : newState.schema.nodes.paragraph.create()
	  
		  // Create a taskNode with the content
		  const taskNode = nodeType.create(attrs, content)
	  
		  // If pos is present in attrs, use it as the position of the node
		  const pos = attrs.pos ? attrs.pos : newState.selection.$from.pos
	  
		  let tr = newState.tr.replaceWith(pos, pos, taskNode)
		  
		  // Move the cursor to the inserted node
		//   const selectionPos = attrs.pos ? pos + 1 : newState.selection.$from.pos + 1
		//   const selection = TextSelection.create(tr.doc, selectionPos)
		//   tr = tr.setSelection(selection)
		  return tr
		}
	  }
	
	return new Plugin({
		key,
		state,
		appendTransaction,
		props: {
			nodeViews: {
				[nodeTypes.aiUserMessageNodeType]: (node, view, getPos) => nodeViews.aiUserMessageNodeView(node, view, getPos, user),
			}
		}
	})
}
