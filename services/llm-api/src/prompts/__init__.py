"""
Prompt template utilities for LangGraph integration.
Loads prompts from text files and provides them as LangGraph-compatible templates.
"""

import os
from pathlib import Path
from typing import Optional

# Get prompts directory path
PROMPTS_DIR = Path(__file__).parent


def load_prompt(filename: str) -> str:
    """
    Load a prompt from a text file.

    Args:
        filename: Name of the prompt file (with extension)

    Returns:
        Prompt content as string
    """
    prompt_path = PROMPTS_DIR / filename
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")

    return prompt_path.read_text(encoding='utf-8')


# Load system prompts
SYSTEM_PROMPT = load_prompt("system.txt")
ANTHROPIC_CODE_BLOCK_HACK = load_prompt("anthropic_code_block_hack.txt")


def get_system_prompt() -> str:
    """Get the base system prompt for all LLM interactions."""
    return SYSTEM_PROMPT


def get_anthropic_prompt_suffix() -> str:
    """Get the Anthropic-specific code block formatting hack."""
    return ANTHROPIC_CODE_BLOCK_HACK


def format_user_message_with_hack(message: str, provider: str) -> str:
    """
    Format a user message with provider-specific hacks.

    Args:
        message: Original user message
        provider: LLM provider name ('OpenAI' or 'Anthropic')

    Returns:
        Formatted message with any necessary prompt engineering
    """
    if provider == 'Anthropic':
        # Append code block hack to Anthropic messages
        return f"{message}{ANTHROPIC_CODE_BLOCK_HACK}"

    # No modifications for other providers
    return message
