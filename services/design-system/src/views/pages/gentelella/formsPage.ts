// Gentelella form structure: forms, rows, fields with help, hints and
// validation, actions, input groups and base control styling.

import {
    applyGentelellaFormControl,
    createGentelellaForm,
    createGentelellaFormActions,
    createGentelellaFormField,
    createGentelellaFormRow,
} from '@lixpi/ui-kit-gentelella/components/form'
import { createGentelellaInputGroup } from '@lixpi/ui-kit-gentelella/components/input-group'
import { setGentelellaControlValidation } from '@lixpi/ui-kit-gentelella/components/form-controls'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { GENTELELLA_ICONS } from '@lixpi/ui-kit-gentelella/components/media'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'

const input = (
    type: string,
    placeholder: string,
): HTMLInputElement =>
    applyGentelellaFormControl(
        html`
            <input
                type=${type}
                placeholder=${placeholder}
            />
        ` as HTMLInputElement,
    )

export const createGentelellaFormsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/form',
        title: 'Forms',
        description: 'Fields wrap a caller-owned control. applyGentelellaFormControl gives an input, select or textarea the theme control class.',
    })

    const email = page.own(
        createGentelellaFormField({
            control: input('email', 'you@studio.com'),
            help: 'We send sign-in links here.',
            label: 'Email',
            required: true,
        }),
    )
    const name = page.own(
        createGentelellaFormField({
            control: input('text', 'Studio name'),
            hint: 'Shown to collaborators.',
            label: 'Organization',
        }),
    )
    const select = applyGentelellaFormControl(
        html`
            <select>
                <option>Owner</option>
                <option>Editor</option>
                <option>Viewer</option>
            </select>
        ` as HTMLSelectElement,
    )
    const role = page.own(
        createGentelellaFormField({
            control: select,
            label: 'Role',
        }),
    )
    const notes = page.own(
        createGentelellaFormField({
            control: applyGentelellaFormControl(html`<textarea rows="3"></textarea>` as HTMLTextAreaElement),
            label: 'Notes',
        }),
    )
    const form = page.own(
        createGentelellaForm({
            content: [
                page.own(
                    createGentelellaFormRow({
                        columns: 2,
                        content: [email.el, name.el],
                    }),
                ).el,
                page.own(
                    createGentelellaFormRow({
                        columns: 3,
                        content: [
                            role.el,
                            page.own(
                                createGentelellaFormField({
                                    control: input('date', ''),
                                    label: 'Start date',
                                }),
                            ).el,
                            page.own(
                                createGentelellaFormField({
                                    control: input('number', '3'),
                                    label: 'Seats',
                                }),
                            ).el,
                        ],
                    }),
                ).el,
                notes.el,
                page.own(
                    createGentelellaFormActions({
                        content: [
                            page.own(
                                createGentelellaButton({
                                    label: 'Save',
                                    type: 'submit',
                                    variant: 'primary',
                                }),
                            ).el,
                            page.own(
                                createGentelellaButton({
                                    label: 'Reset',
                                    type: 'reset',
                                    variant: 'ghost',
                                }),
                            ).el,
                        ],
                    }),
                ).el,
            ],
            onSubmit: event => {
                event.preventDefault()
                const value = (email.control as HTMLInputElement).value
                email.setError(value.includes('@') ? null : 'Enter an email address.')
                announce(value.includes('@') ? 'Form submitted' : 'Form has errors')
            },
        }),
    )
    page.addSection({
        title: 'Form with rows, fields and actions',
        description: 'Submit with an invalid email to see setError. Rows take two or three columns.',
        content: form.el,
    })

    const invalid = input('text', 'Invalid control')
    setGentelellaControlValidation(invalid, 'This value is not allowed.')
    page.addSection({
        title: 'Field states',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaFormField({
                        control: input('text', 'Required'),
                        error: 'This field is required.',
                        label: 'Initial error',
                        required: true,
                    }),
                ).el,
                label: 'error',
            }),
            createShowcaseSpecimen({
                content: invalid,
                label: 'setGentelellaControlValidation',
            }),
            createShowcaseSpecimen({
                content: input('text', 'Themed control'),
                label: 'Plain themed control',
            }),
        ],
    })

    page.addSection({
        title: 'Input groups',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaInputGroup({
                        control: input('search', 'Search models'),
                        iconHtml: GENTELELLA_ICONS.help,
                    }),
                ).el,
                label: 'iconHtml',
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaInputGroup({ control: input('text', 'No icon') }),
                ).el,
                label: 'control only',
            }),
        ],
    })

    return page
}
