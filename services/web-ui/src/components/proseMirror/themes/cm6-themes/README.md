Themes for CodeMirror 6
===========================

[ [**DEMO**](https://cm6-themes.netlify.app/) ]

Themes for [CodeMirror 6](https://codemirror.net/).

## Available themes

- [Basic Light]($src/components/proseMirror/themes/cm6-themes/packages/basic-light)
- [Basic Dark]($src/components/proseMirror/themes/cm6-themes/packages/basic-dark)
- [Solarized Light]($src/components/proseMirror/themes/cm6-themes/packages/solarized-light)
- [Solarized Dark]($src/components/proseMirror/themes/cm6-themes/packages/solarized-dark)
- [Material Dark]($src/components/proseMirror/themes/cm6-themes/packages/material-dark)
- [Nord]($src/components/proseMirror/themes/cm6-themes/packages/nord)
- [Gruvbox Light]($src/components/proseMirror/themes/cm6-themes/packages/gruvbox-light)
- [Gruvbox Dark]($src/components/proseMirror/themes/cm6-themes/packages/gruvbox-dark)

## How to use

```js
import { EditorView, basicSetup } from 'codemirror'
import { javascript } from "@codemirror/lang-javascript"
import { solarizedDark } from 'cm6-theme-solarized-dark'

let editor = new EditorView({
  doc: 'Hello',
  extensions: [
    basicSetup,
    javascript(),
    solarizedDark
  ],
  parent: document.body
})
```

Read [the CodeMirror documentation](https://codemirror.net/6/examples/styling/) for more detail about themes.

