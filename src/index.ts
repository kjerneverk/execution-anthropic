/**
 * Execution Anthropic Package
 *
 * Anthropic provider implementation for LLM execution.
 *
 * @packageDocumentation
 */

import Anthropic from '@anthropic-ai/sdk';
import { getRedactor } from '@utilarium/offrecord';
import { getProxyUrl, createProxyFetch } from './proxy.js';
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

export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
        items?: { type: string };
        default?: any;
    }>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
}

export type StreamChunkType = 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done';

export interface StreamChunk {
    type: StreamChunkType;
    text?: string;
    toolCall?: {
        id?: string;
        index?: number;
        name?: string;
        argumentsDelta?: string;
    };
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface Request {
    messages: Message[];
    model: Model;
    responseFormat?: any;
    validator?: any;
    tools?: ToolDefinition[];
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
    executeStream?(request: Request, options?: ExecutionOptions): AsyncIterable<StreamChunk>;
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
            const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
            const proxyUrl = getProxyUrl();
            if (proxyUrl) {
                clientOptions.fetch = createProxyFetch(proxyUrl);
            }
            const client = new Anthropic(clientOptions);

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
                } else if (msg.role === 'tool') {
                    // Handle tool result messages - Anthropic expects these as user messages with tool_result content
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: (msg as any).tool_call_id || '',
                                content: typeof msg.content === 'string' 
                                    ? msg.content 
                                    : JSON.stringify(msg.content),
                            },
                        ],
                    });
                } else if (msg.role === 'assistant' && (msg as any).tool_calls) {
                    // Handle assistant messages with tool calls
                    const toolCalls = (msg as any).tool_calls;
                    const content: Anthropic.ContentBlockParam[] = [];
                    
                    if (msg.content) {
                        content.push({
                            type: 'text',
                            text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                        });
                    }
                    
                    for (const tc of toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input: JSON.parse(tc.function.arguments),
                        });
                    }
                    
                    messages.push({ role: 'assistant', content });
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

            // Build tools array for the request
            let anthropicTools: Anthropic.Tool[] | undefined;
            let toolChoice: Anthropic.ToolChoice | undefined;

            if (request.responseFormat?.type === 'json_schema') {
                // JSON schema mode - use tool for structured output
                anthropicTools = [
                    {
                        name: request.responseFormat.json_schema.name,
                        description:
                            request.responseFormat.json_schema.description ||
                            'Output data in this structured format',
                        input_schema:
                            request.responseFormat.json_schema.schema,
                    },
                ];
                toolChoice = {
                    type: 'tool' as const,
                    name: request.responseFormat.json_schema.name,
                };
            } else if (request.tools && request.tools.length > 0) {
                // Function calling mode - pass tools from request
                anthropicTools = request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
                }));
                // Let the model decide when to use tools
                toolChoice = { type: 'auto' as const };
            }

            const response = await client.messages.create({
                model: model,
                system: systemPrompt.trim() || undefined,
                messages: messages,
                max_tokens: options.maxTokens || 4096,
                temperature: options.temperature,
                ...(anthropicTools ? { tools: anthropicTools } : {}),
                ...(toolChoice ? { tool_choice: toolChoice } : {}),
            });

            // Handle ContentBlock - extract text and tool calls
            let text = '';
            const toolCalls: Array<{
                id: string;
                type: 'function';
                function: { name: string; arguments: string };
            }> = [];

            for (const block of response.content) {
                if (block.type === 'text') {
                    text += block.text;
                } else if (block.type === 'tool_use') {
                    if (request.responseFormat?.type === 'json_schema') {
                        // For JSON schema mode, return the tool input as text
                        text = JSON.stringify(block.input, null, 2);
                    } else {
                        // For function calling mode, add to toolCalls array
                        toolCalls.push({
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: JSON.stringify(block.input),
                            },
                        });
                    }
                }
            }

            return {
                content: text,
                model: response.model,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                },
                ...(toolCalls.length > 0 ? { toolCalls } : {}),
            };
        } catch (error) {
            // Sanitize error to remove any API keys from error messages
            // Use spotclean for comprehensive error sanitization
            throw createSafeError(error as Error, { provider: 'anthropic' });
        }
    }

    /**
     * Execute a request with streaming response
     */
    async *executeStream(
        request: Request,
        options: ExecutionOptions = {}
    ): AsyncIterable<StreamChunk> {
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
                } else if (msg.role === 'tool') {
                    // Handle tool result messages
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: (msg as any).tool_call_id || '',
                                content: typeof msg.content === 'string' 
                                    ? msg.content 
                                    : JSON.stringify(msg.content),
                            },
                        ],
                    });
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

            // Build tools array
            let anthropicTools: Anthropic.Tool[] | undefined;
            if (request.tools && request.tools.length > 0) {
                anthropicTools = request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
                }));
            }

            const stream = client.messages.stream({
                model: model,
                system: systemPrompt.trim() || undefined,
                messages: messages,
                max_tokens: options.maxTokens || 4096,
                temperature: options.temperature,
                ...(anthropicTools ? { tools: anthropicTools, tool_choice: { type: 'auto' as const } } : {}),
            });

            // Track tool calls being built
            const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();

            for await (const event of stream) {
                if (event.type === 'content_block_start') {
                    if (event.content_block.type === 'tool_use') {
                        const index = event.index;
                        toolCallsInProgress.set(index, {
                            id: event.content_block.id,
                            name: event.content_block.name,
                            arguments: '',
                        });
                        yield {
                            type: 'tool_call_start',
                            toolCall: {
                                id: event.content_block.id,
                                index,
                                name: event.content_block.name,
                            },
                        };
                    }
                } else if (event.type === 'content_block_delta') {
                    if (event.delta.type === 'text_delta') {
                        yield { type: 'text', text: event.delta.text };
                    } else if (event.delta.type === 'input_json_delta') {
                        const index = event.index;
                        const toolCall = toolCallsInProgress.get(index);
                        if (toolCall) {
                            toolCall.arguments += event.delta.partial_json;
                            yield {
                                type: 'tool_call_delta',
                                toolCall: {
                                    index,
                                    argumentsDelta: event.delta.partial_json,
                                },
                            };
                        }
                    }
                } else if (event.type === 'content_block_stop') {
                    const index = event.index;
                    const toolCall = toolCallsInProgress.get(index);
                    if (toolCall) {
                        yield {
                            type: 'tool_call_end',
                            toolCall: {
                                id: toolCall.id,
                                index,
                                name: toolCall.name,
                            },
                        };
                    }
                } else if (event.type === 'message_delta') {
                    if (event.usage) {
                        yield {
                            type: 'usage',
                            usage: {
                                inputTokens: 0, // Input tokens come from message_start
                                outputTokens: event.usage.output_tokens,
                            },
                        };
                    }
                } else if (event.type === 'message_start') {
                    // Capture input tokens from message_start
                    if (event.message.usage) {
                        yield {
                            type: 'usage',
                            usage: {
                                inputTokens: event.message.usage.input_tokens,
                                outputTokens: 0,
                            },
                        };
                    }
                }
            }

            yield { type: 'done' };
        } catch (error) {
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
