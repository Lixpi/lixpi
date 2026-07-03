'use strict'

export type CanvasEnginePoint = {
    x: number
    y: number
}

export type CanvasEngineRect = CanvasEnginePoint & {
    width: number
    height: number
}
