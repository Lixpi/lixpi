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

export function createDefaultVideoControlsSettings(): VideoControlsSettings {
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
        typography: {
            timeFontSize: 13,
            timeFontWeight: 600,
        },
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
        styles: {
            hostBorderRadius: '99px',
            hostDropShadow: 'drop-shadow(0 12px 30px rgb(0 0 0 / 30%))',
            hostBackdropFilter: 'blur(22px) saturate(155%) contrast(108%)',
            hostReducedTransparencyBackground: 'rgb(24 28 34 / 70%)',
            background: 'rgb(24 28 34 / 24%)',
            backgroundStroke: 'rgb(255 255 255 / 22%)',
            backgroundStrokeWidth: 1,
            glassHighlight: 'rgb(255 255 255 / 10%)',
            glassHighlightStrokeWidth: 1,
            buttonHover: 'rgb(255 255 255 / 14%)',
            icon: 'rgb(255 255 255 / 95%)',
            iconMuted: 'rgb(255 255 255 / 58%)',
            text: 'rgb(255 255 255 / 92%)',
            textSubtle: 'rgb(255 255 255 / 76%)',
            rail: 'rgb(255 255 255 / 24%)',
            buffered: 'rgb(255 255 255 / 34%)',
            progress: '#ffffff',
            speedScaleTick: 'rgb(255 255 255 / 42%)',
            speedScaleTickWidth: 1,
            liquidGlassFilter: {
                displacementScale: 2.4,
                baseFrequency: '0.012 0.08',
                numOctaves: 2,
                seed: 7,
            },
        },
    }
}
