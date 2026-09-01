import 'd3-transition'

import {
    select,
    type Selection,
} from 'd3-selection'

import { html } from '../dom/index.ts'
import { appendSvgPathIcon } from './svgIconPaths.ts'
import {
    easeHover,
    type EasingFunction,
} from '../animation/index.ts'

// Shared machinery for icons that are assembled from several independent SVG
// pieces and animated between named states in code (rather than by swapping one
// static markup blob for another). A concrete icon only declares its geometry:
// which pieces exist, where each piece sits in every state, and how it travels.

export type AnimatedIconPose = {
    // Offsets are expressed in viewBox units, relative to the piece's authored position.
    x?: number
    y?: number
    rotate?: number
    scale?: number
    opacity?: number
}

export type AnimatedIconShape =
    // Composes caller-provided SVG markup, normalised into a
    // `size` box centred on `cx` / `cy` so icons stay visually consistent.
    | { kind: 'icon'; markup: string; size: number; cx?: number; cy?: number; fill?: string }
    | { kind: 'path'; d: string; fill?: string }
    | { kind: 'circle'; cx: number; cy: number; r: number; fill?: string }

export type AnimatedIconMotion = {
    durationMs?: number
    delayMs?: number
    easing?: EasingFunction
    // Multiplier applied to `scale` at the midpoint of the travel, letting two
    // pieces cross over each other without visually colliding.
    midScale?: number
    // Opacity multiplier at the midpoint of the travel.
    midOpacity?: number
}

export type AnimatedIconPart<State extends string> = {
    id: string
    shape: AnimatedIconShape
    className?: string
    // Point the piece rotates and scales around, in viewBox units.
    origin?: { x: number; y: number }
    poses: Record<State, AnimatedIconPose>
    motion?: AnimatedIconMotion
}

export type AnimatedIconSpec<State extends string> = {
    name: string
    viewBox: string
    parts: AnimatedIconPart<State>[]
    motion?: AnimatedIconMotion
}

export type AnimatedSvgIconConfig<State extends string> = {
    state: State
    className?: string
    motion?: AnimatedIconMotion
}

export type AnimatedSvgIconInstance<State extends string> = {
    readonly element: HTMLElement
    getState: () => State
    setState: (state: State, options?: { animate?: boolean }) => void
    destroy: () => void
}

type PartRuntime<State extends string> = {
    part: AnimatedIconPart<State>
    group: Selection<SVGGElement, unknown, null, undefined>
    pose: Required<AnimatedIconPose>
}

type ResolvedMotion = Required<AnimatedIconMotion>

const DEFAULT_MOTION: ResolvedMotion = {
    durationMs: 420,
    delayMs: 0,
    easing: easeHover,
    midScale: 1,
    midOpacity: 1,
}

const IDENTITY_POSE: Required<AnimatedIconPose> = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }

function resolvePose(pose: AnimatedIconPose | undefined): Required<AnimatedIconPose> {
    return { ...IDENTITY_POSE, ...pose }
}

function mixNumbers(from: number, to: number, t: number): number {
    return from + (to - from) * t
}

// Bell curve peaking at the midpoint of the travel — drives the `midScale` /
// `midOpacity` swell without needing keyframes.
function midpointWeight(t: number): number {
    return Math.sin(Math.PI * Math.min(Math.max(t, 0), 1))
}

export class AnimatedSvgIcon<State extends string> implements AnimatedSvgIconInstance<State> {
    readonly element: HTMLElement

    private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>
    private readonly parts: PartRuntime<State>[] = []
    private readonly transitionNamespace: string
    private currentState: State
    private destroyed = false

    constructor(
        private readonly spec: AnimatedIconSpec<State>,
        private readonly config: AnimatedSvgIconConfig<State>,
    ) {
        this.currentState = config.state
        this.transitionNamespace = `animated-svg-icon-${spec.name}`
        this.element = html`
            <span
                className=${`animated-svg-icon animated-svg-icon-${spec.name}${config.className ? ` ${config.className}` : ''}`}
                aria-hidden="true"
            ></span>
        ` as HTMLSpanElement
        this.svg = select<HTMLElement, unknown>(this.element)
            .append<SVGSVGElement>('svg')
            .attr('class', 'animated-svg-icon-svg')
            .attr('viewBox', spec.viewBox)
            .attr('focusable', 'false')

        for (const part of spec.parts) {
            const group = this.svg.append<SVGGElement>('g')
                .attr('class', `animated-svg-icon-part${part.className ? ` ${part.className}` : ''}`)
                .attr('data-icon-part', part.id)
            this.renderShape(group, part.shape)

            const runtime: PartRuntime<State> = {
                part,
                group,
                pose: resolvePose(part.poses[this.currentState]),
            }
            this.parts.push(runtime)
            this.applyPose(runtime, runtime.pose)
        }
    }

