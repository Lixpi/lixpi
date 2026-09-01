#!/bin/sh

set -eu

repository_dir="/usr/src/repository"
tool_dir="$repository_dir/services/typescript-quality-runner"
dprint_bin="$tool_dir/node_modules/.bin/dprint"
oxlint_bin="$tool_dir/node_modules/.bin/oxlint"
dprint_config="$repository_dir/dprint.json"
oxlint_config="$repository_dir/.oxlintrc.json"
fixture_dir="$tool_dir/fixtures"
temporary_dir=$(mktemp -d "$tool_dir/.quality-test.XXXXXX")

cleanup() {
    rm -rf "$temporary_dir"
}
trap cleanup EXIT

cp "$fixture_dir/import-layout-input.txt" "$temporary_dir/import-layout.ts"
if "$dprint_bin" check --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null 2>&1; then
    echo "Expected dprint to reject the invalid import fixture" >&2
    exit 1
fi

"$dprint_bin" fmt --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null
if ! cmp -s "$fixture_dir/import-layout-expected.txt" "$temporary_dir/import-layout.ts"; then
    echo "dprint did not produce the expected multiline import layout" >&2
    diff -u "$fixture_dir/import-layout-expected.txt" "$temporary_dir/import-layout.ts" >&2 || true
    exit 1
fi

"$dprint_bin" check --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null

cp "$fixture_dir/lint-invalid.txt" "$temporary_dir/lint-invalid.ts"
if "$oxlint_bin" --config "$oxlint_config" "$temporary_dir/lint-invalid.ts" >/dev/null 2>&1; then
    echo "Expected Oxlint to reject the invalid lint fixture" >&2
    exit 1
fi

cp "$fixture_dir/lint-valid.txt" "$temporary_dir/lint-valid.ts"
"$oxlint_bin" --config "$oxlint_config" "$temporary_dir/lint-valid.ts" >/dev/null

echo "TypeScript quality runner self-test passed"

