import {
    type WebGPURenderer,
} from 'pixi.js'

// On an Apple, Arm, Qualcomm or Imagination GPU, Pixi marks the canvas's
// multisampled color buffer as transient. It asks for TRANSIENT_ATTACHMENT
// storage, which Metal keeps only in tile memory, and discards the samples
// after every pass. When a frame needs a second pass on the canvas, Pixi copies
// the resolved image into a back texture and draws it into the fresh buffer.
// WebKit's GPU process fails that frame with a Metal invalid resource error
// and loses the device as soon as workspace images are drawn, while the same
// commands run in Chrome. A bisect that turned off one canvas feature per
// reload found antialiasing to be the only one whose removal kept the images
// on screen.
//
// This keeps antialiasing and makes the multisampled buffers ordinary stored
// textures, so a later pass in the same frame loads the samples instead of
// rebuilding them. Pixi sets these flags again when it restores a lost device,
// so they are reapplied on every context change, before any buffer exists.
export const keepMsaaStored = (renderer: WebGPURenderer): void => {
    const store = (): void => {
        renderer.device.extensions.tileBased = false
        renderer.device.extensions.transientAttachment = false
    }

    store()
    renderer.runners.contextChange.add({ contextChange: store })
}
