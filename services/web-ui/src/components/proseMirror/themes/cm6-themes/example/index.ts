import {
    EditorView,
    basicSetup,
} from 'codemirror'
import {
    markdown,
    markdownLanguage,
} from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Compartment } from '@codemirror/state'
import testDoc from '$src/components/proseMirror/themes/cm6-themes/example/doc-example.ts'
import themes from '$src/components/proseMirror/themes/cm6-themes/example/themes.ts'
import { html } from '@lixpi/ui-primitives/dom'

const elCM = document.querySelector('#codemirror')

const themeConfig = new Compartment()

let editor = new EditorView({
    doc: testDoc,
    extensions: [
        basicSetup,
        markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            addKeymap: true,
            extensions: [],
        }),
        themeConfig.of([themes[0]]),
    ],
    parent: elCM,
})

const elList = document.querySelector('#theme-list')
if (elList) {
    for (let i = 0; i < themes.length; ++i) {
        const elItem = html`<option value=${i.toString()}>${themes[i].name}</option>` as HTMLOptionElement
        elList.appendChild(elItem)
    }

    elList.addEventListener('change', e => {
        if (e.currentTarget instanceof HTMLSelectElement) {
            const i = Number(e.currentTarget.value)

            editor.dispatch({
                effects: themeConfig.reconfigure([themes[i]]),
            })
        }
    })
}

export default editor
