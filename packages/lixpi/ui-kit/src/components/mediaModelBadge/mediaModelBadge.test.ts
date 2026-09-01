import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest'

import {
    applyMediaModelBadgeStyleProperties,
    createMediaModelBadge,
    renderMediaModelBadge,
} from './mediaModelBadge.ts'

afterEach(() => {
    document.body.innerHTML = ''
})

describe('createMediaModelBadge', () => {
    it('renders the provider icon, provider name, separator, and model name as one badge', () => {
        const badge = createMediaModelBadge({
            providerTitle: 'Google',
            modelTitle: 'Nano Banana Pro',
            icon: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg>',
            separator: ' : ',
        })

        expect(badge?.className).toBe('media-model-badge')
        expect(badge?.getAttribute('role')).toBe('img')
        expect(badge?.getAttribute('aria-label')).toBe('Google : Nano Banana Pro')
        expect(badge?.getAttribute('data-help-tooltip')).toBe('aria-label')
        expect(badge?.getAttribute('title')).toBeNull()
        expect(badge?.querySelector('.media-model-badge-icon svg')).not.toBeNull()
        expect(badge?.querySelector('.media-model-badge-provider')?.textContent).toBe('Google')
        expect(badge?.querySelector('.media-model-badge-model')?.textContent).toBe('Nano Banana Pro')
        expect(badge?.querySelector('.media-model-badge-name')?.textContent).toBe('Google : Nano Banana Pro')
    })

    it('returns null without an icon or visible label', () => {
        expect(createMediaModelBadge({})).toBeNull()
    })

    it('keeps the accessible label when configured as icon-only', () => {
        const badge = createMediaModelBadge({
            providerTitle: 'Anthropic',
            icon: '<svg></svg>',
            iconOnly: true,
        })

        expect(badge?.classList.contains('media-model-badge-icon-only')).toBe(true)
        expect(badge?.getAttribute('aria-label')).toBe('Anthropic')
        expect(badge?.getAttribute('data-help-tooltip')).toBe('aria-label')
        expect(badge?.querySelector('.media-model-badge-name')).toBeNull()
    })
})

describe('renderMediaModelBadge', () => {
    it('replaces existing host content and controls the empty state', () => {
        const host = document.createElement('div')
        host.appendChild(document.createElement('span'))

        renderMediaModelBadge(host, { providerTitle: 'OpenAI', modelTitle: 'GPT Image 2' })
        expect(host.hidden).toBe(false)
        expect(host.querySelector('.media-model-badge-name')?.textContent).toBe('OpenAI : GPT Image 2')

        renderMediaModelBadge(host, {})
        expect(host.hidden).toBe(true)
        expect(host.childElementCount).toBe(0)
    })
})

describe('applyMediaModelBadgeStyleProperties', () => {
    it('applies the shared badge custom properties to its host', () => {
        const host = document.createElement('div')

        applyMediaModelBadgeStyleProperties(host, {
            iconSize: '24px',
            topGap: '6px',
            iconGap: '3px',
            providerColor: '#66717c',
            modelColor: '#151a1f',
            nameFontSize: '14px',
            nameFontWeight: '400',
            nameLineHeight: '1.5',
        })

        expect(host.style.getPropertyValue('--canvas-node-footer-icon-size')).toBe('24px')
        expect(host.style.getPropertyValue('--workspace-media-model-badge-provider-color')).toBe('#66717c')
        expect(host.style.getPropertyValue('--workspace-media-model-badge-name-font-size')).toBe('14px')
    })
})
