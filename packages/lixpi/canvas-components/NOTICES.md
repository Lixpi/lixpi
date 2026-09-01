# Distribution notices

The source in this package is covered by [the MIT license](LICENSE). Runtime dependencies retain their own licenses and notices; include those notices when distributing a bundled application.

Glass and outline effects contain their own geometry, shading and generated pixels. Generic gradients come from ui-primitives. This package does not redistribute UI-kit icons, fonts or texture artwork.

Package exports resolve TypeScript and Sass source directly. A consumer supplies a compatible TypeScript loader/bundler, Sass processing when importing styles, and worker hosting when using image decoding. There is no package compilation step. The private workspace manifest prevents accidental publication; releasing from another repository requires dependency/version and publication metadata review.
