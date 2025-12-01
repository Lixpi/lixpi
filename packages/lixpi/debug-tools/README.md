# Debug Tools

Shared debug utilities for Lixpi services providing colored console output.

## Structure

```
debug-tools/
├── js/                    # TypeScript implementation
│   ├── debug-tools.ts    # Main implementation
│   └── package.json      # Package configuration
└── python/               # Python implementation
    ├── __init__.py       # Package exports
    ├── debug_tools.py    # Main implementation
    └── pyproject.toml    # Package configuration
```

## TypeScript Usage

```typescript
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

log('Success message')         // Green
info('Information message')    // Blue
warn('Warning message')        // Yellow
err('Error message')          // Red

// Concatenated string with custom colors
infoStr([chalk.green('NATS -> '), chalk.blue('connected')])
```

## Python Usage

```python
from lixpi_debug_tools import log, info, info_str, warn, err

log('Success message')         # Green
info('Information message')    # Blue
warn('Warning message')        # Yellow
err('Error message')          # Red

# Concatenated string with custom colors
from colorama import Fore, Style
info_str([Fore.GREEN, "NATS -> ", Style.RESET_ALL, Fore.BLUE, "connected", Style.RESET_ALL])
```

## Features

- **Colored Output**: Consistent color coding across TypeScript and Python
- **Safe Serialization**: Automatically handles object-to-string conversion
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Type-Safe**: Full TypeScript type definitions

## Dependencies

### TypeScript
- `chalk` - Terminal string styling

### Python
- `colorama` - Cross-platform colored terminal output
