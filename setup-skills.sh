#!/usr/bin/env bash
#
# Installs this repository's canonical skills for agent discovery.
#
# Run without arguments in an interactive terminal:
#   ./setup-skills.sh
#
# The installer asks for the installation scope, target harnesses, and skills.
# Generated discovery links are local configuration and are not tracked by this
# repository. Windows needs Developer Mode or an elevated shell to create
# symbolic links.

set -euo pipefail

LIXPI_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SKILLS_ROOT="${LIXPI_ROOT}/skills"

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

CHECKBOX_RESULT_INDICES=()
CURSOR_HIDDEN=0

hide_cursor() {
    if [[ "${CURSOR_HIDDEN}" -eq 0 ]]; then
        printf '\033[?25l'
        CURSOR_HIDDEN=1
    fi
}

restore_cursor() {
    if [[ "${CURSOR_HIDDEN}" -eq 1 ]]; then
        printf '\033[?25h'
        CURSOR_HIDDEN=0
    fi
}

fail() {
    restore_cursor
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

handle_interrupt() {
    restore_cursor
    printf '\nInstallation cancelled.\n' >&2
    exit 130
}

trap restore_cursor EXIT
trap handle_interrupt INT TERM

resolve_repository() {
    local supplied_path="$1"
    local repository_root

    [[ -n "${supplied_path}" ]] || fail "No repository path was provided."
    [[ -d "${supplied_path}" ]] || fail "Not a directory: ${supplied_path}"

    repository_root="$(git -C "${supplied_path}" rev-parse --show-toplevel 2>/dev/null)" \
        || fail "Not inside a Git repository: ${supplied_path}"
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

checkbox_menu() {
    local title="$1"
    local has_all_option="$2"
    shift 2

    local options=("$@")
    local selected=()
    local option_count="${#options[@]}"
    local current_index=0
    local line_count=$((option_count + 3))
    local message=""
    local key
    local key_rest
    local index
    local selected_count
    local all_selected
    local next_value

    CHECKBOX_RESULT_INDICES=()

    index=0
    while [[ "${index}" -lt "${option_count}" ]]; do
        selected+=(0)
        index=$((index + 1))
    done

    hide_cursor

    while true; do
        printf '%s\n' "${title}"
        printf 'Use Up/Down to move, Space to toggle, and Enter to continue.\n'

        index=0
        while [[ "${index}" -lt "${option_count}" ]]; do
            if [[ "${index}" -eq "${current_index}" ]]; then
                printf '> '
            else
                printf '  '
            fi

            if [[ "${selected[${index}]}" -eq 1 ]]; then
                printf '[x] %s\n' "${options[${index}]}"
            else
                printf '[ ] %s\n' "${options[${index}]}"
            fi
            index=$((index + 1))
        done

        printf '%s\n' "${message:- }"
        message=""

        key=""
        IFS= read -rsn1 key || fail "Unable to read an interactive selection."
        if [[ "${key}" == $'\033' ]]; then
            key_rest=""
            IFS= read -rsn2 key_rest || true
            key="${key}${key_rest}"
        fi

        printf '\033[%sA\033[J' "${line_count}"

        case "${key}" in
            $'\033[A'|k)
                if [[ "${current_index}" -eq 0 ]]; then
                    current_index=$((option_count - 1))
                else
                    current_index=$((current_index - 1))
                fi
                ;;
            $'\033[B'|j)
                current_index=$(((current_index + 1) % option_count))
                ;;
            ' ')
                if [[ "${has_all_option}" -eq 1 && "${current_index}" -eq 0 ]]; then
                    if [[ "${selected[0]}" -eq 1 ]]; then
                        next_value=0
                    else
                        next_value=1
                    fi

                    index=0
                    while [[ "${index}" -lt "${option_count}" ]]; do
                        selected[${index}]="${next_value}"
                        index=$((index + 1))
                    done
                else
                    if [[ "${selected[${current_index}]}" -eq 1 ]]; then
                        selected[${current_index}]=0
                    else
                        selected[${current_index}]=1
                    fi

                    if [[ "${has_all_option}" -eq 1 ]]; then
                        all_selected=1
                        index=1
                        while [[ "${index}" -lt "${option_count}" ]]; do
                            if [[ "${selected[${index}]}" -ne 1 ]]; then
                                all_selected=0
                                break
                            fi
                            index=$((index + 1))
                        done
                        selected[0]="${all_selected}"
                    fi
                fi
                ;;
            '')
                selected_count=0
                index=0
                while [[ "${index}" -lt "${option_count}" ]]; do
                    if [[ "${selected[${index}]}" -eq 1 ]]; then
                        CHECKBOX_RESULT_INDICES+=("${index}")
                        selected_count=$((selected_count + 1))
                    fi
                    index=$((index + 1))
                done

                if [[ "${selected_count}" -gt 0 ]]; then
                    restore_cursor
                    return 0
                fi

                CHECKBOX_RESULT_INDICES=()
                message="Select at least one option."
                ;;
        esac
    done
}

