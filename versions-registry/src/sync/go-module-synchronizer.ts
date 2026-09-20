import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'

export const synchronizeGoModule = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string => {
    let goLanguageDirectiveCount = 0
    let insideRequirementBlock = false

    const output = source.split('\n').map(line => {
        if (/^go \S+$/.test(line)) {
            goLanguageDirectiveCount++

            return `go ${catalog.data.go.go}`
        }

        if (/^require\s*\($/.test(line)) {
            insideRequirementBlock = true

            return line
        }

        if (
            insideRequirementBlock
            && /^\)/.test(line)
        ) {
            insideRequirementBlock = false

            return line
        }

        const requirement = line.match(insideRequirementBlock
            ? /^(\s+)(\S+)(\s+)(v\S+)(.*)$/
            : /^(require\s+)(\S+)(\s+)(v\S+)(.*)$/)

        if (!requirement)
            return line

        const selectedVersion = catalog.data.go.modules[requirement[2]]

        if (!selectedVersion)
            throw new Error(`Register Go module ${requirement[2]} before synchronizing ${path}`)

        return `${requirement[1]}${requirement[2]}${requirement[3]}${selectedVersion}${requirement[5]}`
    }).join('\n')

    if (goLanguageDirectiveCount !== 1)
        throw new Error(`Expected one Go language directive in ${path}`)

    return output
}
