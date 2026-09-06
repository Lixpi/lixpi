export const sliceTime = ({
    precision = 'seconds',
    modify,
}) => {
    const currentDate = new Date()
    let modifiedDate = new Date(currentDate)

    if (modify) {
        const {
            operation = 'subtract',
            amount = 10,
            unit = 'minutes',
        } = modify
        const value = parseInt(amount, 10)

        if (isNaN(value))
            throw new Error('Amount must be a valid number')

        const adjustDate = (
            date,
            unit,
            value,
        ) => {
            switch (unit) {
                case 'seconds':
                    date.setSeconds(date.getSeconds() + value)

                    break
                case 'minutes':
                    date.setMinutes(date.getMinutes() + value)

                    break
                case 'hours':
                    date.setHours(date.getHours() + value)

                    break
                case 'days':
                    date.setDate(date.getDate() + value)

                    break
                case 'months':
                    date.setMonth(date.getMonth() + value)

                    break
                case 'years':
                    date.setFullYear(date.getFullYear() + value)

                    break
                default:
                    throw new Error(`Unsupported unit: ${unit}`)
            }

            return date
        }

        const adjustedValue = operation === 'subtract' ? -value : value
        modifiedDate = adjustDate(
            modifiedDate,
            unit,
            adjustedValue,
        )
    }

    switch (precision) {
        case 'milliseconds':
            break
        case 'seconds':
            modifiedDate.setMilliseconds(0)

            break
        case 'minutes':
            modifiedDate.setSeconds(0, 0)

            break
        case 'hours':
            modifiedDate.setMinutes(
                0,
                0,
                0,
            )

            break
        case 'days':
            modifiedDate.setHours(
                0,
                0,
                0,
                0,
            )

            break
        default:
            throw new Error(`Unsupported precision: ${precision}`)
    }

    return modifiedDate.getTime()
}

// Example usage:
// console.log(sliceTime({ precision: 'days', modify: { operation: 'subtract', amount: 30, unit: 'days' } }));
// console.log(sliceTime({ precision: 'hours', modify: { operation: 'add', amount: 10, unit: 'hours' } }));
// console.log(sliceTime({ precision: 'seconds' })); // No modification, returns current time in seconds
