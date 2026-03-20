# AI Agent Guide: execution-anthropic

Anthropic Claude provider for `execution` interface.

## Quick Start

```typescript
import { createAnthropicProvider, CLAUDE_SONNET_LATEST } from 'execution-anthropic';

const provider = createAnthropicProvider();

const response = await provider.execute(
  {
    messages: [{ role: 'user', content: 'Hello' }],
    model: CLAUDE_SONNET_LATEST,
    addMessage: () => {},
  },
  { apiKey: process.env.ANTHROPIC_API_KEY }
);
```

## Supported Models

| Model family | Example API IDs |
|--------------|-----------------|
| Claude 4.6 | `claude-opus-4-6`, `claude-sonnet-4-6` |
| Claude 4.5 | `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, … |
| Claude 4.x | `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, … |
| Claude 3.x | `claude-3-opus-20240229`, `claude-3-haiku-20240307`, … |

## Dependencies

- `@anthropic-ai/sdk` - Official Anthropic SDK
- `execution` - Interface definitions (peer)

