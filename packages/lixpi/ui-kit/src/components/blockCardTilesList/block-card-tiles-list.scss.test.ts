import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

describe('block-card-tiles-list.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'block-card-tiles-list.scss'), 'utf-8')

    it('preserves the extracted list, marker, title, metadata, hover, and action geometry', () => {
        expect(scss).toContain('max-height: 236px;')
        expect(scss).toContain('min-height: 58px;')
        expect(scss).toContain('width: 7px;')
        expect(scss).toContain('height: 7px;')
        expect(scss).toContain('font-size: 13px;')
        expect(scss.match(/font-size: 11\.5px;/g)?.length).toBeGreaterThanOrEqual(2)
        expect(scss).toContain('linear-gradient(135deg, #e8f2ff 0%, #eaf1ff 100%)')
        expect(scss).toContain('width: 20px;')
        expect(scss).toContain('height: 20px;')
    })
})
