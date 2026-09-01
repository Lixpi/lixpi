# Distribution notices

The source in this package is covered by [the MIT license](LICENSE). Runtime dependencies retain their own licenses and notices; include those notices when distributing a bundled application.

DOM templating uses htm. SVG selection and transitions use D3 packages. This package contains generic utilities, not UI-kit icons or artwork.

Package exports resolve TypeScript and Sass source directly. A consumer supplies a compatible TypeScript loader/bundler, Sass processing when importing styles, and worker hosting when using image decoding. There is no package compilation step. The private workspace manifest prevents accidental publication; releasing from another repository requires dependency/version and publication metadata review.
