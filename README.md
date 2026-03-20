# execution-anthropic

Anthropic Claude provider implementation for LLM execution. Implements the `Provider` interface from the `execution` package.

## Installation

```bash
npm install execution-anthropic @anthropic-ai/sdk
```

## Usage

```typescript
import {
  AnthropicProvider,
  createAnthropicProvider,
  CLAUDE_SONNET_LATEST,
  DEFAULT_ANTHROPIC_MODEL,
} from 'execution-anthropic';

// Create provider
const provider = createAnthropicProvider();

// Execute a request
const response = await provider.execute(
  {
    model: CLAUDE_SONNET_LATEST, // or omit to use DEFAULT_ANTHROPIC_MODEL
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

Any model string the Anthropic API accepts is supported (`supportsModel` checks the `claude` prefix). This package depends on a current `@anthropic-ai/sdk`, whose typings include IDs such as:

- **Claude 4.6** — `claude-opus-4-6`, `claude-sonnet-4-6`
- **Claude 4.5** — `claude-opus-4-5`, `claude-opus-4-5-20251101`, `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5`, `claude-haiku-4-5-20251001`
- **Claude 4.0 / 4.1** — e.g. `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-opus-4-1-20250805`
- **Claude 3.x** — legacy dated IDs (e.g. `claude-3-opus-20240229`) remain valid where the API still serves them

Exported helpers: `DEFAULT_ANTHROPIC_MODEL`, `CLAUDE_OPUS_LATEST`, `CLAUDE_SONNET_LATEST`, `CLAUDE_HAIKU_LATEST`, and TypeScript type `AnthropicModel` (re-exported from the SDK).

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
TEST