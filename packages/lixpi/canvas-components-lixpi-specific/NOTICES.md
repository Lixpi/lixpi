# Distribution notices

The source in this package is covered by [the MIT license](LICENSE). Runtime dependencies retain their own licenses and notices; include those notices when distributing a bundled application.

This package depends on Lixpi contracts, Capability System, ProseMirror, UI-kit, ui-primitives and the reusable canvas packages. UI-kit retains its icon and artwork notices; do not treat this package's MIT license as a replacement for them.

Package exports resolve TypeScript and Sass source directly. A consumer supplies a compatible TypeScript loader/bundler, Sass processing when importing styles, and worker hosting when using image decoding. There is no package compilation step. The private workspace manifest prevents accidental publication; releasing from another repository requires dependency/version and publication metadata review.
