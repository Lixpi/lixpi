// Helpers for tests that assert on the text of a source file.
//
// Those assertions pin down what the code does, not how the formatter chose to lay it
// out. Line breaks and trailing commas belong to the formatter and change nothing about
// behavior, so comparing raw text makes a test fail every time a line wraps somewhere
// new. Normalize both sides and compare on tokens alone.
export const withoutLayout = (value: string): string =>
    value
        .replace(/\s+/g, '')
        .replace(/,(?=[)\]}])/g, '')
        .replace(/,$/, '')
