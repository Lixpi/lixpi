import {
    codeBlockNodeSpec,
    codeBlockNodeType,
    customNodeSpecs,
    taskRowNodeSpec,
    taskRowNodeType,
} from '@lixpi/prosemirror'

export const nodeTypes = {
    taskRowNodeType,
    codeBlockNodeType
}

export const nodeViews = {

}

// Exporting all nodes. ORDER MATTERS!
export default customNodeSpecs
