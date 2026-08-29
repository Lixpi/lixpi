# Using Coding Style Guides

Read this file before writing or modifying implementation code, then read every guide below that matches the files being touched.

## Guide Selection

| Files being touched | Mandatory guides |
|---------------------|------------------|
| Any `.ts` or `.tsx` file, anywhere in the repository — `services/api`, `services/nex`, `services/web-ui`, `packages/lixpi`, `infrastructure/pulumi`, scripts | [`TYPESCRIPT.md`](TYPESCRIPT.md) |
| `.scss` files or code that creates or selects styled DOM elements | [`SASS-AND-CSS.md`](SASS-AND-CSS.md) |
| `services/web-ui` UI work — TypeScript DOM components, D3/SVG, canvas chrome, ProseMirror plugins, shared components | [`UI-COMPONENTS.md`](UI-COMPONENTS.md), in addition to the guides above |

`TYPESCRIPT.md` is not a web-ui guide. Its rules on imports, `type` over `interface`, comments, classes, and modern APIs bind every TypeScript file in the monorepo, including backend services, NEX workloads, shared packages, and infrastructure code. Only its DOM-templating section is scoped to `services/web-ui`, and it says so explicitly.

Guides stack: a TypeScript UI component with styles requires all three.

New guides added to this directory are automatically part of this selection rule; no agent-skill catalog update is required.
