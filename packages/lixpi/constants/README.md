# Lixpi Constants

Shared constants for NATS subjects, AWS resources, and types across Python and TypeScript services.

All NATS subjects are defined once in `nats-subjects.json` and accessed through language-specific wrappers.

## Structure

```
packages/lixpi/constants/
├── nats-subjects.json        # Single source of truth
├── ai-interaction-constants.json
├── python/                   # Python package
└── ts/                       # TypeScript/JavaScript package
```

## Usage

### TypeScript

```typescript
import { NATS_SUBJECTS } from '@lixpi/constants'
import type { AiInteractionChatSendMessagePayload, User, AiModel, ImageSizeOption } from '@lixpi/constants'

const { AI_INTERACTION_SUBJECTS, WORKSPACE_SUBJECTS } = NATS_SUBJECTS

// Access AI interaction subjects
const subject = AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE
const responseSubject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${documentId}`

// Access workspace-related subjects (nested under WORKSPACE_SUBJECTS)
const { DOCUMENT_SUBJECTS, AI_CHAT_THREAD_SUBJECTS, IMAGE_SUBJECTS } = WORKSPACE_SUBJECTS
const createDocSubject = DOCUMENT_SUBJECTS.CREATE_DOCUMENT
const createThreadSubject = AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD
const deleteImageSubject = IMAGE_SUBJECTS.DELETE_IMAGE

// Use types
const payload: AiInteractionChatSendMessagePayload = { messages, aiModel, threadId }

// AiModel includes imageSizes for image generation providers
// ImageSizeOption: { value: string; label: string }
const sizes: ImageSizeOption[] = model.imageSizes ?? []
```

### Python

```python
from lixpi_constants import NATS_SUBJECTS

ai_interaction_subjects = NATS_SUBJECTS["AI_INTERACTION_SUBJECTS"]
send_subject = ai_interaction_subjects["CHAT_SEND_MESSAGE"]

# Workspace-related subjects are nested
workspace_subjects = NATS_SUBJECTS["WORKSPACE_SUBJECTS"]
document_subjects = workspace_subjects["DOCUMENT_SUBJECTS"]
create_doc_subject = document_subjects["CREATE_DOCUMENT"]
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
