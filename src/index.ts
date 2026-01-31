/**
 * Execution Anthropic Package
 *
 * Anthropic provider implementation for LLM execution.
 *
 * @packageDocumentation
 */

import Anthropic from '@anthropic-ai/sdk';
import { getRedactor } from '@utilarium/offrecord';
import { 
    createSafeError, 
    configureErrorSanitizer,
    configureSecretGuard,
} from '@utilarium/spotclean';

// Register Anthropic API key patterns on module load
const redactor = getRedactor();
redactor.register({
    name: 'anthropic',
    patterns: [
        /sk-ant-[a-zA-Z0-9_-]+/g,
        /sk-ant-api\d+-[a-zA-Z0-9_-]+/g,
    ],
    validator: (key: string) => /^sk-ant(-api\d+)?-[a-zA-Z0-9_-]+$/.test(key),
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API keys',
});

// Configure spotclean for error sanitization
configureErrorSanitizer({
    enabled: true,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    includeCorrelationId: true,
    sanitizeStackTraces: process.env.NODE_ENV === 'production',
    maxMessageLength: 500,
});

configureSecretGuard({
    enabled: true,
    redactionText: '[REDACTED]',
    preservePartial: false,
    preserveLength: 0,
    customPatterns: [
        { name: 'anthropic', pattern: /sk-ant-[a-zA-Z0-9_-]+/g, description: 'Anthropic API key' },
        { name: 'anthropic-api', pattern: /sk-ant-api\d+-[a-zA-Z0-9_-]+/g, description: 'Anthropic API key' },
    ],
});

// ===== INLINE TYPES (from 'execution' package) =====

export type Model = string;

export interface Message {
    role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
    content: string | string[] | null;
    name?: string;
}

export interface Request {
    messages: Message[];
    model: Model;
    responseFormat?: any;
    validator?: any;
    addMessage(message: Message): void;
}

export interface ProviderResponse {
    content: string;
    model: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface ExecutionOptions {
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    retries?: number;
}

export interface Provider {
    readonly name: string;
    execute(request: Request, options?: ExecutionOptions): Promise<ProviderResponse>;
    supportsModel?(model: Model): boolean;
}

/**
 * Anthropic Provider implementation
 */
export class AnthropicProvider implements Provider {
    readonly name = 'anthropic';

    /**
     * Check if this provider supports a given model
     */
    supportsModel(model: Model): boolean {
        if (!model) return false;
        return model.startsWith('claude');
    }

    /**
     * Execute a request against Anthropic
     */
    async execute(
        request: Request,
        options: ExecutionOptions = {}
    ): Promise<ProviderResponse> {
        const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable.');
        }

        // Validate key format
        const validation = redactor.validateKey(apiKey, 'anthropic');
        if (!validation.valid) {
            throw new Error('Invalid Anthropic API key format');
        }

        try {
            const client = new Anthropic({ apiKey });

            const model = options.model || request.model || 'claude-3-opus-20240229';

            // Anthropic separates system prompt from messages
            let systemPrompt = '';
            const messages: Anthropic.MessageParam[] = [];

            for (const msg of request.messages) {
                if (msg.role === 'system' || msg.role === 'developer') {
                    systemPrompt +=
                        (typeof msg.content === 'string'
                            ? msg.content
                            : JSON.stringify(msg.content)) + '\n\n';
                } else {
                    messages.push({
                        role: msg.role as 'user' | 'assistant',
                        content:
                            typeof msg.content === 'string'
                                ? msg.content
                                : JSON.stringify(msg.content),
                    });
                }
            }

            const response = await client.messages.create({
                model: model,
                system: systemPrompt.trim() || undefined,
                messages: messages,
                max_tokens: options.maxTokens || 4096,
                temperature: options.temperature,
                ...(request.responseFormat?.type === 'json_schema'
                    ? {
                        tools: [
                            {
                                name: request.responseFormat.json_schema.name,
                                description:
                                      request.responseFormat.json_schema.description ||
                                      'Output data in this structured format',
                                input_schema:
                                      request.responseFormat.json_schema.schema,
                            },
                        ],
                        tool_choice: {
                            type: 'tool' as const,
                            name: request.responseFormat.json_schema.name,
                        },
                    }
                    : {}),
            });

            // Handle ContentBlock
            let text = '';

            if (request.responseFormat?.type === 'json_schema') {
                const toolUseBlock = response.content.find(
                    (block) => block.type === 'tool_use'
                );
                if (toolUseBlock && toolUseBlock.type === 'tool_use') {
                    text = JSON.stringify(toolUseBlock.input, null, 2);
                }
            } else {
                const contentBlock = response.content[0];
                text = contentBlock.type === 'text' ? contentBlock.text : '';
            }

            return {
                content: text,
                model: response.model,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                },
            };
        } catch (error) {
            // Sanitize error to remove any API keys from error messages
            // Use spotclean for comprehensive error sanitization
            throw createSafeError(error as Error, { provider: 'anthropic' });
        }
    }
}

/**
 * Create a new Anthropic provider instance
 */
export function createAnthropicProvider(): AnthropicProvider {
    return new AnthropicProvider();
}

/**
 * Package version
 */
export const VERSION = '0.0.1';

export default AnthropicProvider;
