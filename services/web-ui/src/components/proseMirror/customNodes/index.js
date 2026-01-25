import { taskRowNodeType, taskRowNodeSpec } from '$src/components/proseMirror/customNodes/taskRowNode.js'
import { documentTitleNodeType, documentTitleNodeSpec } from '$src/components/proseMirror/customNodes/documentTitleNode.js'
import { codeBlockNodeType, codeBlockNodeSpec } from '$src/components/proseMirror/customNodes/codeBlockNode.js'

export const nodeTypes = {
    documentTitleNodeType,
    taskRowNodeType,
    codeBlockNodeType
}

export const nodeViews = {

}

// Exporting all nodes. ORDER MATTERS!
export default {
    [nodeTypes.documentTitleNodeType]: documentTitleNodeSpec,
    [nodeTypes.taskRowNodeType]: taskRowNodeSpec,
    [nodeTypes.codeBlockNodeType]: codeBlockNodeSpec
}