harness_directory_for() {
    local harness_index="$1"

    if [[ "${INSTALL_SCOPE}" == "global" ]]; then
        printf '%s\n' "${GLOBAL_HARNESS_SKILL_DIRS[${harness_index}]}"
    else
        printf '%s/%s\n' "${PROJECT_ROOT}" "${PROJECT_HARNESS_SKILL_DIRS[${harness_index}]}"
    fi
}

[[ "$#" -eq 0 ]] || fail "This installer is interactive and does not accept arguments."
[[ -t 0 && -t 1 ]] || fail "Run this installer in an interactive terminal."
[[ -d "${SKILLS_ROOT}" ]] || fail "No canonical skills directory exists at ${SKILLS_ROOT}."

SKILL_DIRECTORIES=()
SKILL_NAMES=()
while IFS= read -r skill_directory; do
    [[ -f "${skill_directory}/SKILL.md" ]] || fail "Skill directory has no SKILL.md: ${skill_directory}"
    SKILL_DIRECTORIES+=("$(CDPATH= cd -- "${skill_directory}" && pwd -P)")
    SKILL_NAMES+=("${skill_directory##*/}")
done < <(find "${SKILLS_ROOT}" -mindepth 1 -maxdepth 1 -type d -print | LC_ALL=C sort)

[[ "${#SKILL_DIRECTORIES[@]}" -gt 0 ]] || fail "No skills were found under ${SKILLS_ROOT}."

INSTALL_SCOPE=""
while [[ -z "${INSTALL_SCOPE}" ]]; do
    printf 'Install skills globally or for a specific project? [G/p] (default: global): '
    scope_answer=""
    IFS= read -r scope_answer || fail "Unable to read the installation scope."

    case "${scope_answer}" in
        ''|g|G|global|Global|GLOBAL)
            INSTALL_SCOPE="global"
            ;;
        p|P|project|Project|PROJECT)
            INSTALL_SCOPE="project"
            ;;
        *)
            printf 'Enter G for global or P for a specific project.\n'
            ;;
    esac
done

PROJECT_ROOT=""
if [[ "${INSTALL_SCOPE}" == "project" ]]; then
    printf 'Project path [%s]: ' "${LIXPI_ROOT}"
    project_path=""
    IFS= read -r project_path || fail "Unable to read the project path."
    [[ -n "${project_path}" ]] || project_path="${LIXPI_ROOT}"
    PROJECT_ROOT="$(resolve_repository "${project_path}")"
fi

checkbox_menu "Select harnesses" 0 "${HARNESS_NAMES[@]}"
SELECTED_HARNESS_INDICES=("${CHECKBOX_RESULT_INDICES[@]}")

SKILL_OPTIONS=("All skills")
for skill_name in "${SKILL_NAMES[@]}"; do
    SKILL_OPTIONS+=("${skill_name}")
done

checkbox_menu "Select all skills or choose individual skills" 1 "${SKILL_OPTIONS[@]}"
SELECTED_SKILL_DIRECTORIES=()
for selected_index in "${CHECKBOX_RESULT_INDICES[@]}"; do
    if [[ "${selected_index}" -gt 0 ]]; then
        SELECTED_SKILL_DIRECTORIES+=("${SKILL_DIRECTORIES[$((selected_index - 1))]}")
    fi
done

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

[[ "${HAS_CONFLICTS}" -eq 0 ]] || fail "No files were changed. Resolve the conflicts above and run the setup again."

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
