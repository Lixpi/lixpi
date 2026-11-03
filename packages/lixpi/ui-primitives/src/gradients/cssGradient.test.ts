import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    CssGradientRenderer,
    type CssGradientLayer,
} from './cssGradient.ts'

describe(
    'CssGradientRenderer',
    () => {
        it(
            'preserves native layer order, CSS values, units, and explicit stop positions',
            () => {
                const layers: CssGradientLayer[] = [
                    {
                        type: 'linear',
                        direction: '180deg',
                        stops: [
                            {
                                color: 'rgba(var(--peach-rgb), 0.18)',
                                position: '0%',
                            },
                            {
                                color: 'transparent',
                                position: '100%',
                            },
                        ],
                    },
                    {
                        type: 'radial',
                        shape: 'ellipse',
                        size: '54rem 38%',
                        position: '8% 48%',
                        stops: [
                            {
                                color: 'var(--sage)',
                                position: '2rem',
                            },
                            {
                                color: 'transparent',
                                position: '82%',
                            },
                        ],
                    },
                ]

                expect(CssGradientRenderer.render(layers)).toBe([
                    'linear-gradient(180deg, rgba(var(--peach-rgb), 0.18) 0%, transparent 100%)',
                    'radial-gradient(ellipse 54rem 38% at 8% 48%, var(--sage) 2rem, transparent 82%)',
                ].join(', '))
            },
        )

        it(
            'omits positions when a stop leaves them unspecified',
            () => {
                const layers: CssGradientLayer[] = [
                    {
                        type: 'linear',
                        direction: 'to right',
                        stops: [
                            { color: 'var(--start)' },
                            { color: 'transparent' },
                        ],
                    },
                ]

                expect(CssGradientRenderer.render(layers)).toBe('linear-gradient(to right, var(--start), transparent)')
            },
        )
    },
)
