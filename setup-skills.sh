#!/usr/bin/env bash
#
# Opens the Dockerized skill installer UI, then applies its selection on the host.

set -euo pipefail

LIXPI_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SKILLS_ROOT="${LIXPI_ROOT}/skills"
COMPOSE_FILE="${LIXPI_ROOT}/docker-compose.lixpi-utils.yml"

HARNESS_NAMES=(
    "Codex"
    "Claude Code"
    "Cursor"
    "GitHub Copilot"
)

PROJECT_HARNESS_SKILL_DIRS=(
    ".agents/skills"
    ".claude/skills"
    ".cursor/skills"
    ".github/skills"
)

GLOBAL_HARNESS_SKILL_DIRS=(
    "${HOME}/.agents/skills"
    "${HOME}/.claude/skills"
    "${HOME}/.cursor/skills"
    "${HOME}/.copilot/skills"
)

TERMINAL_STATE=""

cleanup() {
    if [[ -n "${TERMINAL_STATE}" ]]; then
        stty "${TERMINAL_STATE}" 2>/dev/null || true
        TERMINAL_STATE=""
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

resolve_repository() {
    local supplied_path="$1"
    local repository_root

    [[ -n "${supplied_path}" ]] || return 1
    [[ -d "${supplied_path}" ]] || return 1

    repository_root="$(git -C "${supplied_path}" rev-parse --show-toplevel 2>/dev/null)" \
        || return 1
    (CDPATH= cd -- "${repository_root}" && pwd -P)
}

relative_path_from() {
    local from_directory="$1"
    local destination="$2"
    local common_directory="${from_directory}"
    local upward_path=""
    local remaining_path

    while [[ "${destination}" != "${common_directory}" && "${destination}" != "${common_directory}/"* ]]; do
        [[ "${common_directory}" != "/" ]] || break
        common_directory="${common_directory%/*}"
        [[ -n "${common_directory}" ]] || common_directory="/"
        upward_path="../${upward_path}"
    done

    if [[ "${destination}" == "${common_directory}" ]]; then
        remaining_path=""
    elif [[ "${common_directory}" == "/" ]]; then
        remaining_path="${destination#/}"
    else
        remaining_path="${destination#"${common_directory}"/}"
    fi

    if [[ -n "${upward_path}${remaining_path}" ]]; then
        printf '%s%s\n' "${upward_path}" "${remaining_path}"
    else
        printf '.\n'
    fi
}

resolve_link_target() {
    local link_path="$1"
    local link_directory
    local link_value

    link_directory="$(dirname -- "${link_path}")"
    link_value="$(readlink "${link_path}")" || return 1
    (CDPATH= cd -- "${link_directory}" && CDPATH= cd -- "${link_value}" 2>/dev/null && pwd -P)
}

add_local_git_exclude() {
    local repository_root="$1"
    local repository_relative_path="$2"
    local exclude_file

    exclude_file="$(git -C "${repository_root}" rev-parse --git-path info/exclude)"
    if [[ "${exclude_file}" != /* ]]; then
        exclude_file="${repository_root}/${exclude_file}"
    fi

    mkdir -p "$(dirname -- "${exclude_file}")"
    touch "${exclude_file}"
    if ! grep -Fqx "/${repository_relative_path}" "${exclude_file}"; then
        printf '/%s\n' "${repository_relative_path}" >> "${exclude_file}"
    fi
}

harness_directory_for() {
    local harness_index="$1"

    if [[ "${INSTALL_SCOPE}" == "global" ]]; then
        printf '%s\n' "${GLOBAL_HARNESS_SKILL_DIRS[${harness_index}]}"
    else
        printf '%s/%s\n' "${PROJECT_ROOT}" "${PROJECT_HARNESS_SKILL_DIRS[${harness_index}]}"
    fi
}

trap cleanup EXIT
trap handle_signal INT TERM HUP

[[ "$#" -eq 0 ]] || fail "This installer is interactive and does not accept arguments."
[[ -t 0 && -t 1 ]] || fail "Run this installer in an interactive terminal."
[[ -d "${SKILLS_ROOT}" ]] || fail "No canonical skills directory exists at ${SKILLS_ROOT}."
[[ -f "${COMPOSE_FILE}" ]] || fail "Missing Docker Compose file: ${COMPOSE_FILE}."

docker compose -f "${COMPOSE_FILE}" build lixpi-utils
TERMINAL_STATE="$(stty -g)"
stty -icanon -echo min 1 time 0
SELECTION_PLAN="$(
    docker compose -f "${COMPOSE_FILE}" run --rm --no-deps -i -T \
        -e "LIXPI_HOST_ROOT=${LIXPI_ROOT}" \
        setup-skills < /dev/tty
)"
stty "${TERMINAL_STATE}"
TERMINAL_STATE=""

INSTALL_SCOPE=""
PROJECT_ROOT=""
SELECTED_HARNESS_INDICES=()
SELECTED_SKILL_DIRECTORIES=()

while IFS='=' read -r plan_key plan_value; do
    case "${plan_key}" in
        SCOPE)
            [[ -z "${INSTALL_SCOPE}" ]] || fail "The installation plan contains more than one scope."
            INSTALL_SCOPE="${plan_value}"
            ;;
        PROJECT_PATH)
            PROJECT_ROOT="${plan_value}"
            ;;
        HARNESS)
            case "${plan_value}" in
                0|1|2|3) SELECTED_HARNESS_INDICES+=("${plan_value}") ;;
                *) fail "The installation plan contains an unknown harness: ${plan_value}." ;;
            esac
            ;;
        SKILL)
            [[ "${plan_value}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] \
                || fail "The installation plan contains an invalid skill name: ${plan_value}."
            skill_directory="${SKILLS_ROOT}/${plan_value}"
            [[ -d "${skill_directory}" && -f "${skill_directory}/SKILL.md" ]] \
                || fail "The selected skill does not exist: ${plan_value}."
            SELECTED_SKILL_DIRECTORIES+=("$(CDPATH= cd -- "${skill_directory}" && pwd -P)")
            ;;
        '')
            ;;
        *)
            fail "The installation plan contains an unknown field: ${plan_key}."
            ;;
    esac
done <<< "${SELECTION_PLAN}"

case "${INSTALL_SCOPE}" in
    global)
        [[ -z "${PROJECT_ROOT}" ]] || fail "A global installation plan cannot contain a project path."
        ;;
    project)
        PROJECT_ROOT="$(resolve_repository "${PROJECT_ROOT}")" \
            || fail "The selected project path is not inside a Git repository."
        ;;
    *)
        fail "The installation plan does not contain a valid scope."
        ;;
esac

[[ "${#SELECTED_HARNESS_INDICES[@]}" -gt 0 ]] || fail "No harnesses were selected."
[[ "${#SELECTED_SKILL_DIRECTORIES[@]}" -gt 0 ]] || fail "No skills were selected."

HAS_CONFLICTS=0

for harness_index in "${SELECTED_HARNESS_INDICES[@]}"; do
    harness_directory="$(harness_directory_for "${harness_index}")"
    if [[ -e "${harness_directory}" && ! -d "${harness_directory}" ]]; then
        printf 'Conflict: %s is not a directory.\n' "${harness_directory}" >&2
        HAS_CONFLICTS=1
        continue
    fi

    for skill_directory in "${SELECTED_SKILL_DIRECTORIES[@]}"; do
        skill_name="${skill_directory##*/}"
        link_path="${harness_directory}/${skill_name}"

        if [[ -e "${link_path}" || -L "${link_path}" ]]; then
            resolved_target=""
            if [[ -L "${link_path}" ]] && resolved_target="$(resolve_link_target "${link_path}")" \
                && [[ "${resolved_target}" == "${skill_directory}" ]]; then
                continue
            fi

            printf 'Conflict: %s already exists and does not point to %s.\n' "${link_path}" "${skill_directory}" >&2
            HAS_CONFLICTS=1
        fi
    done
done

[[ "${HAS_CONFLICTS}" -eq 0 ]] \
    || fail "No files were changed. Resolve the conflicts above and run the setup again."

CREATED_LINKS=0
EXISTING_LINKS=0

for harness_index in "${SELECTED_HARNESS_INDICES[@]}"; do
    harness_directory="$(harness_directory_for "${harness_index}")"
    mkdir -p "${harness_directory}"
    physical_harness_directory="$(CDPATH= cd -- "${harness_directory}" && pwd -P)"

    for skill_directory in "${SELECTED_SKILL_DIRECTORIES[@]}"; do
        skill_name="${skill_directory##*/}"
        link_path="${harness_directory}/${skill_name}"

        if [[ -L "${link_path}" ]]; then
            EXISTING_LINKS=$((EXISTING_LINKS + 1))
        else
            relative_skill_path="$(relative_path_from "${physical_harness_directory}" "${skill_directory}")"
            ln -s "${relative_skill_path}" "${link_path}"
            CREATED_LINKS=$((CREATED_LINKS + 1))
        fi

        if [[ "${INSTALL_SCOPE}" == "project" ]]; then
            repository_relative_link="${PROJECT_HARNESS_SKILL_DIRS[${harness_index}]}/${skill_name}"
            add_local_git_exclude "${PROJECT_ROOT}" "${repository_relative_link}"
        fi
    done
done

if [[ "${INSTALL_SCOPE}" == "global" ]]; then
    scope_description="global harness directories"
else
    scope_description="${PROJECT_ROOT}"
fi

printf 'Installed %s skill links and kept %s existing links for %s skills across %s harnesses in %s.\n' \
    "${CREATED_LINKS}" \
    "${EXISTING_LINKS}" \
    "${#SELECTED_SKILL_DIRECTORIES[@]}" \
    "${#SELECTED_HARNESS_INDICES[@]}" \
    "${scope_description}"
