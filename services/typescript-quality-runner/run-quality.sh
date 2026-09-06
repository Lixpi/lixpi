#!/bin/sh

set -eu

repository_dir="/usr/src/repository"
tool_dir="/usr/src/quality-runner"
runner_dir="$tool_dir"
dprint_bin="$tool_dir/node_modules/.bin/dprint"
oxlint_bin="$tool_dir/node_modules/.bin/oxlint"
source_extension_runner="$tool_dir/source-extension-runner.ts"
typescript_format_runner="$tool_dir/typescript-format-runner.ts"
stylelint_runner="$tool_dir/stylelint-runner.ts"
dprint_config="$tool_dir/dprint.json"
oxlint_config="$repository_dir/.oxlintrc.json"

cd "$tool_dir"
pnpm install --store-dir /pnpm-store --no-lockfile

is_action() {
    case "$1" in
        validate|fix|lint|lint-fix|format|validate-formatting) return 0 ;;
        *) return 1 ;;
    esac
}

# Warnings do not fail a run. `lixpi/no-nested-ternary` is reported as a warning so it
# names the code to rewrite without blocking the build, and `--deny-warnings` would turn
# it straight back into an error.
# Checksum of every file a fix round can touch, so a round that changes nothing ends the
# loop instead of burning the remaining attempts on findings no fixer can resolve.
source_fingerprint() {
    find "$@" -type f -exec cksum {} + 2>/dev/null | sort | cksum
}

run_oxlint_fixes() {
    attempt=1
    while [ "$attempt" -le 5 ]; do
        fingerprint=$(source_fingerprint "$@")
        "$oxlint_bin" --config "$oxlint_config" --no-error-on-unmatched-pattern --threads=1 --fix --silent "$@" || true
        node "$typescript_format_runner" fix "$@"
        if "$oxlint_bin" --config "$oxlint_config" --no-error-on-unmatched-pattern --silent "$@" \
            && node "$typescript_format_runner" check "$@"; then
            return 0
        fi

        if [ "$(source_fingerprint "$@")" = "$fingerprint" ]; then
            break
        fi

        attempt=$((attempt + 1))
    done

    "$oxlint_bin" --config "$oxlint_config" --no-error-on-unmatched-pattern "$@"
    node "$typescript_format_runner" check "$@"
}

run_action() {
    action="$1"
    shift

    case "$action" in
        validate)
            node "$source_extension_runner" check "$@"
            node "$typescript_format_runner" check "$@"
            "$dprint_bin" check --allow-no-files --config "$dprint_config" "$@"
            "$oxlint_bin" --config "$oxlint_config" --no-error-on-unmatched-pattern "$@"
            node "$stylelint_runner" check "$@"
            ;;
        fix)
            node "$source_extension_runner" fix "$@"
            run_oxlint_fixes "$@"
            "$dprint_bin" fmt --allow-no-files --config "$dprint_config" "$@"
            node "$stylelint_runner" fix "$@"
            ;;
        lint)
            node "$source_extension_runner" check "$@"
            "$oxlint_bin" --config "$oxlint_config" --no-error-on-unmatched-pattern "$@"
            node "$stylelint_runner" check "$@"
            ;;
        lint-fix)
            node "$source_extension_runner" fix "$@"
            run_oxlint_fixes "$@"
            node "$stylelint_runner" fix "$@"
            ;;
        format)
            node "$source_extension_runner" fix "$@"
            node "$typescript_format_runner" fix "$@"
            "$dprint_bin" fmt --allow-no-files --config "$dprint_config" "$@"
            ;;
        validate-formatting)
            node "$source_extension_runner" check "$@"
            node "$typescript_format_runner" check "$@"
            "$dprint_bin" check --allow-no-files --config "$dprint_config" "$@"
            ;;
        *)
            echo "Unknown action: $action" >&2
            exit 1
            ;;
    esac
}

