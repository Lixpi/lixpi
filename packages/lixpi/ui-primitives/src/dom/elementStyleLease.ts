type PropertyState = {
    value: string
    priority: string
    leases: Map<symbol, string>
}

const owners = new WeakMap<HTMLElement | SVGElement, Map<string, PropertyState>>()

export class ElementStyleLease {
    private readonly id = Symbol()
    private readonly properties: string[] = []
    private destroyed = false

    constructor(
        private readonly element: HTMLElement | SVGElement,
        styles: Readonly<Record<string, string>>,
    ) {
        let properties = owners.get(element)

        if (!properties)
            owners.set(element, (properties = new Map()))

        for (const [property, value] of Object.entries(styles)) {
            let state = properties.get(property)

            if (!state) {
                state = {
                    value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property),
                    leases: new Map(),
                }
                properties.set(property, state)
            }

            state.leases.set(this.id, value)
            this.properties.push(property)
            element.style.setProperty(property, value)
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        const properties = owners.get(this.element)

        if (!properties)
            return

        for (const property of this.properties) {
            const state = properties.get(property)!
            state.leases.delete(this.id)
            const latest = Array.from(
                state.leases.values(),
            ).at(-1)

            if (latest !== undefined)
                this.element.style.setProperty(property, latest)
            else {
                if (state.value)
                    this.element.style.setProperty(
                        property,
                        state.value,
                        state.priority,
                    )
                else
                    this.element.style.removeProperty(property)

                properties.delete(property)
            }
        }

        if (!properties.size)
            owners.delete(this.element)
    }
}
