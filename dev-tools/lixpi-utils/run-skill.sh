#!/bin/sh
# Universal entrypoint for lixpi-utils.
#
# Usage:
#   docker compose -f docker-compose.lixpi-utils.yml run --rm -T lixpi-utils \
#       <skill-name> <script> [args...]
#
# <skill-name> is a directory under skills/. <script> is a path relative to that
# skill's directory. Both are resolved and checked here so a typo fails with a
# readable message that lists what does exist, instead of a bare "not found".
#
# Dispatch is by file extension: .ts/.mjs/.js run under node, .sh under sh. Anything else is
# rejected rather than guessed at. Node 24 strips TypeScript types natively, so a .ts script runs
# with no tsconfig and no build step.

set -e

SKILLS_ROOT=/skills

usage() {
    echo "Usage: <skill-name> <script> [args...]" >&2
    echo "" >&2
    echo "Skills available:" >&2
    for dir in "$SKILLS_ROOT"/*/; do
        [ -d "$dir" ] && echo "  $(basename "$dir")" >&2
    done
}

if [ "$#" -lt 2 ]; then
    usage
    exit 1
fi

skill="$1"
script="$2"
shift 2

skill_dir="$SKILLS_ROOT/$skill"

if [ ! -d "$skill_dir" ]; then
    echo "No skill directory: skills/$skill" >&2
    usage
    exit 1
fi

script_path="$skill_dir/$script"

if [ ! -f "$script_path" ]; then
    echo "No script: skills/$skill/$script" >&2
    echo "" >&2
    echo "Scripts in skills/$skill:" >&2
    find "$skill_dir" -type f \( -name '*.ts' -o -name '*.mjs' -o -name '*.js' -o -name '*.sh' \) \
        | sed "s|$skill_dir/|  |" >&2
    exit 1
fi

# Run from the skill's own directory so relative paths in a script resolve
# against the skill, not against /skills.
cd "$skill_dir"

case "$script" in
    *.ts|*.mjs|*.js) exec node "$script_path" "$@" ;;
    *.sh)            exec sh "$script_path" "$@" ;;
    *)
        echo "Don't know how to run $script (expected .ts, .mjs, .js or .sh)" >&2
        exit 1
        ;;
esac