    getState(): State {
        return this.currentState
    }

    setState(state: State, options: { animate?: boolean } = {}): void {
        if (this.destroyed) return
        // Animated icons are state feedback, not decoration, and nothing else in
        // the app suppresses motion per OS preference — an OS-level
        // reduced-motion gate here made this one icon snap while every
        // neighbouring animation kept playing.
        const animate = options.animate ?? true
        // A matching animated call is a no-op so mid-flight travel survives the
        // host re-syncing state during rebuilds. A matching non-animated call
        // still falls through: it force-reapplies the pose table, so a fresh
        // paint resynchronises the DOM instead of trusting whatever attributes
        // the element currently carries.
        if (state === this.currentState && animate) return
        this.currentState = state

        for (const runtime of this.parts) {
            const targetPose = resolvePose(runtime.part.poses[state])
            runtime.group.interrupt(this.transitionNamespace)

            if (!animate) {
                runtime.pose = targetPose
                this.applyPose(runtime, targetPose)
                continue
            }

            const startPose = runtime.pose
            const motion = this.resolveMotion(runtime.part)
            runtime.group
                .transition(this.transitionNamespace)
                .duration(motion.durationMs)
                .delay(motion.delayMs)
                .ease(motion.easing)
                .tween(`${this.transitionNamespace}-pose`, () => (t: number) => {
                    const swell = midpointWeight(t)
                    const pose: Required<AnimatedIconPose> = {
                        x: mixNumbers(startPose.x, targetPose.x, t),
                        y: mixNumbers(startPose.y, targetPose.y, t),
                        rotate: mixNumbers(startPose.rotate, targetPose.rotate, t),
                        scale: mixNumbers(startPose.scale, targetPose.scale, t)
                            * mixNumbers(1, motion.midScale, swell),
                        opacity: mixNumbers(startPose.opacity, targetPose.opacity, t)
                            * mixNumbers(1, motion.midOpacity, swell),
                    }
                    runtime.pose = pose
                    this.applyPose(runtime, pose)
                })
                .on('end interrupt', () => {
                    if (this.currentState !== state) return
                    runtime.pose = targetPose
                    this.applyPose(runtime, targetPose)
                })
        }
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        for (const runtime of this.parts) runtime.group.interrupt(this.transitionNamespace)
        this.element.remove()
    }

    private resolveMotion(part: AnimatedIconPart<State>): ResolvedMotion {
        // Motion cascades: framework default → icon spec → instance config → part.
        return [this.spec.motion, this.config.motion, part.motion].reduce<ResolvedMotion>(
            (resolved, motion) => {
                if (!motion) return resolved
                const defined = Object.fromEntries(
                    Object.entries(motion).filter(([, value]) => value !== undefined),
                )
                return { ...resolved, ...defined }
            },
            DEFAULT_MOTION,
        )
    }

    private applyPose(runtime: PartRuntime<State>, pose: Required<AnimatedIconPose>): void {
        const origin = runtime.part.origin ?? { x: 0, y: 0 }
        const transform = [
            `translate(${pose.x} ${pose.y})`,
            `translate(${origin.x} ${origin.y})`,
            `rotate(${pose.rotate})`,
            `scale(${pose.scale})`,
            `translate(${-origin.x} ${-origin.y})`,
        ].join(' ')
        runtime.group
            .attr('transform', transform)
            .attr('opacity', pose.opacity)
    }

    private renderShape(
        group: Selection<SVGGElement, unknown, null, undefined>,
        shape: AnimatedIconShape,
    ): void {
        switch (shape.kind) {
            case 'icon':
                appendSvgPathIcon(group, shape.markup, {
                    x: (shape.cx ?? 0) - shape.size / 2,
                    y: (shape.cy ?? 0) - shape.size / 2,
                    size: shape.size,
                    fill: shape.fill ?? 'currentColor',
                })
                break
            case 'path':
                group.append('path')
                    .attr('d', shape.d)
                    .attr('fill', shape.fill ?? 'currentColor')
                break
            case 'circle':
                group.append('circle')
                    .attr('cx', shape.cx)
                    .attr('cy', shape.cy)
                    .attr('r', shape.r)
                    .attr('fill', shape.fill ?? 'currentColor')
                break
        }
    }
}

export function createAnimatedSvgIcon<State extends string>(
    spec: AnimatedIconSpec<State>,
    config: AnimatedSvgIconConfig<State>,
): AnimatedSvgIconInstance<State> {
    return new AnimatedSvgIcon(spec, config)
}
