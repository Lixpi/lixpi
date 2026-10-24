// Gentelella form controls, from checkboxes to OTP inputs. The date range,
// multi-select and rich-text controls are upgraded by the form-controls
// runtime once they are in the document.

import {
    createGentelellaCharacterCounter,
    createGentelellaChoice,
    createGentelellaColorSwatches,
    createGentelellaDateRange,
    createGentelellaDropzone,
    createGentelellaFileInput,
    createGentelellaMultiSelect,
    createGentelellaOtpInput,
    createGentelellaPasswordStrength,
    createGentelellaRating,
    createGentelellaRichText,
    createGentelellaSegmentedControl,
    createGentelellaSlider,
    createGentelellaSwitch,
    createGentelellaTagInput,
    createGentelellaToggle,
} from '@lixpi/ui-kit-gentelella/components/form-controls'
import { applyGentelellaFormControl } from '@lixpi/ui-kit-gentelella/components/form'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'

export const createGentelellaFormControlsPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/ui-kit-gentelella/components/form-controls',
        title: 'Form controls',
        description: 'Each control reports user changes through onChange and exposes setters for programmatic updates.',
    })

    page.addSection({
        title: 'Choices, switches and toggles',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: [
                    page.own(
                        createGentelellaChoice({
                            checked: true,
                            label: 'Email me updates',
                            name: 'updates',
                            type: 'checkbox',
                        }),
                    ).el,
                    page.own(
                        createGentelellaChoice({
                            label: 'Weekly digest',
                            name: 'digest',
                            type: 'checkbox',
                        }),
                    ).el,
                    page.own(
                        createGentelellaChoice({
                            disabled: true,
                            label: 'Disabled',
                            name: 'disabled',
                            type: 'checkbox',
                        }),
                    ).el,
                ],
                label: "type: 'checkbox'",
            }),
            createShowcaseSpecimen({
                content: ['Image', 'Video', 'Audio'].map(
                    (label, index) => page.own(
                        createGentelellaChoice({
                            checked: index === 0,
                            label,
                            name: 'media-kind',
                            type: 'radio',
                            value: label.toLowerCase(),
                            onChange: checked => {
                                if (checked)
                                    announce(`Selected ${label}`)
                            },
                        }),
                    ).el,
                ),
                label: "type: 'radio'",
            }),
            createShowcaseSpecimen({
                content: [
                    page.own(
                        createGentelellaSwitch({
                            checked: true,
                            label: 'Autosave',
                            onChange: checked => announce(`Autosave ${checked ? 'on' : 'off'}`),
                        }),
                    ).el,
                    page.own(
                        createGentelellaSwitch({
                            disabled: true,
                            label: 'Disabled switch',
                        }),
                    ).el,
                    page.own(
                        createGentelellaToggle({
                            label: 'Grid',
                            on: true,
                            onChange: on => announce(`Grid ${on ? 'on' : 'off'}`),
                        }),
                    ).el,
                ],
                label: 'createGentelellaSwitch, createGentelellaToggle',
            }),
        ],
    })

    const segmented = page.own(
        createGentelellaSegmentedControl({
            ariaLabel: 'Density',
            name: 'density',
            options: [
                {
                    label: 'Compact',
                    value: 'compact',
                },
                {
                    label: 'Comfortable',
                    value: 'comfortable',
                },
                {
                    disabled: true,
                    label: 'Spacious',
                    value: 'spacious',
                },
            ],
            value: 'comfortable',
            onChange: value => announce(`Density ${value}`),
        }),
    )
    const slider = page.own(
        createGentelellaSlider({
            label: 'Opacity',
            max: 100,
            min: 0,
            step: 5,
            value: 60,
            onChange: value => announce(`Opacity ${value}`),
        }),
    )
    page.addSection({
        title: 'Segmented control and slider',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: segmented.el,
                label: 'createGentelellaSegmentedControl',
            }),
            createShowcaseSpecimen({
                content: [
                    slider.el,
                    page.own(
                        createGentelellaButton({
                            label: 'setValue(25)',
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => slider.setValue(25),
                        }),
                    ).el,
                ],
                label: 'createGentelellaSlider',
            }),
        ],
    })

    const fileInput = page.own(
        createGentelellaFileInput({
            accept: 'image/*',
            label: 'Choose an image',
            onChange: files => announce(`${files?.length ?? 0} file(s) chosen`),
        }),
    )
    page.addSection({
        title: 'Files',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    fileInput.el,
                    page.own(
                        createGentelellaButton({
                            label: 'clear()',
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => fileInput.clear(),
                        }),
                    ).el,
                ],
                label: 'createGentelellaFileInput',
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaDropzone({
                        label: 'Drop files here or click to browse',
                        multiple: true,
                        onFiles: files => announce(`${files.length} file(s) dropped`),
                    }),
                ).el,
                label: 'createGentelellaDropzone',
            }),
        ],
    })

    const dateRange = page.own(
        createGentelellaDateRange({ placeholder: 'Select a range' }),
    )
    const multiSelect = page.own(
        createGentelellaMultiSelect({
            name: 'tags',
            options: [
                {
                    label: 'Character',
                    selected: true,
                    value: 'character',
                },
                {
                    label: 'Environment',
                    value: 'environment',
                },
                {
                    label: 'Prop',
                    selected: true,
                    value: 'prop',
                },
                {
                    label: 'Lighting',
                    value: 'lighting',
                },
            ],
        }),
    )
    const richText = page.own(
        createGentelellaRichText({ html: '<p>Write the <strong>brief</strong> here.</p>' }),
    )
    page.onMount(() => dateRange.initialize())
    page.addSection({
        title: 'Runtime-backed controls',
        description: 'initialize runs the Gentelella form-controls runtime, which upgrades these controls in place. It covers every advanced control on the page.',
        columns: 3,
        content: [
            createShowcaseSpecimen({
                content: dateRange.el,
                label: 'createGentelellaDateRange',
            }),
            createShowcaseSpecimen({
                content: multiSelect.el,
                label: 'createGentelellaMultiSelect',
            }),
            createShowcaseSpecimen({
                content: richText.el,
                label: 'createGentelellaRichText',
            }),
        ],
    })

    const otp = page.own(
        createGentelellaOtpInput({
            length: 6,
            onChange: value => {
                if (value.length === 6)
                    announce(`Code ${value}`)
            },
        }),
    )
    const strength = page.own(
        createGentelellaPasswordStrength({
            label: 'Weak',
            value: 1,
        }),
    )
    const password = applyGentelellaFormControl(
        html`
            <input
                type="password"
                placeholder="Password"
            />
        ` as HTMLInputElement,
    )
    password.addEventListener('input', () => {
        const score = Math.min(
            4,
            Math.floor(password.value.length / 3),
        )
        strength.setValue(score, ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score])
    })
    page.addSection({
        title: 'Codes and passwords',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    otp.el,
                    page.own(
                        createGentelellaButton({
                            label: "setValue('123456')",
                            size: 'small',
                            variant: 'ghost',
                            onClick: () => otp.setValue('123456'),
                        }),
                    ).el,
                ],
                label: 'createGentelellaOtpInput({ length: 6 })',
            }),
            createShowcaseSpecimen({
                content: [password, strength.el],
                label: 'createGentelellaPasswordStrength',
            }),
        ],
    })

    const tags = page.own(
        createGentelellaTagInput({
            label: 'Tags',
            placeholder: 'Add a tag',
            values: ['portrait', 'studio'],
            onChange: values => announce(`Tags: ${values.join(', ')}`),
        }),
    )
    const counted = applyGentelellaFormControl(html`
        <textarea
            rows="3"
            maxlength="120"
        ></textarea>
    ` as HTMLTextAreaElement)
    const counter = page.own(
        createGentelellaCharacterCounter({
            control: counted,
            maxLength: 120,
        }),
    )
    page.addSection({
        title: 'Ratings, tags, swatches and counters',
        columns: 2,
        content: [
            createShowcaseSpecimen({
                content: [
                    page.own(
                        createGentelellaRating({
                            label: 'Rate this output',
                            value: 3,
                            onChange: value => announce(`Rated ${value}`),
                        }),
                    ).el,
                    page.own(
                        createGentelellaRating({
                            label: 'Read only',
                            max: 10,
                            readonly: true,
                            value: 7,
                        }),
                    ).el,
                ],
                label: 'createGentelellaRating',
            }),
            createShowcaseSpecimen({
                content: [
                    tags.el,
                    createShowcaseRow([
                        page.own(
                            createGentelellaButton({
                                label: "add('outdoor')",
                                size: 'small',
                                variant: 'ghost',
                                onClick: () => tags.add('outdoor'),
                            }),
                        ).el,
                        page.own(
                            createGentelellaButton({
                                label: "remove('studio')",
                                size: 'small',
                                variant: 'ghost',
                                onClick: () => tags.remove('studio'),
                            }),
                        ).el,
                    ]),
                ],
                label: 'createGentelellaTagInput',
            }),
            createShowcaseSpecimen({
                content: page.own(
                    createGentelellaColorSwatches({
                        ariaLabel: 'Label color',
                        swatches: ['#3d649c', '#a55324', '#39766f', '#6d4fb2', '#5d656d'].map(
                            (color, index) => ({
                                color,
                                label: ['Blue', 'Rust', 'Teal', 'Violet', 'Slate'][index],
                                value: color,
                            }),
                        ),
                        value: '#39766f',
                        onChange: value => announce(`Color ${value}`),
                    }),
                ).el,
                label: 'createGentelellaColorSwatches',
            }),
            createShowcaseSpecimen({
                content: [counted, counter.el],
                label: 'createGentelellaCharacterCounter({ maxLength: 120 })',
            }),
        ],
    })

    return page
}
