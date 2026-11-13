// Carries a host's custom properties to portaled elements without copying
// them one by one. A themed canvas defines well over a thousand properties,
// and every dropdown on it once set each of them inline on several elements.
// Here each source is read once per task, and each distinct set of values
// becomes one shared class, so a dropdown only switches a class name.

export type InheritedCustomProperties = {
    // Custom properties of the source, in computed-style order.
    properties: ReadonlyMap<string, string>
    signature: string
}

const SCOPE_CLASS_PREFIX = 'lixpi-inherited-scope-'

// Distinct property sets kept as rules; the oldest rule is dropped beyond it.
const SCOPE_RULE_LIMIT = 64

const reads = new Map<Element, InheritedCustomProperties>()
let readsScheduledForClearing = false

// Reads the source's custom properties. Dropdowns syncing in the same task,
// including animation frame callbacks of one frame, share the read.
export const readInheritedCustomProperties = (
    source: Element,
    computed: CSSStyleDeclaration,
): InheritedCustomProperties => {
    const cached = reads.get(source)

    if (cached)
        return cached

    const properties = new Map<string, string>()

    for (let index = 0; index < computed.length; index++) {
        const name = computed.item(index)

        if (name.startsWith('--'))
            properties.set(
                name,
                computed.getPropertyValue(name),
            )
    }

    const read = {
        properties,
        signature: [...properties].map(([name, value]) => `${name}:${value}`).join(';'),
    }
    reads.set(source, read)

    if (!readsScheduledForClearing) {
        readsScheduledForClearing = true
        setTimeout(() => {
            readsScheduledForClearing = false
            reads.clear()
        }, 0)
    }

    return read
}

type ScopeSheet = {
    sheet: CSSStyleSheet
    classes: Map<string, string>
    next: number
}

const sheets = new WeakMap<Document, ScopeSheet>()

const scopeSheetFor = (document: Document): ScopeSheet => {
    let scope = sheets.get(document)

    if (!scope) {
        const element = document.createElement('style')
        element.dataset.lixpiInheritedScope = ''
        document.head.append(element)
        scope = {
            sheet: element.sheet!,
            classes: new Map(),
            next: 0,
        }
        sheets.set(document, scope)
    }

    return scope
}

// Returns the class that applies `read`'s properties, creating its rule the
// first time the set appears.
export const inheritedScopeClass = (
    document: Document,
    read: InheritedCustomProperties,
): string => {
    const scope = scopeSheetFor(document)
    const existing = scope.classes.get(read.signature)

    // Moving a reused set to the end keeps the oldest one the least recent.
    if (existing) {
        scope.classes.delete(read.signature)
        scope.classes.set(read.signature, existing)

        return existing
    }

    const className = `${SCOPE_CLASS_PREFIX}${scope.next++}`
    const index = scope.sheet.insertRule(`.${className} {}`, scope.sheet.cssRules.length)
    const rule = scope.sheet.cssRules[index] as CSSStyleRule

    for (const [name, value] of read.properties)
        rule.style.setProperty(name, value)

    scope.classes.set(read.signature, className)

    if (scope.classes.size > SCOPE_RULE_LIMIT) {
        const [oldestSignature, oldestClass] = scope.classes.entries().next().value!
        scope.classes.delete(oldestSignature)
        const oldestIndex = [...scope.sheet.cssRules].findIndex(candidate => (candidate as CSSStyleRule).selectorText === `.${oldestClass}`)

        if (oldestIndex >= 0)
            scope.sheet.deleteRule(oldestIndex)
    }

    return className
}

export const isInheritedScopeClass = (className: string): boolean => className.startsWith(SCOPE_CLASS_PREFIX)
