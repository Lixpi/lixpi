import { lixpiLightTheme } from '@lixpi/themes'

export type VideoControlsSettings = {
    height: number
    layout: {
        padding: number
        gap: number
        buttonSize: number
        iconSize: number
        barRadius: number
        buttonRadius: number
        railHeight: number
        scrubberHandleRadius: number
        volumeHandleRadius: number
        backgroundHighlightInset: number
        timeWidth: number
        speedSliderWidth: number
        compactSpeedSliderWidth: number
        speedSliderMinWidth: number
        speedValueWidth: number
        speedValueSliderGap: number
        volumeSliderWidth: number
        volumeSliderMinWidth: number
        minSeekWidth: number
        speedScaleTickHeight: number
    }
    typography: {
        timeFontSize: number
        timeFontWeight: number
    }
    speed: {
        minRate: number
        maxRate: number
        pointerStep: number
        keyboardStep: number
        displayPrecision: number
        defaultRate: number
        guideRate: number
        guideRates: number[]
    }
    responsive: {
        speedSliderMinResponsiveWidth: number
        speedSliderFullResponsiveWidth: number
        volumeSliderMinResponsiveWidth: number
        volumeSliderFullResponsiveWidth: number
    }
    styles: {
        hostBorderRadius: string
        hostDropShadow: string
        hostBackdropFilter: string
        hostReducedTransparencyBackground: string
        background: string
        backgroundStroke: string
        backgroundStrokeWidth: number
        glassHighlight: string
        glassHighlightStrokeWidth: number
        buttonHover: string
        icon: string
        iconMuted: string
        text: string
        textSubtle: string
        rail: string
        buffered: string
        progress: string
        speedScaleTick: string
        speedScaleTickWidth: number
        liquidGlassFilter: {
            displacementScale: number
            baseFrequency: string
            numOctaves: number
            seed: number
        }
    }
}

export const createDefaultVideoControlsSettings = (): VideoControlsSettings => {
    const appearance = structuredClone({
        styles: lixpiLightTheme.components.videoControls.styles,
        typography: lixpiLightTheme.components.videoControls.typography,
    })

    return {
        height: 40,
        layout: {
            padding: 9,
            gap: 6,
            buttonSize: 30,
            iconSize: 18,
            barRadius: 99,
            buttonRadius: 99,
            railHeight: 5,
            scrubberHandleRadius: 5.5,
            volumeHandleRadius: 4,
            backgroundHighlightInset: 1,
            timeWidth: 48,
            speedSliderWidth: 96,
            compactSpeedSliderWidth: 78,
            speedSliderMinWidth: 64,
            speedValueWidth: 34,
            speedValueSliderGap: 7,
            volumeSliderWidth: 62,
            volumeSliderMinWidth: 28,
            minSeekWidth: 36,
            speedScaleTickHeight: 10,
        },
        typography: appearance.typography,
        speed: {
            minRate: 0.5,
            maxRate: 2,
            pointerStep: 0.01,
            keyboardStep: 0.05,
            displayPrecision: 2,
            defaultRate: 1,
            guideRate: 1,
            guideRates: [0.75, 1, 1.5],
        },
        responsive: {
            speedSliderMinResponsiveWidth: 430,
            speedSliderFullResponsiveWidth: 520,
            volumeSliderMinResponsiveWidth: 330,
            volumeSliderFullResponsiveWidth: 520,
        },
        styles: appearance.styles,
    }
}
