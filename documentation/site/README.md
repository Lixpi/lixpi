# Lixpi Docs Site

The Markdoc renderer publishes central documentation and registered package manuals from their original repository paths. It uses `@markdoc/markdoc` and no client framework.

## Documentation sources

`source-registry.mjs` registers `documentation/`, plus the README, notices and `docs/` directory of the canvas packages, UI Primitives and UI Kit. Package source files and examples remain repository links. The registry excludes dependencies, generated output and hidden directories.

A source has one output route. Central pages keep their documentation-relative route. Package manuals render below `packages/<package>/`, with the package README at `index.html`. Links are resolved relative to the file that contains them, including links between central and package documentation. Registered images are copied to their registered routes. Links to other repository files resolve to their GitHub source.

Validation and HTML rendering use the same resolver. Missing files, duplicate routes, paths escaping the repository and nonexistent heading fragments fail validation. Heading IDs come from the same Markdoc AST traversal used to render headings, so fenced code does not create anchors.

## Tests

Run the registry and link tests without generating the site:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner docs-site
```

The test runner mounts the repository read-only and keeps its dependencies in the separate `typescript-test-runner-node-modules-docs-site` volume. Tests use temporary fixture directories and do not write site output.

## Build

Only run a documentation build when explicitly requested. Run tooling inside Docker, with the whole repository at its original shape so package-relative links resolve:

```bash
docker run --rm --entrypoint sh \
  -v "$PWD:/repository" \
  -v lixpi-docs-site-node-modules:/repository/documentation/site/node_modules \
  -w /repository/documentation/site \
  lixpi/web-ui -lc 'pnpm install && node build.mjs'
```

The renderer parses and validates every registered page before replacing `documentation/site/dist/`. It copies registered assets and generates navigation from the registered output routes. Each page links to its authored source. Package source files are not copied into the site.

## Authoring

Keep documentation links relative and point at Markdown source files. Use fenced blocks for code and Mermaid. Use standard Markdown or the supported Markdoc callout tag. See [Maintaining Documentation](../MAINTAINING-DOCUMENTATION.md) for discovery and page moves.

## Implementation

| File | Responsibility |
|---|---|
| [source-registry.mjs](source-registry.mjs) | Source registration, output routes, path bounds, assets and link resolution |
| [markdoc/config.mjs](markdoc/config.mjs) | Shared heading IDs, links, images, code fences and callouts |
| [build.mjs](build.mjs) | Parse, validate, render, generate navigation and write output |
| [markdoc/template.mjs](markdoc/template.mjs) | Page shell, source attribution and sidebar |
| [assets/styles.css](assets/styles.css) | Site presentation |
