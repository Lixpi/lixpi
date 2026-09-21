// Lixpi's own classes are flat kebab-case. The alternatives are class names a library
// renders itself and a stylesheet can only match: ProseMirror's, and CodeMirror's
// `cm-` set, which is camelCase past the prefix (`cm-foldGutter`, `cm-gutterElement`).
const lixpiClassPattern = '^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|ProseMirror(?:-[A-Za-z0-9]+)*|cm-[A-Za-z0-9]+)$'

// The shared Stylelint policy rejects invalid CSS and SCSS constructs, keeps selectors and
// custom properties predictable, and loads Lixpi rules by name through the runner adapter.
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
        // Reject malformed or contradictory declarations that browsers would ignore or
        // interpret inconsistently.
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

        // Route transition values through the shared motion primitives instead of letting
        // components invent durations and easing curves independently.
        'lixpi/transition-helpers': true,

        // Limit structural complexity while allowing at-rules and pseudo-class qualifiers
        // that do not create another component ownership level.
        'max-nesting-depth': [
            3,
            {
                ignore: [
                    'blockless-at-rules',
                    'pseudo-classes',
                ],
            },
        ],

        // Reject duplicate, empty, unknown, or otherwise invalid base CSS syntax.
        'no-duplicate-at-import-rules': true,
        'no-duplicate-selectors': true,
        'no-empty-source': true,
        'no-irregular-whitespace': true,
        'property-no-unknown': true,

        // Apply SCSS-aware validity and duplication checks that core CSS rules cannot parse.
        'scss/at-rule-no-unknown': true,
        'scss/dimension-no-non-numeric-values': true,
        'scss/function-calculation-no-interpolation': true,
        'scss/no-duplicate-dollar-variables': true,
        'scss/no-duplicate-load-rules': true,
        'scss/no-duplicate-mixins': true,
        'scss/operator-no-unspaced': true,

        // Keep application class names flat kebab-case while allowing explicit editor-library
        // class contracts rendered outside this repository's control.
        'scss/selector-class-pattern': [
            lixpiClassPattern,
            {
                resolveNestedSelectors: true,
            },
        ],
        'scss/selector-no-redundant-nesting-selector': true,

        // Catch selectors, strings, and units that parse but can never match or evaluate.
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
        // SCSS supports `//` comments, so block comments can be converted safely there.
        {
            files: [
                '**/*.scss',
            ],
            rules: {
                'lixpi/no-block-comments': true,
            },
        },
        // The transition primitive defines the helpers that every other stylesheet must
        // consume, so enforcing helper usage inside that file would be circular.
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
