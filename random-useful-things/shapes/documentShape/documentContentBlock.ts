// Document content block primitive - lines and squares representing document content

type ContentBlockConfig = {
    variant: 'top' | 'bottom'
}

// Helper to apply white stroke styling
function applyStroke(elem: any) {
    return elem
        .attr('fill', 'none')
        .attr('stroke', 'white')
        .attr('stroke-width', 15)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
}

// Draws document content blocks - both top variant (square + lines) and bottom variant (lines + squares)
export function drawDocumentContentBlock(parent: any, config: ContentBlockConfig) {
    if (config.variant === 'top') {
        // Top square
        applyStroke(parent.append('rect')
            .attr('x', 12.5).attr('y', 92)
            .attr('width', 42.5).attr('height', 42.5)
            .attr('rx', 5).attr('ry', 5))

        // Top line (row 1) - two segments with gap between 136-163
        applyStroke(parent.append('line').attr('x1', 92).attr('y1', 94.5).attr('x2', 136).attr('y2', 94.5))
        applyStroke(parent.append('line').attr('x1', 163).attr('y1', 94.5).attr('x2', 399).attr('y2', 94.5))

        // Top line dots
        ;[425, 461, 497].forEach(x => {
            applyStroke(parent.append('line').attr('x1', x).attr('y1', 94.5).attr('x2', x + 8).attr('y2', 94.5))
        })

        // Middle line (row 2) - solid, no gaps
        applyStroke(parent.append('line').attr('x1', 92.119).attr('y1', 132.018).attr('x2', 504.5).attr('y2', 132.018))
    } else {
        // Bottom line 1 (row 3) - two segments with gap at 183-210
        applyStroke(parent.append('line').attr('x1', 7.5).attr('y1', 380).attr('x2', 183).attr('y2', 380))
        applyStroke(parent.append('line').attr('x1', 210).attr('y1', 380).attr('x2', 248.502).attr('y2', 380))

        // Bottom line 2 (row 4) - two segments with gap at 54-89
        applyStroke(parent.append('line').attr('x1', 7.5).attr('y1', 417.5).attr('x2', 54).attr('y2', 417.5))
        applyStroke(parent.append('line').attr('x1', 89).attr('y1', 417.5).attr('x2', 248.502).attr('y2', 417.5))

        // Bottom three squares
        ;[286, 371, 457].forEach(x => {
            applyStroke(parent.append('rect')
                .attr('x', x).attr('y', 377.5)
                .attr('width', 42.5).attr('height', 42.5)
                .attr('rx', 5).attr('ry', 5))
        })
    }
}
