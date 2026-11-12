import { basicLight } from '../packages/basic-light/src/index.ts'
import { basicDark } from '../packages/basic-dark/src/index.ts'
import { solarizedDark } from '../packages/solarized-dark/src/index.ts'
import { solarizedLight } from '../packages/solarized-light/src/index.ts'
import { materialDark } from '../packages/material-dark/src/index.ts'
import { nord } from '../packages/nord/src/index.ts'
import { gruvboxLight } from '../packages/gruvbox-light/src/index.ts'
import { gruvboxDark } from '../packages/gruvbox-dark/src/index.ts'

const themes = [
    {
        extension: basicLight,
        name: 'Basic Light',
    },
    {
        extension: basicDark,
        name: 'Basic Dark',
    },
    {
        extension: solarizedLight,
        name: 'Solarized Light',
    },
    {
        extension: solarizedDark,
        name: 'Solarized Dark',
    },
    {
        extension: materialDark,
        name: 'Material Dark',
    },
    {
        extension: nord,
        name: 'Nord',
    },
    {
        extension: gruvboxLight,
        name: 'Gruvbox Light',
    },
    {
        extension: gruvboxDark,
        name: 'Gruvbox Dark',
    },
]

export default themes
