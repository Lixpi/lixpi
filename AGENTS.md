Each folder may contain a separate README.md file. When working on the code you must look for such README.md files and understand the documentation. If you update the component you must also update the README.md file in that directory or in parent directory if changes in a child directory affects code in the parend directory.

Do not create README.md if it doesn't exist.

Never use any JSDoc comments!

When working on TypeScript code make sure to follow these rules:
 - use `type` instead of `interface` for type definitions.
 - Always use `.ts` extension when importing files, all our code is in TypeScript, never use `.js` imports.
 - When importing types and methods from a package, make sure to do it in a single block, like this:
    ```TypeScript
    import {
        createJwtVerifier,
        type JwtVerificationResult
    } from '@lixpi/auth-service'
    ```

When question is related to SVG or D3 you must always refer to the available `D3` MCP server!

NEVER use `cat` to edit files.
NEVER run large inline python or js code in the terminal.

## Working with branches and GitHub tools

When working on feature and user asks you to open a pull request, you must make sure that working branch named in the following way: `LIX-<issue-id>>/<description>` e.g. ``LIX-60/support-google-models`.
You must fetch `<issue-id>` from GitHub via available tools.

When opening pull request title must be in the following format: `LIX-<issue-id> # <description>`. Make sure to assign the issue to the current user.
After PR is opened you must update the associated issue and provide a link to the opened PR at the end of description body.
When creating a commit you must add commit title in the same `LIX-<issue-id> # <description>` format.