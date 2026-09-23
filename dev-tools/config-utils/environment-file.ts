import { parseEnv } from 'node:util'

export const envLiteral = (value: string): string => {
    try {
        const parsed = parseEnv(`VALUE = ${value}\nNEXT = sentinel\n`)

        if (
            parsed.VALUE === value
            && parsed.NEXT === 'sentinel'
        )
            return value
    } catch {
        // Fall through to a quoted literal when the unquoted form is invalid.
    }

    return JSON.stringify(value)
}

// Keep the original assignments so partial updates don't discard comments,
// custom variables, quoting, interpolation, or multiline values.
export class EnvFileUpdates {
    private readonly source: string
    private readonly entries: Map<string, string>
    private readonly changes = new Map<string, string>()
    private readonly deletions = new Set<string>()
    private readonly assignment = /^([\t ]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[\t ]*=[\t ]*)('(\\[\s\S]|[^'\\])*'|"(\\[\s\S]|[^"\\])*"|[^\r\n]*)([^\r\n]*)(\r?\n|$)/gm

    constructor(source: string) {
        this.source = source
        this.entries = new Map(
            Array.from(
                source.matchAll(this.assignment),
                match => [match[2], this.splitComment(match[3], match[6]).literal],
            ),
        )
    }

    getValues(): Map<string, string> {
        return new Map(this.entries)
    }

    private splitComment(
        value: string,
        trailing: string,
    ): {
        literal: string
        comment: string
    } {
        const commentIndex = /^["']/.test(value) ? -1 : value.search(/(?:^|[\t ]+)#/)
        const literal = commentIndex === -1 ? value : value.slice(0, commentIndex)
        const comment = `${literal.slice(literal.trimEnd().length)}${commentIndex === -1 ? '' : value.slice(commentIndex)}${trailing}`

        return {
            literal: literal.trimEnd(),
            comment,
        }
    }

    setValue(
        name: string,
        literal: string,
    ): void {
        const assignment = `${name}=${literal}\n`
        const matches = Array.from(
            assignment.matchAll(this.assignment),
        )
        const match = matches[0]

        if (
            !match
            || matches.length !== 1
            || match[0] !== assignment
            || match[2] !== name
        )
            throw new Error(`Invalid environment assignment for ${name}`)

        const value = match[3].trimEnd()

        if (
            /^["']/.test(value)
            && !new RegExp(`^${value[0]}(?:\\\\[\\s\\S]|[^${value[0]}\\\\])*${value[0]}$`).test(value)
        )
            throw new Error(`Unclosed quoted value for ${name}`)

        if (
            match[6].trim()
            && !match[6].trimStart().startsWith('#')
        )
            throw new Error(`Unexpected text after ${name}`)

        this.deletions.delete(name)
        this.changes.set(name, literal)
    }

    deleteValue(name: string): void {
        this.changes.delete(name)
        this.deletions.add(name)
    }

    render(): string {
        let content = this.source.replace(this.assignment, (
            assignment,
            prefix,
            name,
            value,
            _single,
            _double,
            comment,
            ending,
        ) => {
            if (this.deletions.has(name))
                return ''

            if (!this.changes.has(name))
                return assignment

            const suffix = this.splitComment(value, comment).comment
            const spacing = suffix.startsWith('#') ? ' ' : ''

            const spacedPrefix = prefix.replace(/[\t ]*=[\t ]*$/, ' = ')

            return `${spacedPrefix}${this.changes.get(name)}${spacing}${suffix}${ending}`
        })
        const newline = this.source.includes('\r\n') ? '\r\n' : '\n'

        for (const [name, literal] of this.changes) {
            if (this.entries.has(name))
                continue

            if (
                content
                && !content.endsWith('\n')
            )
                content += newline

            content += `${name} = ${literal}${newline}`
        }

        return content
    }
}
