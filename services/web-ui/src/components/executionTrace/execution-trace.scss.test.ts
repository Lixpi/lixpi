import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

function extractFlatRule(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)
    if (start === -1 || end === -1) throw new Error(`Missing flat SCSS rule: ${selector}`)
    return source.slice(start, end)
}

function expectRuleToContain(rule: string, snippet: string, label: string): void {
    expect(rule.includes(snippet), `${label} should contain:\n${snippet}`).toBe(true)
}

function expectRuleNotToContain(rule: string, snippet: string, label: string): void {
    expect(rule.includes(snippet), `${label} should not contain:\n${snippet}`).toBe(false)
}

describe('execution-trace.scss', () => {
    const scss = readFileSync(resolve(import.meta.dirname, 'execution-trace.scss'), 'utf-8')

    it('keeps model calls as compact indented typography without cards', () => {
        const call = extractFlatRule(scss, '.execution-trace-model-call')
        const header = extractFlatRule(scss, '.execution-trace-model-call-header')
        const role = extractFlatRule(scss, '.execution-trace-model-call-role')
        const modelBadge = extractFlatRule(scss, '.execution-trace-model-call-header .media-model-badge')

        expectRuleToContain(call, 'padding: 2px 0 2px 11px;', 'model call')
        expectRuleToContain(call, 'border-left: 1px solid', 'model call')
        expectRuleToContain(call, 'background: transparent;', 'model call')
        expectRuleNotToContain(call, 'border-radius: 8px;', 'model call')
        expectRuleToContain(header, 'display: flex;', 'model call header')
        expectRuleToContain(header, 'overflow: hidden;', 'model call header')
        expectRuleToContain(role, 'font-size: 0.78em;', 'model call role')
        expectRuleNotToContain(role, 'border:', 'model call role')
        expectRuleToContain(modelBadge, 'flex: 1 1 auto;', 'shared model badge')
    })

    it('renders parameters and results as compact bullet lists instead of table-like columns', () => {
        const list = extractFlatRule(scss, '.execution-trace-value-list')
        const item = extractFlatRule(scss, '.execution-trace-value-item')
        const marker = extractFlatRule(scss, '.execution-trace-value-item::before')

        expectRuleToContain(list, 'display: flex;', 'value list')
        expectRuleToContain(list, 'flex-direction: column;', 'value list')
        expectRuleToContain(list, 'gap: 2px;', 'value list')
        expectRuleToContain(list, 'list-style: none;', 'value list')
        expectRuleToContain(item, 'flex-wrap: wrap;', 'value item')
        expectRuleToContain(item, 'padding: 0 0 0 9px;', 'value item')
        expectRuleNotToContain(item, 'grid-template-columns:', 'value item')
        expectRuleToContain(marker, 'border-radius: 50%;', 'value marker')
        expect(scss).toContain('.execution-trace .execution-trace-value-list')
    })

    it('uses equal typography for labels and scalar values and isolates pill rows', () => {
        const label = extractFlatRule(scss, '.execution-trace-value-label')
        const value = extractFlatRule(scss, '.execution-trace-value-text')
        const taggedItem = extractFlatRule(scss, '.execution-trace-value-item-tags')
        const tag = extractFlatRule(scss, '.execution-trace-value-tag')

        expectRuleToContain(label, 'font-size: 1em;', 'value label')
        expectRuleToContain(value, 'font-size: 1em;', 'scalar value')
        expectRuleToContain(label, 'font-weight: 500;', 'value label')
        expectRuleToContain(value, 'font-weight: 500;', 'scalar value')
        expectRuleToContain(taggedItem, 'grid-template-columns: minmax(0, 1fr);', 'tagged list item')
        expectRuleToContain(taggedItem, 'gap: 4px;', 'tagged list item')
        expectRuleToContain(tag, 'height: 18px;', 'tag pill host')
        expectRuleToContain(tag, 'overflow: visible;', 'tag pill host')
        expectRuleNotToContain(tag, 'max-width:', 'tag pill host')
    })

    it('flows expanded prompt text as indented typography without an internal scroll box', () => {
        const body = extractFlatRule(scss, '.execution-trace-text-body')

        expectRuleToContain(body, 'max-height: none;', 'expanded prompt')
        expectRuleToContain(body, 'overflow: visible;', 'expanded prompt')
        expectRuleToContain(body, 'border-left: 1px solid', 'expanded prompt')
        expectRuleToContain(body, 'background: transparent;', 'expanded prompt')
    })

    it('wraps long handles and values within the trace width', () => {
        const trace = extractFlatRule(scss, '.execution-trace')
        const handle = extractFlatRule(scss, '.execution-trace-handle')
        const value = extractFlatRule(scss, '.execution-trace-value-text')
        const footer = extractFlatRule(scss, '.execution-trace-model-call-footer')

        expectRuleToContain(trace, 'max-width: 100%;', 'trace')
        expectRuleToContain(trace, 'overflow-wrap: anywhere;', 'trace')
        expectRuleToContain(handle, 'flex-wrap: wrap;', 'handle')
        expectRuleToContain(value, 'overflow-wrap: anywhere;', 'trace value')
        expectRuleNotToContain(value, 'text-align: right;', 'trace value')
        expectRuleToContain(footer, 'max-width: 100%;', 'model call footer')
    })
})
