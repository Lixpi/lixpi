"""
Debug tools for Python - Colored logging utilities matching TypeScript version
"""

import json
import sys
from typing import Any
from colorama import Fore, Style, init

# Initialize colorama - force color output even in Docker
init(autoreset=True, strip=False)


def _safe_inspect(val: Any) -> str:
    """Safely convert value to string representation"""
    if isinstance(val, str):
        return val
    try:
        return json.dumps(val, indent=2, default=str)
    except (TypeError, ValueError):
        return str(val)


def _format_args(args: tuple) -> list:
    """Format arguments for printing"""
    return [arg if isinstance(arg, str) else _safe_inspect(arg) for arg in args]


def log(*args: Any) -> None:
    """Print log message in green"""
    if args and isinstance(args[0], str):
        formatted = _format_args(args[1:])
        print(f"{Fore.GREEN}{args[0]}{Style.RESET_ALL}", *formatted)
    else:
        formatted = _format_args(args)
        print(*formatted)


def info(*args: Any) -> None:
    """Print info message in blue"""
    if args and isinstance(args[0], str):
        formatted = _format_args(args[1:])
        print(f"{Fore.BLUE}{args[0]}{Style.RESET_ALL}", *formatted)
    else:
        formatted = _format_args(args)
        print(*formatted)


def info_str(args: list[str]) -> None:
    """Print concatenated string arguments"""
    print(''.join(args))


def warn(*args: Any) -> None:
    """Print warning message in yellow"""
    if args and isinstance(args[0], str):
        formatted = _format_args(args[1:])
        print(f"{Fore.YELLOW}{args[0]}{Style.RESET_ALL}", *formatted)
    else:
        formatted = _format_args(args)
        print(*formatted)


def err(*args: Any) -> None:
    """Print error message in red"""
    if args and isinstance(args[0], str):
        formatted = _format_args(args[1:])
        print(f"{Fore.RED}{args[0]}{Style.RESET_ALL}", *formatted)
    else:
        formatted = _format_args(args)
        print(*formatted)
