<script>
    /**
     * @typedef {Object} Props
     * @property {any} checked
     * @property {string} [label]
     */

    /** @type {Props} */
    let { checked = $bindable(), label = 'Default checkbox label' } = $props();

    const checkboxId = `${label.replaceAll(' ', '-')}-checkbox`
</script>

<div>
    <input
        id={checkboxId}
        type="checkbox"
        bind:checked={checked}
    />
    <label for={checkboxId}>
        <span class="tick-mark"></span>
        {label}
    </label>
</div>

<style lang="scss"> //NOTE Shared SASS variables available globally
@import "$src/sass/_helpers";

$checkboxSize: 18px;
$checkboxPrimaryColor: $nightBlue;
$checkboxCheckedColor: $steelBlue;
$checkboxTickMarkColor: #fff;
$checkboxUncheckedColor: #fff;

input {
    position: absolute;
    opacity: 0;
    & + label {
        cursor: pointer;
        display: flex;
        align-items: center;
        @extend .noselect;

    }
    & + label .tick-mark {
        position: relative;
        display: inline-block;
        width: $checkboxSize;
        height: $checkboxSize;
        background: $checkboxUncheckedColor;
        border: 1px solid $checkboxPrimaryColor;
        margin-right: calc($checkboxSize / 4);
        border-radius: 3px;
        display: flex;
        align-items: center;
    }
    &:checked + label .tick-mark {
        background: $checkboxPrimaryColor;
    }
    // Checked tick mark
    &:checked + label .tick-mark:after {
        content: '';
        margin-left: calc($checkboxSize / 2 - 6px);
        background: $checkboxTickMarkColor;
        width: 2px;
        height: 2px;
        box-shadow:
            2px 0 0 $checkboxTickMarkColor,
            4px 0 0 $checkboxTickMarkColor,
            4px -2px 0 $checkboxTickMarkColor,
            4px -4px 0 $checkboxTickMarkColor,
            4px -6px 0 $checkboxTickMarkColor,
            4px -8px 0 $checkboxTickMarkColor;
        transform: rotate(45deg);
    }
}
</style>
