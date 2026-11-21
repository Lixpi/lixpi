// Sizes for the parameter controls in the inspector: a toggle half as tall as
// a canvas control, and the row counts of the theme editor's text areas.

export const parameterTextRows = {
    theme: 12,
    array: 3,
}

export const parameterToggleGeometry = (controlHeight: number) => {
    const height = controlHeight * 0.5
    const width = height * 1.8

    return {
        control: {
            x: 1,
            y: 2,
            width,
            height,
        },
        host: {
            width: width + 2,
            height: height + 4,
        },
    }
}
