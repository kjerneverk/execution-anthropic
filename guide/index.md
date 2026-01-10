# AI Agent Guide: execution-anthropic

Anthropic Claude provider for `execution` interface.

## Quick Start

```typescript
import { AnthropicProvider } from 'execution-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const response = await provider.execute(messages, {
  model: 'claude-3-opus-20240229'
});
```

## Supported Models

| Model | Vision | Tools |
|-------|--------|-------|
| claude-3-opus | ✅ | ✅ |
| claude-3-sonnet | ✅ | ✅ |
| claude-3-haiku | ✅ | ✅ |
| claude-2.1 | ❌ | ❌ |

## Dependencies

- `@anthropic-ai/sdk` - Official Anthropic SDK
- `execution` - Interface definitions (peer)

