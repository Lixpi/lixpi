#!/usr/bin/env bash
#
# The host side of the dev console, shared by every repository. A repository's run.sh
# calls it with its own root:
#
#   run-console.sh <repository-root>
#
# The Dockerized console reads that repository's console.config.json, shows the menu
# and returns a plan on stdout. Everything that touches the host happens here, after
# each field of that plan has been validated. Backing out of an action returns to the
# menu, and submitting one ends the console when it finishes unless its config sets
# returnToMenu.

set -euo pipefail

CONSOLE_PATH="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LIXPI_REPOSITORY_PATH="$(CDPATH= cd -- "${CONSOLE_PATH}/../.." && pwd -P)"
WORKSPACE_PATH="$(CDPATH= cd -- "${1:?Usage: run-console.sh <repository-root>}" && pwd -P)"
CONSOLE_COMPOSE=(docker compose -f "${LIXPI_REPOSITORY_PATH}/infrastructure/docker/docker-compose.dev-console.yml")
TERMINAL_STATE=""
CONSOLE_ENTRY=""
DOCKER_USAGE=""

cleanup() {
    if [[ -n "${TERMINAL_STATE}" ]]; then
        stty "${TERMINAL_STATE}" 2>/dev/null || true
        TERMINAL_STATE=""

        # Clack hides the cursor while a prompt is open, and a killed container
        # can't restore it.
        printf '\033[?25h' >&2
    fi
}

handle_signal() {
    trap - EXIT
    cleanup
    exit 130
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

read_plan() {
    local rows
    local columns

    read -r rows columns < <(stty size < /dev/tty)
    TERMINAL_STATE="$(stty -g)"

    # ISIG stays off so Ctrl+C reaches the prompt as a key and returns to the main
    # menu instead of killing the console.
    stty -icanon -echo -icrnl -isig min 1 time 0
    CONSOLE_PLAN="$("${CONSOLE_COMPOSE[@]}" --progress quiet run --rm --no-deps -i -T -e "LIXPI_TERMINAL_COLUMNS=${columns}" -e "LIXPI_TERMINAL_ROWS=${rows}" -e "LIXPI_CONSOLE_ENTRY=${CONSOLE_ENTRY}" -e "LIXPI_DOCKER_USAGE=${DOCKER_USAGE}" dev-console < /dev/tty)"
    cleanup
}

parse_plan() {
    ACTION=""
    ENTRY=""
    SCRIPT=""
    ENV_FILE=""
    RETURN_TO_MENU=""
    OPTIONS=()
    SELECTED=()

    while IFS='=' read -r plan_key plan_value; do
        case "${plan_key}" in
            ACTION)
                case "${plan_value}" in
                    exit|menu|measure-docker|run) ACTION="${plan_value}" ;;
                    *) fail "The console plan contains an unknown action." ;;
                esac
                ;;
            ENTRY)
                [[ "${plan_value}" =~ ^[a-z0-9-]+$ ]] || fail "The console plan contains an invalid entry."
                ENTRY="${plan_value}"
                ;;
            SCRIPT)
                [[ "${plan_value}" =~ ^(shared|local):[a-z0-9-]+$ ]] || fail "The console plan contains an invalid script."
                SCRIPT="${plan_value}"
                ;;
            ENV_FILE)
                [[ "${plan_value}" =~ ^(\.env(\.[A-Za-z0-9._-]+)?|env\.lixpi)$ && -f "${WORKSPACE_PATH}/${plan_value}" ]] || fail "The console plan contains an invalid environment file."
                ENV_FILE="${plan_value}"
                ;;
            RETURN_TO_MENU)
                [[ "${plan_value}" == "true" ]] || fail "The console plan contains an invalid menu setting."
                RETURN_TO_MENU="${plan_value}"
                ;;
            OPTION)
                [[ "${plan_value}" =~ ^[a-z0-9-]+=[A-Za-z0-9._/:,-]*$ ]] || fail "The console plan contains an invalid option."
                OPTIONS+=("${plan_value}")
                ;;
            SELECTED)
                [[ "${plan_value}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || fail "The console plan contains an invalid selection."
                SELECTED+=("${plan_value}")
                ;;
            '')
                ;;
            *)
                fail "The console plan contains an unknown field."
                ;;
        esac
    done <<< "${CONSOLE_PLAN}"

    [[ -n "${ACTION}" ]] || fail "The console plan does not contain an action."
}

script_path() {
    case "${SCRIPT}" in
        shared:*) printf '%s/actions/%s.sh\n' "${CONSOLE_PATH}" "${SCRIPT#shared:}" ;;
        local:*) printf '%s/dev-tools/dev-console/actions/%s.sh\n' "${WORKSPACE_PATH}" "${SCRIPT#local:}" ;;
    esac
}

# A subshell keeps each action's exported values from reaching the next one.
run_script() (
    local option
    local name

    export LIXPI_CONSOLE_WORKSPACE="${WORKSPACE_PATH}"

    if [[ -n "${ENV_FILE}" ]]; then
        export LIXPI_CONSOLE_ENV_FILE="${WORKSPACE_PATH}/${ENV_FILE}"
    fi

    for option in ${OPTIONS[@]+"${OPTIONS[@]}"}; do
        name="$(printf '%s' "${option%%=*}" | tr 'a-z-' 'A-Z_')"
        export "LIXPI_CONSOLE_OPTION_${name}=${option#*=}"
    done

    cd "${WORKSPACE_PATH}"
    exec bash "$1" ${SELECTED[@]+"${SELECTED[@]}"}
)

# Ctrl+C belongs to the running action, which stops it. Submitting an action ends the
# console with that action's status, unless the action asks to come back to the menu.
run_action() {
    local path
    local status=0

    path="$(script_path)"
    [[ -f "${path}" ]] || fail "The console config names a script that does not exist: ${SCRIPT}."

    trap ':' INT
    run_script "${path}" || status=$?
    trap handle_signal INT

    if [[ -z "${RETURN_TO_MENU}" ]]; then
        exit "${status}"
    fi

    if [[ "${status}" -ne 0 && "${status}" -ne 130 ]]; then
        printf '\nThat action stopped with exit status %s. Back to the main menu.\n\n' "${status}" >&2
    fi
}

trap cleanup EXIT
trap handle_signal INT TERM HUP

[[ -t 0 && -t 1 ]] || fail "Run this console in an interactive terminal."
[[ -f "${WORKSPACE_PATH}/dev-tools/dev-console/console.config.json" ]] || fail "This repository has no dev console config."

LOCAL_UID="$(id -u)"
LOCAL_GID="$(id -g)"
LIXPI_CONSOLE_WORKSPACE="${WORKSPACE_PATH}"
export LOCAL_UID LOCAL_GID LIXPI_REPOSITORY_PATH LIXPI_CONSOLE_WORKSPACE

echo "Preparing the console..."
"${CONSOLE_COMPOSE[@]}" --progress quiet build dev-console

while true; do
    read_plan
    parse_plan
    CONSOLE_ENTRY=""
    DOCKER_USAGE=""

    case "${ACTION}" in
        exit)
            exit 0
            ;;
        menu)
            ;;
        measure-docker)
            echo "Measuring Docker disk usage..."
            DOCKER_USAGE="$(docker system df --format '{{json .}}' 2>/dev/null || true)"
            CONSOLE_ENTRY="${ENTRY}"
            ;;
        run)
            run_action
            ;;
    esac
done
