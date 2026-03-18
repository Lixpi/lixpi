"""
Attachment format converters for LLM compatibility.

Registry-based architecture for normalizing attachment formats before sending
to LLM providers. Each converter handles specific MIME types and transforms
data into LLM-compatible formats.

Usage:
    from utils.converters import normalize_attachment_data

    data, mime_type = normalize_attachment_data(raw_bytes, 'image/webp')
    # → returns PNG or JPEG bytes with updated mime_type

Extending with new converters:
    1. Create a new module in this package (e.g., `heic.py`, `tiff.py`, `docx.py`)
    2. Implement a function: (data: bytes, mime_type: str) -> tuple[bytes, str]
    3. Register it in `_register_builtin_converters()` below
"""

import logging
from typing import Callable

logger = logging.getLogger(__name__)

# (data: bytes, mime_type: str) -> (converted_data, converted_mime_type)
ConverterFn = Callable[[bytes, str], tuple[bytes, str]]


class ConverterRegistry:
    """Maps source MIME types to converter functions."""

    def __init__(self):
        self._converters: dict[str, ConverterFn] = {}

    def register(self, mime_type: str, converter: ConverterFn) -> None:
        self._converters[mime_type] = converter

    def get(self, mime_type: str) -> ConverterFn | None:
        return self._converters.get(mime_type)


_registry = ConverterRegistry()


def register_converter(mime_type: str, converter: ConverterFn) -> None:
    """Register a converter for a source MIME type."""
    _registry.register(mime_type, converter)


def normalize_attachment_data(data: bytes, mime_type: str) -> tuple[bytes, str]:
    """
    Run the registered converter for a MIME type, if one exists.

    Returns (data, mime_type) unchanged when no converter matches.
    """
    converter = _registry.get(mime_type)
    if not converter:
        return data, mime_type
    return converter(data, mime_type)


def _register_builtin_converters() -> None:
    """Register all built-in converters. Called once at import time."""
    from .webp import convert_webp

    register_converter('image/webp', convert_webp)


_register_builtin_converters()
