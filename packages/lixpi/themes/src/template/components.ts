import {
    type ControlTheme,
} from './controls.ts'
import {
    type PanelTheme,
} from './panels.ts'
import {
    type ContentTheme,
} from './content.ts'

export type ComponentTheme = ControlTheme & PanelTheme & ContentTheme
