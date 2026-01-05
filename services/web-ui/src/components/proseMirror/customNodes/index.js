import { taskRowNodeType, taskRowNodeSpec } from '$src/components/proseMirror/customNodes/taskRowNode.js'
import { aiUserMessageNodeType, aiUserMessageNodeSpec, aiUserMessageNodeView } from '$src/components/proseMirror/customNodes/aiUserMessageNode.js'
import { aiUserInputNodeType, aiUserInputNodeSpec } from '$src/components/proseMirror/customNodes/aiUserInputNode.js'
import { documentTitleNodeType, documentTitleNodeSpec } from '$src/components/proseMirror/customNodes/documentTitleNode.js'
import { codeBlockNodeType, codeBlockNodeSpec } from '$src/components/proseMirror/customNodes/codeBlockNode.js'

export const nodeTypes = {
    documentTitleNodeType,
    taskRowNodeType,
    aiUserMessageNodeType,
    aiUserInputNodeType,
    codeBlockNodeType
}

export const nodeViews = {
    aiUserMessageNodeView,
}

// Exporting all nodes. ORDER MATTERS!
export default {
    [nodeTypes.documentTitleNodeType]: documentTitleNodeSpec,
    [nodeTypes.taskRowNodeType]: taskRowNodeSpec,
    [nodeTypes.aiUserMessageNodeType]: aiUserMessageNodeSpec,
    [nodeTypes.aiUserInputNodeType]: aiUserInputNodeSpec,
    [nodeTypes.codeBlockNodeType]: codeBlockNodeSpec
}
