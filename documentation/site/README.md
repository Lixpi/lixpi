# Lixpi Docs Site

The Markdoc renderer publishes central documentation and registered package/service manuals from their original repository paths. It uses `@markdoc/markdoc` and no client framework.

## Documentation sources

`source-registry.mjs` registers `documentation/`, the selected package manuals, and the service README and `documentation/` directories for NATS, Caddy and AI Model Registry. Source directories and examples remain repository links. This keeps the manuals beside their code without pulling implementation trees into site navigation. The registry excludes dependencies, generated output and hidden directories.

A source has one output route. Central pages keep their documentation-relative route. Package manuals render below `packages/<package>/`, and service manuals below `services/<service>/`, with each root README at `index.html`. Links are resolved relative to the file that contains them, including links between central, service and package documentation. Registered images are copied to their registered routes. Links to other repository files resolve to their GitHub source.

Validation and HTML rendering use the same resolver. Missing files, duplicate routes, paths escaping the repository and nonexistent heading fragments fail validation. Heading IDs come from the same Markdoc AST traversal used to render headings, so fenced code does not create anchors.

## Tests

Run the registry and link tests without generating the site:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner docs-site
```

The test runner mounts the repository read-only and keeps its dependencies in the separate `typescript-test-runner-node-modules-docs-site` volume. Tests check source discovery, published routes, heading fragments and links. They also parse the NATS and Caddy source-directory READMEs for link validation without adding those directories to published navigation. Markdoc validation and HTML transformation happen in memory; tests do not write site output or render Mermaid diagrams.

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

The renderer emits Mermaid source in `<pre class="mermaid">` placeholders. The site template does not load a Mermaid client renderer. Markdoc tests therefore check those pages and links without proving that a diagram renders in a browser or editor preview.

## Implementation

| File | Responsibility |
|---|---|
| [source-registry.mjs](source-registry.mjs) | Source registration, output routes, path bounds, assets and link resolution |
| [markdoc/config.mjs](markdoc/config.mjs) | Shared heading IDs, links, images, code fences and callouts |
| [build.mjs](build.mjs) | Parse, validate, render, generate navigation and write output |
| [markdoc/template.mjs](markdoc/template.mjs) | Page shell, source attribution and sidebar |
| [assets/styles.css](assets/styles.css) | Site presentation |
