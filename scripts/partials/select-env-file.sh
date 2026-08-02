# Shared ".env.* picker" used by start.sh, set-env.sh, and aws-sso-login.sh.
# Must be sourced, not executed: it defines lixpi_select_env_file() and leaves
# the chosen filename in $selected_env when that function returns 0.
#
#   source ./scripts/partials/select-env-file.sh
#   lixpi_select_env_file || exit 1
#   echo "$selected_env"

lixpi_select_env_file() {
    env_files=($(ls -1 .env.* 2>/dev/null))

    if [ ${#env_files[@]} -eq 0 ]; then
        echo "No .env files found in the current directory."
        echo "Run the setup wizard first to create one."
        selected_env=""
        return 1
    fi

    echo "Available environment files:"
    for i in "${!env_files[@]}"; do
        echo "  $((i+1)). ${env_files[$i]}"
    done
    echo ""

    while true; do
        read -p "Select environment file [1-${#env_files[@]}]: " selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#env_files[@]} ]; then
            break
        fi
        echo "Invalid selection. Please enter a number between 1 and ${#env_files[@]}."
    done

    selected_env="${env_files[$((selection-1))]}"
    return 0
}
