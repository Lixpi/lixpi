import {
    describe,
    expect,
    it,
} from 'vitest'
import { containsCanvasMediaUrl } from './canvas-media-source.ts'

describe('canvas media sources', () => {
    const url = 'https://media.example/clip.mp4'
    it('recognizes a link the user typed or attached to text', () => {
        expect(containsCanvasMediaUrl({
            type: 'text',
            text: `Import ${url}.`,
        }, url)).toBe(true)
        expect(containsCanvasMediaUrl({
            type: 'paragraph',
            content: [{
                type: 'text',
                text: 'clip',
                marks: [{
                    type: 'link',
                    attrs: { href: url },
                }],
            }],
        }, url)).toBe(true)
    })

    it('rejects a different URL sharing a prefix with a user link', () => void expect(containsCanvasMediaUrl({
        type: 'text',
        text: `${url  }?private=1`,
    }, url)).toBe(false))
})
