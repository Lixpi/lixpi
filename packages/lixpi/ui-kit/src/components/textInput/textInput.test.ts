// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createTextArea,
    createTextInput,
} from './textInput.ts'

describe('TextInput', () => {
    it('renders a shared text field with its value and placeholder', () => {
        const input = createTextInput({
            value: 'Lixpi',
            placeholder: 'Name',
            ariaLabel: 'Name',
            className: 'profile-name',
        })

        expect(input.element.className).toBe('text-input profile-name')
        expect(input.element.type).toBe('text')
        expect(input.element.value).toBe('Lixpi')
        expect(input.element.placeholder).toBe('Name')
        expect(input.element.getAttribute('aria-label')).toBe('Name')
    })

    it('reports typing and committed changes, but not programmatic values', () => {
        const onInput = vi.fn()
        const onChange = vi.fn()
        const input = createTextInput({
            onInput,
            onChange,
        })

        input.element.value = 'typed'
        input.element.dispatchEvent(new Event('input'))
        input.element.dispatchEvent(new Event('change'))
        input.setValue('set by host')
        expect(onInput).toHaveBeenCalledOnce()
        expect(onInput.mock.calls[0]![0]).toBe('typed')
        expect(onChange).toHaveBeenCalledOnce()
        expect(input.getValue()).toBe('set by host')
    })

    it('marks invalid and disabled states', () => {
        const input = createTextInput({
            type: 'number',
            step: 'any',
        })

        input.setInvalid(true)
        expect(input.element.getAttribute('aria-invalid')).toBe('true')
        input.setInvalid(false)
        expect(input.element.hasAttribute('aria-invalid')).toBe(false)
        input.setDisabled(true)
        expect(input.element.disabled).toBe(true)
        expect(input.element.type).toBe('number')
        expect(input.element.step).toBe('any')
    })

    it('stops reporting after it is destroyed', () => {
        const onInput = vi.fn()
        const input = createTextInput({ onInput })
        document.body.append(input.element)

        input.destroy()
        input.element.dispatchEvent(new Event('input'))
        expect(onInput).not.toHaveBeenCalled()
        expect(input.element.isConnected).toBe(false)
    })
})

describe('TextArea', () => {
    it('renders a multiline shared field with rows and spellcheck', () => {
        const onInput = vi.fn()
        const area = createTextArea({
            value: '{}',
            rows: 6,
            spellcheck: false,
            onInput,
        })

        expect(area.element.tagName).toBe('TEXTAREA')
        expect(area.element.className).toBe('text-input text-area')
        expect(Number(area.element.rows)).toBe(6)
        expect(area.element.spellcheck).toBe(false)
        area.element.value = '{"a":1}'
        area.element.dispatchEvent(new Event('input'))
        expect(onInput.mock.calls[0]![0]).toBe('{"a":1}')
    })
})
