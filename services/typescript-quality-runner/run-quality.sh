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

is_action() {
    case "$1" in
        check|fix|lint|lint-fix|format|format-check) return 0 ;;
        *) return 1 ;;
    esac
}

run_action() {
    action="$1"
    shift

    case "$action" in
        check)
            "$dprint_bin" check --config "$dprint_config" "$@"
            "$oxlint_bin" --config "$oxlint_config" --deny-warnings "$@"
            node "$import_order_checker" check "$@"
            ;;
        fix)
            "$dprint_bin" fmt --config "$dprint_config" "$@"
            "$oxlint_bin" --config "$oxlint_config" --fix --deny-warnings "$@"
            node "$import_order_checker" fix "$@"
            ;;
        lint)
            "$oxlint_bin" --config "$oxlint_config" --deny-warnings "$@"
            node "$import_order_checker" check "$@"
            ;;
        lint-fix)
            "$oxlint_bin" --config "$oxlint_config" --fix --deny-warnings "$@"
            node "$import_order_checker" fix "$@"
            ;;
        format)
            "$dprint_bin" fmt --config "$dprint_config" "$@"
            node "$import_order_checker" fix "$@"
            ;;
        format-check)
            "$dprint_bin" check --config "$dprint_config" "$@"
            node "$import_order_checker" check "$@"
            ;;
        *)
            echo "Unknown action: $action" >&2
            exit 1
            ;;
    esac
}

run_shared() {
    package_filter=""
    action="check"

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
    action="${2:-check}"

    case "$domain" in
        web-ui)
            run_action "$action" services/web-ui/src services/web-ui/vite.config.ts services/web-ui/vitest.config.ts
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
            run_action "$action" documentation/site/source-registry.test.ts
            ;;
        infrastructure)
            run_action "$action" infrastructure/init-script/setup-env.ts infrastructure/pulumi/src
            ;;
        random-useful-things)
            run_action "$action" random-useful-things
            ;;
        *)
            echo "Unknown domain: $domain" >&2
            exit 1
            ;;
    esac
}

run_all() {
    action="${1:-check}"
    run_action "$action" \
        services/web-ui/src \
        services/web-ui/vite.config.ts \
        services/web-ui/vitest.config.ts \
        services/api/src \
        services/api/vitest.config.ts \
        services/nex/workloads \
        services/nex/vitest.config.ts \
        services/ai-model-registry/src \
        services/ai-model-registry/vite.config.ts \
        documentation/site/source-registry.test.ts \
        infrastructure/init-script/setup-env.ts \
        infrastructure/pulumi/src \
        random-useful-things \
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
        packages/lixpi/ui-kit \
        packages/lixpi/ui-primitives
}

cd "$repository_dir"

domain="${1:-}"
if [ -z "$domain" ]; then
    echo "Usage: run-quality.sh {web-ui|api|nex|ai-model-registry|docs-site|infrastructure|random-useful-things|shared|all|self-test} [package] [check|fix|lint|lint-fix|format|format-check]" >&2
    exit 1
fi
shift

case "$domain" in
    shared)
        run_shared "$@"
        ;;
    all)
        run_all "${1:-check}"
        ;;
    self-test)
        sh "$runner_dir/test-quality.sh"
        ;;
    web-ui|api|nex|ai-model-registry|docs-site|infrastructure|random-useful-things)
        run_domain "$domain" "${1:-check}"
        ;;
    *)
        echo "Unknown domain: $domain" >&2
        exit 1
        ;;
esac
