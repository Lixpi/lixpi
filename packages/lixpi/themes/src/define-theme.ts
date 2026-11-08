import {
    type ApplicationTheme,
    type ThemeRoles,
} from './template/application.ts'
import {
    type ComponentTheme,
} from './template/components.ts'

export type ThemeDefinition<Name extends string = string> = {
    name: Name
    colorScheme: ApplicationTheme['colorScheme']
    roles: ThemeRoles
    components: ComponentTheme
}

// Composition requires complete values; it never fills missing roles from another theme.
export const defineTheme = <const Name extends string>(definition: ThemeDefinition<Name>): ApplicationTheme & { name: Name } => ({
    ...definition.roles,
    name: definition.name,
    colorScheme: definition.colorScheme,
    components: definition.components,
})
