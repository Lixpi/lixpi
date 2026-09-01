#!/bin/sh

set -eu

repository_dir="/usr/src/repository"
tool_dir="/usr/src/quality-runner"
runner_dir="$repository_dir/services/typescript-quality-runner"
dprint_bin="$tool_dir/node_modules/.bin/dprint"
oxlint_bin="$tool_dir/node_modules/.bin/oxlint"
import_order_checker="$runner_dir/import-specifier-order.mjs"
dprint_config="$repository_dir/dprint.json"
oxlint_config="$repository_dir/.oxlintrc.json"
fixture_dir="$runner_dir/fixtures"
temporary_dir=$(mktemp -d)

cleanup() {
    rm -rf "$temporary_dir"
}
trap cleanup EXIT

cp "$fixture_dir/import-layout-input.txt" "$temporary_dir/import-layout.ts"
if "$dprint_bin" check --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null 2>&1 \
    && node "$import_order_checker" check "$temporary_dir/import-layout.ts" >/dev/null 2>&1; then
    echo "Expected the composite formatter to reject the invalid import fixture" >&2
    exit 1
fi

"$dprint_bin" fmt --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null
node "$import_order_checker" fix "$temporary_dir/import-layout.ts" >/dev/null
if ! cmp -s "$fixture_dir/import-layout-expected.txt" "$temporary_dir/import-layout.ts"; then
    echo "dprint did not produce the expected multiline import layout" >&2
    diff -u "$fixture_dir/import-layout-expected.txt" "$temporary_dir/import-layout.ts" >&2 || true
    exit 1
fi

"$dprint_bin" check --config "$dprint_config" "$temporary_dir/import-layout.ts" >/dev/null
node "$import_order_checker" check "$temporary_dir/import-layout.ts" >/dev/null

cp "$fixture_dir/lint-invalid.txt" "$temporary_dir/lint-invalid.ts"
if "$oxlint_bin" --config "$oxlint_config" "$temporary_dir/lint-invalid.ts" >/dev/null 2>&1; then
    echo "Expected Oxlint to reject the invalid lint fixture" >&2
    exit 1
fi

cp "$fixture_dir/lint-valid.txt" "$temporary_dir/lint-valid.ts"
"$oxlint_bin" --config "$oxlint_config" "$temporary_dir/lint-valid.ts" >/dev/null

cp "$fixture_dir/type-import-invalid.txt" "$temporary_dir/type-import-invalid.ts"
if "$oxlint_bin" --config "$oxlint_config" "$temporary_dir/type-import-invalid.ts" >/dev/null 2>&1; then
    echo "Expected Oxlint to reject a top-level type import" >&2
    exit 1
fi

cp "$fixture_dir/type-import-valid.txt" "$temporary_dir/type-import-valid.ts"
"$oxlint_bin" --config "$oxlint_config" "$temporary_dir/type-import-valid.ts" >/dev/null

cp "$fixture_dir/type-import-order-invalid.txt" "$temporary_dir/type-import-order.ts"
if node "$import_order_checker" check "$temporary_dir/type-import-order.ts" >/dev/null 2>&1; then
    echo "Expected the import-order checker to reject interleaved type imports" >&2
    exit 1
fi

node "$import_order_checker" fix "$temporary_dir/type-import-order.ts" >/dev/null
if ! cmp -s "$fixture_dir/type-import-order-valid.txt" "$temporary_dir/type-import-order.ts"; then
    echo "Import-order fix did not place type imports last" >&2
    diff -u "$fixture_dir/type-import-order-valid.txt" "$temporary_dir/type-import-order.ts" >&2 || true
    exit 1
fi
node "$import_order_checker" check "$temporary_dir/type-import-order.ts" >/dev/null

touch "$temporary_dir/react-component.tsx"
if node "$import_order_checker" check "$temporary_dir" >/dev/null 2>&1; then
    echo "Expected the quality runner to reject a .tsx file" >&2
    exit 1
fi
rm "$temporary_dir/react-component.tsx"

touch "$temporary_dir/react-component.jsx"
if node "$import_order_checker" check "$temporary_dir" >/dev/null 2>&1; then
    echo "Expected the quality runner to reject a .jsx file" >&2
    exit 1
fi

cp "$fixture_dir/react-import-invalid.txt" "$temporary_dir/react-import-invalid.ts"
if "$oxlint_bin" --config "$oxlint_config" "$temporary_dir/react-import-invalid.ts" >/dev/null 2>&1; then
    echo "Expected Oxlint to reject a React import" >&2
    exit 1
fi

echo "TypeScript quality runner self-test passed"
