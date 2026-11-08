import {
    PlaybackChrome,
    type PlaybackChromeOptions,
} from '@lixpi/canvas-components/media'
import {
    type VideoCanvasNode,
    type AudioCanvasNode,
} from '@lixpi/constants'

export type { PlaybackControlsSettings as WorkspaceVideoControlsSettings } from '@lixpi/canvas-components/media'
export type WorkspaceVideoChromeOptions = PlaybackChromeOptions<VideoCanvasNode | AudioCanvasNode>

// Workspace nodes provide Asset identity; the reusable player owns all controls and gestures.
export class WorkspaceVideoChrome extends PlaybackChrome<VideoCanvasNode | AudioCanvasNode> {}
