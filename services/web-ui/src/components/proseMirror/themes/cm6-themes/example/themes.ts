import { basicLight } from '$src/components/proseMirror/themes/cm6-themes/packages/basic-light'
import { basicDark } from '$src/components/proseMirror/themes/cm6-themes/packages/basic-dark'
import { solarizedDark } from '$src/components/proseMirror/themes/cm6-themes/packages/solarized-dark'
import { solarizedLight } from '$src/components/proseMirror/themes/cm6-themes/packages/solarized-light'
import { materialDark } from '$src/components/proseMirror/themes/cm6-themes/packages/material-dark'
import { nord } from '$src/components/proseMirror/themes/cm6-themes/packages/nord'
import { gruvboxLight } from '$src/components/proseMirror/themes/cm6-themes/packages/gruvbox-light'
import { gruvboxDark } from '$src/components/proseMirror/themes/cm6-themes/packages/gruvbox-dark'

const themes = [
  {
    extension: basicLight,
    name: 'Basic Light'
  },
  {
    extension: basicDark,
    name: 'Basic Dark'
  },
  {
    extension: solarizedLight,
    name: 'Solarized Light'
  },
  {
    extension: solarizedDark,
    name: 'Solarized Dark'
  },
  {
    extension: materialDark,
    name: 'Material Dark'
  },
  {
    extension: nord,
    name: 'Nord'
  },
  {
    extension: gruvboxLight,
    name: 'Gruvbox Light'
  },
  {
    extension: gruvboxDark,
    name: 'Gruvbox Dark'
  }
]

export default themes