run_shared() {
    package_filter=""
    action="validate"

    if [ "$#" -gt 0 ] && is_action "$1"; then
        action="$1"
        shift
    elif [ "$#" -gt 0 ]; then
        package_filter="$1"
        shift
        if [ "$#" -gt 0 ]; then
            action="$1"
            shift
        fi
    fi

    if [ "$#" -gt 0 ]; then
        echo "Unexpected shared arguments: $*" >&2
        exit 1
    fi

    selected_paths=""
    for package_path in \
        auth-service \
        capability-system \
        canvas-engine \
        canvas-components \
        canvas-components-lixpi-specific \
        constants/ts \
        debug-tools/ts \
        dynamodb-service \
        nats-auth-callout-service \
        nats-service/ts \
        prosemirror \
        test-utils \
        ui-kit \
        ui-primitives
    do
        package_name=${package_path%%/*}
        if [ -n "$package_filter" ] && [ "$package_filter" != "$package_name" ] && [ "$package_filter" != "$package_path" ]; then
            continue
        fi
        selected_paths="$selected_paths packages/lixpi/$package_path"
    done

    if [ -z "$selected_paths" ]; then
        echo "No shared package matches: $package_filter" >&2
        exit 1
    fi

    run_action "$action" $selected_paths
}

run_domain() {
    domain="$1"
    action="${2:-validate}"

    case "$domain" in
        web-ui)
            run_action "$action" services/web-ui/index.html services/web-ui/src services/web-ui/vite.config.ts services/web-ui/vitest.config.ts
            ;;
        api)
            run_action "$action" services/api/src services/api/vitest.config.ts
            ;;
        nex)
            run_action "$action" services/nex/workloads services/nex/vitest.config.ts
            ;;
        ai-model-registry)
            run_action "$action" services/ai-model-registry/src services/ai-model-registry/vite.config.ts
            ;;
        docs-site)
            run_action "$action" documentation/site/assets
            ;;
        infrastructure)
            run_action "$action" infrastructure/init-script/setup-env.ts infrastructure/pulumi/src
            ;;
        random-useful-things)
            run_action "$action" random-useful-things
            ;;
        quality-runner)
            run_action "$action" \
                "$tool_dir/import-specifier-order.ts" \
                "$tool_dir/lixpi-oxlint-plugin.ts" \
                "$tool_dir/source-extension-runner.ts" \
                "$tool_dir/stylelint.config.ts" \
                "$tool_dir/stylelint-lixpi-plugin.ts" \
                "$tool_dir/stylelint-runner.ts" \
                "$tool_dir/typescript-format-runner.ts"
            ;;
        *)
            echo "Unknown domain: $domain" >&2
            exit 1
            ;;
    esac
}

run_all() {
    action="${1:-validate}"
    run_action "$action" \
        services/web-ui/src \
        services/web-ui/index.html \
        services/web-ui/vite.config.ts \
        services/web-ui/vitest.config.ts \
        services/api/src \
        services/api/vitest.config.ts \
        services/nex/workloads \
        services/nex/vitest.config.ts \
        services/ai-model-registry/src \
        services/ai-model-registry/vite.config.ts \
        documentation/site/assets \
        infrastructure/init-script/setup-env.ts \
        infrastructure/pulumi/src \
        random-useful-things \
        "$tool_dir/import-specifier-order.ts" \
        "$tool_dir/lixpi-oxlint-plugin.ts" \
        "$tool_dir/source-extension-runner.ts" \
        "$tool_dir/stylelint.config.ts" \
        "$tool_dir/stylelint-lixpi-plugin.ts" \
        "$tool_dir/stylelint-runner.ts" \
        "$tool_dir/typescript-format-runner.ts" \
        packages/lixpi/auth-service \
        packages/lixpi/capability-system \
        packages/lixpi/canvas-engine \
        packages/lixpi/canvas-components \
        packages/lixpi/canvas-components-lixpi-specific \
        packages/lixpi/constants/ts \
        packages/lixpi/debug-tools/ts \
        packages/lixpi/dynamodb-service \
        packages/lixpi/nats-auth-callout-service \
        packages/lixpi/nats-service/ts \
        packages/lixpi/prosemirror \
        packages/lixpi/test-utils \
        packages/lixpi/ui-kit \
        packages/lixpi/ui-primitives
}

cd "$repository_dir"

domain="${1:-}"
if [ -z "$domain" ]; then
    echo "Usage: run-quality.sh {web-ui|api|nex|ai-model-registry|docs-site|infrastructure|random-useful-things|quality-runner|shared|all|self-test} [package] [validate|fix|lint|lint-fix|format|validate-formatting]" >&2
    exit 1
fi
shift

case "$domain" in
    shared)
        run_shared "$@"
        ;;
    all)
        run_all "${1:-validate}"
        ;;
    self-test)
        sh "$runner_dir/test-quality.sh"
        ;;
    web-ui|api|nex|ai-model-registry|docs-site|infrastructure|random-useful-things|quality-runner)
        run_domain "$domain" "${1:-validate}"
        ;;
    *)
        echo "Unknown domain: $domain" >&2
        exit 1
        ;;
esac
