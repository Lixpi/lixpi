import { defineTheme } from '../../define-theme.ts'
import { marianaPalette } from '../../palettes/mariana.ts'
import { createSharedComponentValues } from '../../shared/components.ts'
import { createMarianaRoles } from './roles.ts'

export const oneDarkProMarianaTheme = defineTheme({
    name: 'one-dark-pro-mariana',
    colorScheme: 'dark',
    roles: createMarianaRoles(marianaPalette),
    components: createSharedComponentValues(),
})
