import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
    SCHEMA_FILE,
    type BaseSchema,
    type LixpiModelRecord,
    type SchemaField,
} from './types.ts'

// base-schema.json says which fields every model carries and who owns each one.
// The merge uses it to know what to demand and what to leave to a source, and the
// fetch uses it to scaffold a -lixpi.json for a model nobody has authored yet.
export class CatalogSchema {
    private constructor(private readonly schema: BaseSchema) {}

    static async load(rootDir: string): Promise<CatalogSchema> {
        const raw = await readFile(
            join(rootDir, SCHEMA_FILE),
            'utf8',
        )

        return new CatalogSchema(JSON.parse(raw) as BaseSchema)
    }

    get version(): number {
        return this.schema.schemaVersion
    }

    requiredFields(): Record<string, SchemaField> {
        return this.schema.requiredForEveryModel
    }

    // Conditional groups keyed by modality, so an image-generation model is asked for
    // its reference capabilities and a text model is not.
    fieldsForModalities(modalities: string[]): Record<string, SchemaField> {
        const fields: Record<string, SchemaField> = { ...this.schema.requiredForEveryModel }

        for (const modality of modalities) {
            for (const [name, field] of Object.entries(this.schema.requiredForModelsWithModality[modality] ?? {}))
                fields[name] = field
        }

        return fields
    }

    ownerOf(field: string): SchemaField | null {
        if (this.schema.requiredForEveryModel[field])
            return this.schema.requiredForEveryModel[field]

        if (this.schema.optionalFields[field])
            return this.schema.optionalFields[field]

        for (const group of Object.values(this.schema.requiredForModelsWithModality)) {
            if (group[field])
                return group[field]
        }

        return null
    }

    // A model discovered on a provider but never authored gets this: every
    // Lixpi-owned required field present and empty, so a human can see exactly what
    // is missing and fill it in. Source-owned fields are absent, because the sources
    // supply them and repeating them here is the duplication this layout removes.
    scaffoldLixpiRecord(inheritedFields: string[]): LixpiModelRecord {
        const scaffold: Record<string, unknown> = {}
        const inherited = new Set(inheritedFields)

        for (const [name, field] of Object.entries(this.schema.requiredForEveryModel)) {
            // Derived fields come from the tree, and fields the provider's _base.json
            // supplies are inherited. A scaffold shows only what still needs a
            // decision.
            if (field.ownedBy !== 'lixpi')
                continue

            if (inherited.has(name))
                continue

            // A field with a standing default needs no placeholder; the merge fills
            // it. Emitting one would put a value in the file that nobody decided.
            if (field.defaultWhenNoSourceHasIt !== undefined)
                continue

            // Schema names are paths, so `pricing.currency` is a field inside
            // `pricing`, not a key with a dot in it.
            const segments = name.split('.')
            let cursor = scaffold

            for (const segment of segments.slice(0, -1)) {
                if (
                    typeof cursor[segment] !== 'object'
                    || cursor[segment] === null
                )
                    cursor[segment] = {}

                cursor = cursor[segment] as Record<string, unknown>
            }

            cursor[segments.at(-1)!] = field.valueType === 'array'
                ? []
                : field.valueType === 'object'
                    ? {}
                    : field.valueType === 'number'
                        ? null
                        : ''
        }

        return scaffold as LixpiModelRecord
    }
}
