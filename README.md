# execution-anthropic

Anthropic Claude provider implementation for LLM execution. Implements the `Provider` interface from the `execution` package.

## Installation

```bash
npm install execution-anthropic @anthropic-ai/sdk
```

## Usage

```typescript
import { AnthropicProvider, createAnthropicProvider } from 'execution-anthropic';

// Create provider
const provider = createAnthropicProvider();

// Execute a request
const response = await provider.execute(
  {
    model: 'claude-3-opus-20240229',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello!' }
    ],
    addMessage: () => {},
  },
  {
    apiKey: process.env.ANTHROPIC_API_KEY,
    temperature: 0.7,
    maxTokens: 4096,
  }
);

console.log(response.content);
console.log(response.usage); // { inputTokens: X, outputTokens: Y }
```

## Supported Models

The provider supports all Claude models:
- Claude 3 Opus
- Claude 3 Sonnet
- Claude 3 Haiku
- Claude 3.5 family

## API Key

Set via:
1. `options.apiKey` parameter
2. `ANTHROPIC_API_KEY` environment variable

## Features

- Automatic system prompt extraction (Anthropic separates system from messages)
- Structured output via tool use (JSON schema support)
- Full token usage tracking

## Response Format

```typescript
interface ProviderResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

## Related Packages

- `execution` - Core interfaces (no SDK dependencies)
- `execution-openai` - OpenAI provider
- `execution-gemini` - Google Gemini provider

## License

Apache-2.0

<!-- v1.0.0 -->
