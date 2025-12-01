# Lixpi Constants

Shared constants for NATS subjects, AWS resources, and types across Python and TypeScript services.

All NATS subjects are defined once in `nats-subjects.json` and accessed through language-specific wrappers.

## Structure

```
packages/lixpi/constants/
├── nats-subjects.json        # Single source of truth
├── python/                   # Python package
└── js/                       # TypeScript/JavaScript package
```

## Usage

### TypeScript

```typescript
import { NATS_SUBJECTS } from '@lixpi/constants'
import type { AiInteractionChatSendMessagePayload, User } from '@lixpi/constants'

const { AI_INTERACTION_SUBJECTS, DOCUMENT_SUBJECTS } = NATS_SUBJECTS

// Access subjects
const subject = AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE
const responseSubject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${documentId}`

// Use types
const payload: AiInteractionChatSendMessagePayload = { messages, aiModel, threadId }
```

### Python

```python
from lixpi_constants import NATS_SUBJECTS

ai_interaction_subjects = NATS_SUBJECTS["AI_INTERACTION_SUBJECTS"]
send_subject = ai_interaction_subjects["CHAT_SEND_MESSAGE"]
```

## Adding New Subjects

Edit `nats-subjects.json`:

```json
{
  "AI_INTERACTION_SUBJECTS": {
    "YOUR_NEW_SUBJECT": "ai.interaction.your.new.subject"
  }
}
```

Both languages will pick it up automatically.
