export type JsonSchemaValidationResult =
    | { valid: true }
    | {
        valid: false
        errors: string[]
    }

type JsonSchema = Record<string, unknown>

export const validateJsonSchemaValue = (
    schema: unknown,
    value: unknown,
): JsonSchemaValidationResult => {
    const errors: string[] = []
    validateNode(
        schema,
        value,
        '$',
        errors,
        0,
        schema,
    )

    return errors.length === 0 ? { valid: true } : {
        valid: false,
        errors,
    }
}

function validateNode(
    schemaValue: unknown,
    value: unknown,
    path: string,
    errors: string[],
    depth: number,
    rootSchema: unknown,
): void {
    if (depth > 64) {
        errors.push(`${path}: schema nesting exceeds 64 levels`)

        return
    }

    if (schemaValue === true)
        return

    if (schemaValue === false) {
        errors.push(`${path}: value is forbidden by schema`)

        return
    }

    if (!isRecord(schemaValue)) {
        errors.push(`${path}: schema must be an object or boolean`)

        return
    }

    const schema = schemaValue as JsonSchema

    if (typeof schema.$ref === 'string') {
        const referenced = resolveLocalReference(rootSchema, schema.$ref)

        if (referenced === undefined)
            errors.push(`${path}: schema reference ${schema.$ref} was not found`)
        else
            validateNode(
                referenced,
                value,
                path,
                errors,
                depth + 1,
                rootSchema,
            )

        return
    }

    if (
        Array.isArray(schema.enum)
        && !schema.enum.some(item => deepEqual(item, value))
    )
        errors.push(`${path}: value is not in enum`)

    if (
        Object.hasOwn(schema, 'const')
        && !deepEqual(schema.const, value)
    )
        errors.push(`${path}: value does not match const`)

    if (Array.isArray(schema.allOf)) {
        for (const child of schema.allOf)
            validateNode(
                child,
                value,
                path,
                errors,
                depth + 1,
                rootSchema,
            )
    }

    if (Array.isArray(schema.anyOf)) {
        const matches = schema.anyOf.filter(
            child => validateBranch(
                child,
                value,
                depth + 1,
                rootSchema,
            ),
        )

        if (matches.length === 0)
            errors.push(`${path}: value does not match anyOf`)
    }

    if (Array.isArray(schema.oneOf)) {
        const matches = schema.oneOf.filter(
            child => validateBranch(
                child,
                value,
                depth + 1,
                rootSchema,
            ),
        )

        if (matches.length !== 1)
            errors.push(`${path}: value must match exactly one oneOf branch`)
    }

    if (
        schema.not !== undefined
        && validateBranch(
            schema.not,
            value,
            depth + 1,
            rootSchema,
        )
    )
        errors.push(`${path}: value matches forbidden schema`)

    const allowedTypes = typeof schema.type === 'string'
        ? [schema.type]
        : Array.isArray(schema.type)
            ? schema.type.filter(type => typeof type === 'string')
            : []

    if (
        allowedTypes.length > 0
        && !allowedTypes.some(type => matchesType(type, value))
    ) {
        errors.push(`${path}: expected ${allowedTypes.join(' or ')}`)

        return
    }

    if (typeof value === 'string')
        validateString(
            schema,
            value,
            path,
            errors,
        )

    if (typeof value === 'number')
        validateNumber(
            schema,
            value,
            path,
            errors,
        )

    if (Array.isArray(value))
        validateArray(
            schema,
            value,
            path,
            errors,
            depth,
            rootSchema,
        )

    if (isRecord(value))
        validateObject(
            schema,
            value,
            path,
            errors,
            depth,
            rootSchema,
        )
}

function validateString(
    schema: JsonSchema,
    value: string,
    path: string,
    errors: string[],
): void {
    if (
        typeof schema.minLength === 'number'
        && value.length < schema.minLength
    )
        errors.push(`${path}: string is shorter than minLength`)

    if (
        typeof schema.maxLength === 'number'
        && value.length > schema.maxLength
    )
        errors.push(`${path}: string is longer than maxLength`)

    if (typeof schema.pattern === 'string') {
        try {
            if (!new RegExp(schema.pattern, 'u').test(value))
                errors.push(`${path}: string does not match pattern`)
        } catch {
            errors.push(`${path}: schema pattern is invalid`)
        }
    }
}

