import {
    describe,
    expect,
    it,
} from 'vitest'
import { type WebGPURenderer } from 'pixi.js'
import { keepMsaaStored } from './pixi-stored-msaa.ts'

type ContextChangeListener = { contextChange: () => void }

const tileBasedRenderer = () => {
    const listeners: ContextChangeListener[] = []
    const device = {
        extensions: {
            tileBased: true,
            transientAttachment: true,
        },
    }
    const renderer = {
        device,
        runners: {
            contextChange: {
                add: (listener: ContextChangeListener) => void listeners.push(listener),
            },
        },
    } as unknown as WebGPURenderer

    // Mirrors Pixi restoring a lost device: it probes the extensions again,
    // then tells every listener about the new context.
    const restoreDevice = (): void => {
        device.extensions = {
            tileBased: true,
            transientAttachment: true,
        }
        listeners.forEach(listener => listener.contextChange())
    }

    return {
        device,
        renderer,
        restoreDevice,
    }
}

describe('keepMsaaStored', () => {
    it('stores multisampled buffers instead of keeping them in tile memory', () => {
        const {
            device,
            renderer,
        } = tileBasedRenderer()

        keepMsaaStored(renderer)

        expect(device.extensions).toEqual({
            tileBased: false,
            transientAttachment: false,
        })
    })

    it('stores them again after Pixi restores a lost device', () => {
        const {
            device,
            renderer,
            restoreDevice,
        } = tileBasedRenderer()
        keepMsaaStored(renderer)

        restoreDevice()

        expect(device.extensions).toEqual({
            tileBased: false,
            transientAttachment: false,
        })
    })
})
