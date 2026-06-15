import { describe, it, expect } from 'vitest'
import * as aiControls from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'

describe('aiControls index exports', () => {
    it('re-exports dropdown factories', () => {
        expect(typeof aiControls.createGenericAiModelDropdown).toBe('function')
        expect(typeof aiControls.createGenericSubmitButton).toBe('function')
        expect(typeof aiControls.createGenericImageSizeDropdown).toBe('function')
        expect(typeof aiControls.createGenericImageModelDropdown).toBe('function')
        expect(typeof aiControls.createGenericVideoModelDropdown).toBe('function')
        expect(typeof aiControls.createGenericVideoAspectDropdown).toBe('function')
        expect(typeof aiControls.createGenericVideoResolutionDropdown).toBe('function')
        expect(typeof aiControls.createGenericVideoDurationDropdown).toBe('function')
    })

    it('re-exports multi-select factories', () => {
        expect(typeof aiControls.createGenericAiModelMultiSelect).toBe('function')
        expect(typeof aiControls.createGenericImageModelMultiSelect).toBe('function')
        expect(typeof aiControls.createGenericVideoModelMultiSelect).toBe('function')
    })
})
