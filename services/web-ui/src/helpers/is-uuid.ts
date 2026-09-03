// Check if input string is a valid UUID
export const isUUID = (inputString: string): boolean => {
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/i
    return uuidPattern.test(inputString)
}
