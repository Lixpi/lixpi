import {
    describe,
    expect,
    it,
} from 'vitest'

import { convertAttachmentsForProvider } from './attachments.ts'

describe('convertAttachmentsForProvider', () => {
    it('converts image data URLs to Google SDK inlineData parts', () => {
        const content = [
            { type: 'input_text', text: 'inspect this candidate' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc123', detail: 'high' },
        ]

        const converted = convertAttachmentsForProvider(content, 'GOOGLE')

        expect(converted).toEqual([
            { text: 'inspect this candidate' },
            { inlineData: { mimeType: 'image/png', data: 'abc123' } },
        ])
    })

    it('does not leak internal character reference roles into ordinary OpenAI messages', () => {
        const converted = convertAttachmentsForProvider([{
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,source',
            detail: 'high',
            reference_role: 'original-source',
            reference_file_name: 'original-source-1',
        }], 'OPENAI')

        expect(converted).toEqual([{
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,source',
            detail: 'high',
        }])
    })
})
