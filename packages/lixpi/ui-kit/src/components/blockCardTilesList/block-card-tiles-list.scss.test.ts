import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { lixpiLightTheme } from '@lixpi/themes'

describe(
    'block-card-tiles-list.scss',
    () => {
        const scss = readFileSync(
            resolve(
                import.meta.dirname,
                'block-card-tiles-list.scss',
            ),
            'utf-8',
        )
        const expectSourceContains = (snippet: string): void => {
            expect(
                scss.includes(snippet),
                `The shared block-card stylesheet should include: ${snippet}`,
            ).toBe(true)
        }

        it(
            'preserves the extracted list, marker, hover, and action geometry',
            () => {
                for (const declaration of [
                    'max-height: 236px;',
                    'min-height: 58px;',
                    'width: 7px;',
                    'height: 7px;',
                    'width: 20px;',
                    'height: 20px;',
                ])
                    expectSourceContains(declaration)
            },
        )

        it(
            'uses theme-owned title, metadata and hover appearance with the established defaults',
            () => {
                for (const role of [
                    'tile-title-base-font-size',
                    'primary-meta-base-font-size',
                    'secondary-meta-base-font-size',
                    'block-card-tile-hover-background-image',
                ])
                    expectSourceContains(`themeScope.token("components-block-cards-${role}", themePalette.$roles)`)

                const appearance = lixpiLightTheme.components.blockCards
                expect(appearance.tileTitle.base.fontSize).toBe('13px')
                expect(appearance.primaryMeta.base.fontSize).toBe('11.5px')
                expect(appearance.secondaryMeta.base.fontSize).toBe('11.5px')
                expect(appearance.blockCardTile.hover.backgroundImage).toBe('linear-gradient(135deg, #e8f2ff 0%, #eaf1ff 100%)')
            },
        )
    },
)
