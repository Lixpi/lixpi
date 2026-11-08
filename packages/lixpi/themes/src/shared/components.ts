import {
    type ComponentTheme,
} from '../template/components.ts'
import { controlValues } from './controls.ts'
import { panelValues } from './panels.ts'
import { contentValues } from './content.ts'

// Both presets deliberately reuse these paints, with independent mutable component values.
export const createSharedComponentValues = (): ComponentTheme =>
    structuredClone({
        ...controlValues,
        ...panelValues,
        ...contentValues,
    })
