import { createCoreDocumentKindRegistry } from '@lixpi/prosemirror/shared/document-kinds'

// The documentation's own document kinds. Its fixtures render the core kinds
// only, and every schema they use comes from this registry's cache.
export const documentationDocumentKinds = createCoreDocumentKindRegistry()
