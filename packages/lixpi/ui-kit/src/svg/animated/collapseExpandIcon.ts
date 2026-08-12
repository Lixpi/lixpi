import { chevronDownIcon, chevronUpIcon } from '../svgIcons.ts'
import {
    createAnimatedSvgIcon,
    type AnimatedIconSpec,
    type AnimatedSvgIconInstance,
} from './animatedSvgIcon.ts'
import { easeClickToggleFeedback, easePupOut } from '../../animation/index.ts'

// Expand / collapse affordance for a whole disclosure region. It is assembled
// from the very same chevrons the nested sections use, so the region control
// reads as the sum of its children rather than as a separate icon family.
//
// Collapsed content exposes the expand action, so both chevrons point outwards.
// Expanded content exposes the collapse action, so both chevrons point inwards.
// The two chevrons never flip in place — they swap slots, travelling past each
// other through the centre dot, which pinches as they pass.

export type CollapseExpandIconState = 'collapsed' | 'expanded'

const VIEW_BOX_SIZE = 24
const CENTER = VIEW_BOX_SIZE / 2
// The source chevron is authored in a 24 box and covers 6.5 units of height, so
// it is scaled down here to leave clear air between the two arrows and the dot.
// 19.2/24 of the 15px host box is exactly 12px — the same on-screen size as the
// per-section `.progress-timeline-chevron` glyphs this icon sits beside.
const CHEVRON_SIZE = 19.2
// Inward-facing chevron tips crowd the dot, so those slots sit further out for
// equal breathing room; outward-facing flat backs can sit closer.
const INWARD_SLOT_OFFSET = 7.25
const OUTWARD_SLOT_OFFSET = 5.5
const DOT_RADIUS = 1.35

const collapseExpandIconSpec: AnimatedIconSpec<CollapseExpandIconState> = {
    name: 'collapse-expand',
    viewBox: `0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`,
    motion: {
        durationMs: 560,
        easing: easePupOut,
    },
    parts: [
        {
            id: 'chevron-up',
            className: 'animated-svg-icon-chevron',
            shape: { kind: 'icon', markup: chevronUpIcon, size: CHEVRON_SIZE, cx: CENTER, cy: CENTER },
            origin: { x: CENTER, y: CENTER },
            poses: {
                collapsed: { y: -OUTWARD_SLOT_OFFSET },
                expanded: { y: INWARD_SLOT_OFFSET },
            },
            // Full travel, no fade — the arrow has to be visible the whole way
            // across so the swap reads as motion rather than as a cross-fade.
            motion: { midScale: 0.92 },
        },
        {
            id: 'chevron-down',
            className: 'animated-svg-icon-chevron',
            shape: { kind: 'icon', markup: chevronDownIcon, size: CHEVRON_SIZE, cx: CENTER, cy: CENTER },
            origin: { x: CENTER, y: CENTER },
            poses: {
                collapsed: { y: OUTWARD_SLOT_OFFSET },
                expanded: { y: -INWARD_SLOT_OFFSET },
            },
            // Staggered against its twin so the two arrows are distinguishable
            // as they pass each other instead of overlapping into one glyph.
            motion: { midScale: 0.92, delayMs: 70 },
        },
        {
            id: 'dot',
            className: 'animated-svg-icon-dot',
            shape: { kind: 'circle', cx: CENTER, cy: CENTER, r: DOT_RADIUS },
            origin: { x: CENTER, y: CENTER },
            poses: {
                collapsed: {},
                expanded: {},
            },
            motion: {
                durationMs: 380,
                easing: easeClickToggleFeedback,
                midScale: 0.45,
            },
        },
    ],
}

export type CollapseExpandIconConfig = {
    state: CollapseExpandIconState
    className?: string
}

export function createCollapseExpandIcon(
    config: CollapseExpandIconConfig,
): AnimatedSvgIconInstance<CollapseExpandIconState> {
    return createAnimatedSvgIcon(collapseExpandIconSpec, config)
}
