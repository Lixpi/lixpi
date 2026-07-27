'use strict'

import htm from 'htm/mini'

type TemplateProperties = Record<string, unknown> & {
    class?: string
    className?: string
    data?: Record<string, string | number>
    style?: Partial<CSSStyleDeclaration>
}

export function createCapabilityHtml(document: Document) {
    const buildElement = (tagName: string, properties?: TemplateProperties, ...children: unknown[]): HTMLElement => {
        const element = document.createElement(tagName)
        for (const [key, value] of Object.entries(properties ?? {})) {
            if (value === undefined || value === null || value === false) continue
            if (key === 'class' || key === 'className') {
                element.className = String(value)
                continue
            }
            if (key === 'data' && typeof value === 'object') {
                for (const [dataKey, dataValue] of Object.entries(value as Record<string, string | number>)) {
                    element.dataset[dataKey] = String(dataValue)
                }
                continue
            }
            if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value)
                continue
            }
            if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.slice(2).toLocaleLowerCase('en-US'), value as EventListener)
                continue
            }
            if (key === 'textContent') {
                element.textContent = String(value)
                continue
            }
            element.setAttribute(key, value === true ? '' : String(value))
        }
        for (const child of children.flat(Infinity)) {
            if (child instanceof document.defaultView!.Node || typeof child === 'string') element.append(child)
            else if (typeof child === 'number') element.append(String(child))
        }
        return element
    }
    return htm.bind(buildElement)
}
