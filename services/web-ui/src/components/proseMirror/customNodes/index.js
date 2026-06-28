import {
    codeBlockNodeSpec,
    codeBlockNodeType,
    customNodeSpecs,
    documentTitleNodeSpec,
    documentTitleNodeType,
    taskRowNodeSpec,
    taskRowNodeType,
} from '@lixpi/prosemirror'

export const nodeTypes = {
    documentTitleNodeType,
    taskRowNodeType,
    codeBlockNodeType
}

export const nodeViews = {

}

// Exporting all nodes. ORDER MATTERS!
export default customNodeSpecs
