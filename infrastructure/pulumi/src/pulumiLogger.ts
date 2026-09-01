import * as pulumi from '@pulumi/pulumi'

// Sentinel prefixes so outputFormatter can color reliably without fuzzy content parsing
const PREFIX_PLAIN = '__PLPLAIN__'
const PREFIX_INFO = '__PLINFO__'
const PREFIX_WARN = '__PLWARN__'
const PREFIX_ERROR = '__PLERROR__'
const PREFIX_DEBUG = '__PLDEBUG__'

export const plPlain = (msg: string) => pulumi.log.info(PREFIX_PLAIN + msg)
export const plInfo = (msg: string) => pulumi.log.info(PREFIX_INFO + msg)
export const plWarn = (msg: string) => pulumi.log.warn(PREFIX_WARN + msg)
export const plError = (msg: string) => pulumi.log.error(PREFIX_ERROR + msg)
export const plDebug = (msg: string) => pulumi.log.info(PREFIX_DEBUG + msg) // Pulumi has no direct debug level

export const SENTINELS = {
    PREFIX_PLAIN,
    PREFIX_INFO,
    PREFIX_WARN,
    PREFIX_ERROR,
    PREFIX_DEBUG,
}
