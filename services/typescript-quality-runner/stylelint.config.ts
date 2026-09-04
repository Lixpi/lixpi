const lixpiClassPattern = '^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|ProseMirror(?:-[A-Za-z0-9]+)*)$'

export default {
    customSyntax: 'postcss-scss',
    defaultSeverity: 'error',
    ignoreFiles: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        'packages-vendor/**',
    ],
    plugins: [
        'stylelint-scss',
    ],
    reportDescriptionlessDisables: true,
    reportInvalidScopeDisables: true,
    reportNeedlessDisables: true,
    reportUnscopedDisables: true,
    rules: {
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'custom-property-pattern': '^([a-z][a-z0-9]*)(-[a-z0-9]+)*$',
        'declaration-block-no-duplicate-custom-properties': true,
        'declaration-block-no-duplicate-properties': [
            true,
            {
                ignore: [
                    'consecutive-duplicates-with-different-syntaxes',
                ],
            },
        ],
        'font-family-no-duplicate-names': true,
        'function-calc-no-unspaced-operator': true,
        'function-linear-gradient-no-nonstandard-direction': true,
        'keyframe-block-no-duplicate-selectors': true,
        'lixpi/transition-helpers': true,
        'max-nesting-depth': [
            3,
            {
                ignore: [
                    'blockless-at-rules',
                    'pseudo-classes',
                ],
            },
        ],
        'no-duplicate-at-import-rules': true,
        'no-duplicate-selectors': true,
        'no-empty-source': true,
        'no-irregular-whitespace': true,
        'property-no-unknown': true,
        'scss/at-rule-no-unknown': true,
        'scss/dimension-no-non-numeric-values': true,
        'scss/function-calculation-no-interpolation': true,
        'scss/no-duplicate-dollar-variables': true,
        'scss/no-duplicate-load-rules': true,
        'scss/no-duplicate-mixins': true,
        'scss/operator-no-unspaced': true,
        'scss/selector-class-pattern': [
            lixpiClassPattern,
            {
                resolveNestedSelectors: true,
            },
        ],
        'scss/selector-no-redundant-nesting-selector': true,
        'selector-anb-no-unmatchable': true,
        'selector-pseudo-class-no-unknown': [
            true,
            {
                ignorePseudoClasses: [
                    'export',
                    'global',
                    'local',
                ],
            },
        ],
        'selector-pseudo-element-no-unknown': true,
        'string-no-newline': true,
        'unit-no-unknown': true,
    },
    overrides: [
        {
            files: [
                '**/*.scss',
            ],
            rules: {
                'lixpi/no-block-comments': true,
            },
        },
        {
            files: [
                'packages/lixpi/ui-primitives/src/styles/_transitions.scss',
            ],
            rules: {
                'lixpi/transition-helpers': null,
            },
        },
    ],
}
