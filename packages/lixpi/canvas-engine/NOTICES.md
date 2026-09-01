# Distribution notices

The source in this package is covered by [the MIT license](LICENSE). Runtime dependencies retain their own licenses and notices; include those notices when distributing a bundled application.

PixiJS, XYFlow System, ELK and RBush are runtime dependencies, not public renderer contracts. The image decoder worker ships as TypeScript source alongside its owner.

Package exports resolve TypeScript and Sass source directly. A consumer supplies a compatible TypeScript loader/bundler, Sass processing when importing styles, and worker hosting when using image decoding. There is no package compilation step. The private workspace manifest prevents accidental publication; releasing from another repository requires dependency/version and publication metadata review.
