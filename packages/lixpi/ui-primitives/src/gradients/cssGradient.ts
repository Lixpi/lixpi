export type CssGradientStop = {
    color: string
    position?: string
}

export type CssGradientStops = readonly [CssGradientStop, CssGradientStop, ...CssGradientStop[]]

export type CssLinearGradientLayer = {
    type: 'linear'
    direction: string
    stops: CssGradientStops
}

export type CssRadialGradientLayer = {
    type: 'radial'
    shape: 'circle' | 'ellipse'
    size: string
    position: string
    stops: CssGradientStops
}

export type CssGradientLayer = CssLinearGradientLayer | CssRadialGradientLayer

// Preserve native CSS interpolation, units, custom properties, and layer order.
// Palette and layout values belong to the consuming component.
export class CssGradientRenderer {
    static render(layers: ReadonlyArray<CssGradientLayer>): string {
        return layers.map(layer => CssGradientRenderer.renderLayer(layer)).join(', ')
    }

    private static renderLayer(layer: CssGradientLayer): string {
        const stops = layer.stops.map(stop => stop.position === undefined ? stop.color : `${stop.color} ${stop.position}`)
            .join(', ')

        if (layer.type === 'linear')
            return `linear-gradient(${layer.direction}, ${stops})`

        return `radial-gradient(${layer.shape} ${layer.size} at ${layer.position}, ${stops})`
    }
}
