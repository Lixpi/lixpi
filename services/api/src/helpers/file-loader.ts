import path from 'path'
import { fileURLToPath } from 'url'
import { access } from 'fs/promises'
import { readFileSync } from 'fs'

// Helper function to determine if a file exists
const fileExists = async filePath => {
    try {
        await access(filePath)

        return true
    } catch {
        return false
    }
}

// Determines the project root path by checking for the existence of `package.json`
const findRootPath = async currentDir => {
    const hasPackageJson = await fileExists(
        path.join(currentDir, 'package.json'),
    )

    if (hasPackageJson)
        return currentDir

    const parentDir = path.dirname(currentDir)

    if (parentDir === currentDir)
        throw new Error('Reached file system root without finding package.json.')

    return findRootPath(parentDir)
}

// Recursively find root path
const getRootPath = async () => {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = path.dirname(currentFile)

    return findRootPath(currentDir)
}

// Asynchronous function to resolve paths relative to the project root
export const resolveFilePath = async filePath => {
    const root = await getRootPath()

    return path.resolve(root, filePath)
}

export const readFileSynchronously = (
    filePath,
    format = 'utf8',
) => readFileSync(filePath, format)