function validateNumber(
    schema: JsonSchema,
    value: number,
    path: string,
    errors: string[],
): void {
    if (!Number.isFinite(value)) {
        errors.push(`${path}: number must be finite`)

        return
    }

    if (
        typeof schema.minimum === 'number'
        && value < schema.minimum
    )
        errors.push(`${path}: number is below minimum`)

    if (
        typeof schema.maximum === 'number'
        && value > schema.maximum
    )
        errors.push(`${path}: number is above maximum`)

    if (
        typeof schema.exclusiveMinimum === 'number'
        && value <= schema.exclusiveMinimum
    )
        errors.push(`${path}: number is not above exclusiveMinimum`)

    if (
        typeof schema.exclusiveMaximum === 'number'
        && value >= schema.exclusiveMaximum
    )
        errors.push(`${path}: number is not below exclusiveMaximum`)
}

function validateArray(
    schema: JsonSchema,
    value: unknown[],
    path: string,
    errors: string[],
    depth: number,
    rootSchema: unknown,
): void {
    if (
        typeof schema.minItems === 'number'
        && value.length < schema.minItems
    )
        errors.push(`${path}: array is too short`)

    if (
        typeof schema.maxItems === 'number'
        && value.length > schema.maxItems
    )
        errors.push(`${path}: array is too long`)

    if (
        schema.uniqueItems === true
        && new Set(
            value.map(stableStringify),
        ).size !== value.length
    )
        errors.push(`${path}: array items must be unique`)

    if (schema.items !== undefined)
        value.forEach(
            (item, index) => validateNode(
                schema.items,
                item,
                `${path}[${index}]`,
                errors,
                depth + 1,
                rootSchema,
            ),
        )
}

function validateObject(
    schema: JsonSchema,
    value: Record<string, unknown>,
    path: string,
    errors: string[],
    depth: number,
    rootSchema: unknown,
): void {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
        ? schema.required.filter(key => typeof key === 'string') as string[]
        : []

    for (const key of required) {
        if (!Object.hasOwn(value, key))
            errors.push(`${path}.${key}: required property is missing`)
    }

    for (const [key, child] of Object.entries(value)) {
        if (!isSafeProperty(key)) {
            errors.push(`${path}.${key}: unsafe property name`)

            continue
        }

        if (Object.hasOwn(properties, key))
            validateNode(
                properties[key],
                child,
                `${path}.${key}`,
                errors,
                depth + 1,
                rootSchema,
            )
        else if (schema.additionalProperties === false)
            errors.push(`${path}.${key}: additional property is not allowed`)
        else if (
            isRecord(schema.additionalProperties)
            || typeof schema.additionalProperties === 'boolean'
        )
            validateNode(
                schema.additionalProperties,
                child,
                `${path}.${key}`,
                errors,
                depth + 1,
                rootSchema,
            )
    }
}

function validateBranch(
    schema: unknown,
    value: unknown,
    depth: number,
    rootSchema: unknown,
): boolean {
    const errors: string[] = []
    validateNode(
        schema,
        value,
        '$',
        errors,
        depth,
        rootSchema,
    )

    return errors.length === 0
}

function resolveLocalReference(
    rootSchema: unknown,
    reference: string,
): unknown {
    if (reference === '#')
        return rootSchema

    if (!reference.startsWith('#/'))
        return undefined

    let cursor = rootSchema

    for (const encodedPart of reference.slice(2).split('/')) {
        const part = encodedPart.replace(/~1/g, '/').replace(/~0/g, '~')

        if (
            !isSafeProperty(part)
            || !isRecord(cursor)
            || !Object.hasOwn(cursor, part)
        )
            return undefined

        cursor = cursor[part]
    }

    return cursor
}

function matchesType(
    type: string,
    value: unknown,
): boolean {
    if (type === 'null')
        return value === null

    if (type === 'array')
        return Array.isArray(value)

    if (type === 'object')
        return isRecord(value)

    if (type === 'integer')
        return typeof value === 'number' && Number.isSafeInteger(value)

    if (type === 'number')
        return typeof value === 'number' && Number.isFinite(value)

    return typeof value === type
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSafeProperty(key: string): boolean {
    return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}

function deepEqual(
    left: unknown,
    right: unknown,
): boolean {
    return stableStringify(left) === stableStringify(right)
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`

    if (isRecord(value)) {
        const entries = Object.keys(value)
            .sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)

        return `{${entries.join(',')}}`
    }

    return JSON.stringify(value)
}
