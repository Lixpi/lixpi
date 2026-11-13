Themes for CodeMirror 6
===========================

[ [**DEMO**](https://cm6-themes.netlify.app/) ]

Themes for [CodeMirror 6](https://codemirror.net/).

Dependency versions in this theme workspace and its package manifests are generated from [the repository version registry](../../../../dev-tools/versions-registry/README.md). Edit the central JavaScript entries and synchronize the manifests before installing.

## Available themes

- [Basic Light](packages/basic-light)
- [Basic Dark](packages/basic-dark)
- [Solarized Light](packages/solarized-light)
- [Solarized Dark](packages/solarized-dark)
- [Material Dark](packages/material-dark)
- [Nord](packages/nord)
- [Gruvbox Light](packages/gruvbox-light)
- [Gruvbox Dark](packages/gruvbox-dark)

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
