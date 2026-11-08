import { defineTheme } from '../../define-theme.ts'
import { lixpiPalette } from '../../palettes/lixpi.ts'
import { createSharedComponentValues } from '../../shared/components.ts'
import { createLixpiLightRoles } from './roles.ts'

export const lixpiLightTheme = defineTheme({
    name: 'lixpi-light',
    colorScheme: 'light',
    roles: createLixpiLightRoles(lixpiPalette),
    components: createSharedComponentValues(),
})
