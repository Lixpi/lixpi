// HTML page shell + sidebar navigation rendering. Pure string templating, no deps.

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

// Render the nav tree (built in build.mjs) to nested <ul>. `rootPrefix` makes
// every link relative to the current page's depth (e.g. "../" or "../../").
// `currentRel` is the current page's posix .html path, used to mark the active link.
function renderNavTree(tree, rootPrefix, currentRel) {
    if (!tree.children || tree.children.length === 0) return ''

    const items = tree.children.map((node) => {
        if (node.kind === 'dir') {
            return `<li class="nav-group"><span class="nav-group-label">${escapeHtml(node.label)}</span>${renderNavTree(node, rootPrefix, currentRel)}</li>`
        }
        const isActive = node.rel === currentRel
        const cls = isActive ? ' class="nav-link is-active" aria-current="page"' : ' class="nav-link"'
        return `<li><a${cls} href="${rootPrefix}${node.rel}">${escapeHtml(node.label)}</a></li>`
    })

    return `<ul class="nav-list">${items.join('')}</ul>`
}

export function renderNav(tree, rootPrefix, currentRel) {
    return `<nav class="sidebar-nav" aria-label="Documentation">${renderNavTree(tree, rootPrefix, currentRel)}</nav>`
}

export function renderPage({ title, description, contentHtml, navHtml, rootPrefix }) {
    const safeTitle = escapeHtml(title || 'Lixpi Documentation')
    const metaDescription = description
        ? `\n    <meta name="description" content="${escapeHtml(description)}">`
        : ''

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle} · Lixpi Docs</title>${metaDescription}
    <link rel="stylesheet" href="${rootPrefix}_assets/styles.css">
</head>
<body>
    <div class="layout">
        <aside class="sidebar">
            <a class="brand" href="${rootPrefix}index.html">Lixpi&nbsp;Docs</a>
            ${navHtml}
        </aside>
        <main class="content lixpi-markdown">
${contentHtml}
        </main>
    </div>
</body>
</html>
`
}
