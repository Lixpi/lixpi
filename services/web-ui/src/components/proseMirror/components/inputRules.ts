import {
    ellipsis,
    emDash,
    inputRules,
    smartQuotes,
    textblockTypeInputRule,
    wrappingInputRule,
    type InputRule,
} from 'prosemirror-inputrules'
import {
    type Node as ProseMirrorNode,
    type NodeType,
    type Schema,
} from 'prosemirror-model'
import {
    type Plugin,
} from 'prosemirror-state'

// Turns "> " at the start of a text block into a block quote.
export const blockQuoteRule = (nodeType: NodeType): InputRule => wrappingInputRule(/^\s*>\s$/, nodeType)

// Turns a number followed by a dot at the start of a text block into an ordered list.
export const orderedListRule = (nodeType: NodeType): InputRule =>
    wrappingInputRule(
        /^(\d+)\.\s$/,
        nodeType,
        match => ({ order: Number(match[1]) }),
        (match: RegExpMatchArray, node: ProseMirrorNode) => node.childCount + node.attrs.order === Number(match[1]),
    )

// Turns a dash, plus sign, or asterisk at the start of a text block into a bullet list.
export const bulletListRule = (nodeType: NodeType): InputRule => wrappingInputRule(/^\s*([-+*])\s$/, nodeType)

// Turns heading markers at the start of a text block into a matching heading level.
export const headingRule = (
    nodeType: NodeType,
    maxLevel: number,
): InputRule => textblockTypeInputRule(
    new RegExp(`^(#{1,${maxLevel}})\\s$`),
    nodeType,
    match => ({ level: match[1].length }),
)

export const buildInputRules = (schema: Schema): Plugin => {
    const rules: InputRule[] = [...smartQuotes, ellipsis, emDash]
    const blockquote = schema.nodes.blockquote
    const orderedList = schema.nodes.ordered_list
    const bulletList = schema.nodes.bullet_list
    const heading = schema.nodes.heading

    if (blockquote)
        rules.push(
            blockQuoteRule(blockquote),
        )

    if (orderedList)
        rules.push(
            orderedListRule(orderedList),
        )

    if (bulletList)
        rules.push(
            bulletListRule(bulletList),
        )

    if (heading)
        rules.push(
            headingRule(heading, 6),
        )

    return inputRules({ rules })
}
