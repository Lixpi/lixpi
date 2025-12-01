"""Shared constants for Python services.

This module mirrors the TypeScript constants API. It loads:
- NATS subjects from ``nats-subjects.json``
- AI interaction constants from ``ai-interaction-constants.json``
"""

import json
from pathlib import Path

_BASE_PATH = Path(__file__).parent

# NATS subjects -----------------------------------------------------------------

_nats_path = _BASE_PATH / "nats-subjects.json"
_nats_data = json.loads(_nats_path.read_text())

# Create NATS_SUBJECTS as the main export (matching TypeScript API)
NATS_SUBJECTS = _nats_data

# Also export individual subject groups for convenience
globals().update(_nats_data)

# AI interaction constants -------------------------------------------------------

_ai_interaction_path = _BASE_PATH.parent / "ai-interaction-constants.json"
_ai_interaction_data = json.loads(_ai_interaction_path.read_text())

AI_INTERACTION_CONSTANTS = _ai_interaction_data

# Also export individual AI interaction constant groups for convenience
globals().update(_ai_interaction_data)

__all__ = [
	"NATS_SUBJECTS",
	"AI_INTERACTION_CONSTANTS",
] + list(_nats_data.keys()) + list(_ai_interaction_data.keys())
