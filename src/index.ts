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

/**
 * Default model when the request and options omit `model`.
 * Uses the current flagship Sonnet; override with `ExecutionOptions.model` or `Request.model`.
 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6' as const;

/** Stable API identifiers for the latest generation (see Anthropic models documentation). */
export const CLAUDE_OPUS_LATEST = 'claude-opus-4-6' as const;
export const CLAUDE_SONNET_LATEST = 'claude-sonnet-4-6' as const;
export const CLAUDE_HAIKU_LATEST = 'claude-haiku-4-5' as const;

export type { Model as AnthropicModel } from '@anthropic-ai/sdk/resources/messages/messages.js';

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
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
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

            const model = options.model || request.model || DEFAULT_ANTHROPIC_MODEL;

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
                        // Parse arguments, defaulting to empty object if empty or invalid
                        let input: Record<string, unknown> = {};
                        if (tc.function.arguments && tc.function.arguments.trim()) {
                            try {
                                input = JSON.parse(tc.function.arguments);
                            } catch {
                                // If arguments can't be parsed, use empty object
                                input = {};
                            }
                        }
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input,
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
                max_tokens: options.maxTokens || 50000,
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

        // Idle timeout configuration (default 5 minutes)
        // This detects when the stream stops sending data mid-response
        // Set high because the model can take a long time to process large inputs
        // and decide on tool calls between streaming text chunks
        const idleTimeoutMs = options.timeout || 300000;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let abortController: AbortController | null = null;

        const resetIdleTimer = () => {
            if (idleTimer) {
                clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(() => {
                if (abortController) {
                    abortController.abort();
                }
            }, idleTimeoutMs);
        };

        const clearIdleTimer = () => {
            if (idleTimer) {
                clearTimeout(idleTimer);
                idleTimer = null;
            }
        };

        try {
            abortController = new AbortController();
            const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { 
                apiKey,
                // Set overall timeout (10 minutes default, or user-specified)
                timeout: options.timeout || 600000,
            };
            const proxyUrl = getProxyUrl();
            if (proxyUrl) {
                clientOptions.fetch = createProxyFetch(proxyUrl);
            }
            const client = new Anthropic(clientOptions);

            const model = options.model || request.model || DEFAULT_ANTHROPIC_MODEL;

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
                        // Parse arguments, defaulting to empty object if empty or invalid
                        let input: Record<string, unknown> = {};
                        if (tc.function.arguments && tc.function.arguments.trim()) {
                            try {
                                input = JSON.parse(tc.function.arguments);
                            } catch {
                                // If arguments can't be parsed, use empty object
                                input = {};
                            }
                        }
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input,
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

            // Build tools array
            let anthropicTools: Anthropic.Tool[] | undefined;
            if (request.tools && request.tools.length > 0) {
                anthropicTools = request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
                }));
            }

            // Build system prompt with cache control for prompt caching
            // Cache the system prompt since it's the same across turns
            const systemBlocks: Anthropic.TextBlockParam[] = systemPrompt.trim() 
                ? [{
                    type: 'text' as const,
                    text: systemPrompt.trim(),
                    cache_control: { type: 'ephemeral' as const },
                }]
                : [];

            const stream = client.messages.stream({
                model: model,
                system: systemBlocks.length > 0 ? systemBlocks : undefined,
                messages: messages,
                max_tokens: options.maxTokens || 50000, // High default for tool calls with large content
                temperature: options.temperature,
                ...(anthropicTools ? { tools: anthropicTools, tool_choice: { type: 'auto' as const } } : {}),
            }, {
                signal: abortController.signal,
            });

            // Track tool calls being built
            const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();

            // Don't start idle timer until first event - initial processing can take a while for large inputs
            let idleTimerStarted = false;

            for await (const event of stream) {
                // Start idle timer after first event (initial "thinking" time can be long)
                if (!idleTimerStarted) {
                    idleTimerStarted = true;
                    resetIdleTimer();
                } else {
                    // Reset idle timer on subsequent events
                    resetIdleTimer();
                }

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
                    // Capture input tokens from message_start, including cache stats
                    if (event.message.usage) {
                        const usage = event.message.usage as any; // Cache fields may not be in types yet
                        yield {
                            type: 'usage',
                            usage: {
                                inputTokens: usage.input_tokens,
                                outputTokens: 0,
                                cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
                                cacheReadInputTokens: usage.cache_read_input_tokens || 0,
                            },
                        };
                    }
                }
            }

            // Clear idle timer on successful completion
            clearIdleTimer();
            yield { type: 'done' };
        } catch (error) {
            // Clear idle timer on error
            clearIdleTimer();
            
            // Check if this was an abort due to idle timeout
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`Stream idle timeout: no data received for ${idleTimeoutMs / 1000} seconds. The API may be unresponsive.`);
            }
            
            // Check for common abort/connection errors and provide better messages
            if (error instanceof Error) {
                const msg = error.message.toLowerCase();
                if (msg.includes('aborted') || msg.includes('abort')) {
                    throw new Error(`Request aborted: The connection to Anthropic was interrupted. This may be due to network issues or server-side timeout. Try again.`);
                }
                if (msg.includes('timeout')) {
                    throw new Error(`Request timeout: The Anthropic API took too long to respond. Try with a smaller input or try again later.`);
                }
                if (msg.includes('econnreset') || msg.includes('socket hang up')) {
                    throw new Error(`Connection reset: Lost connection to Anthropic API. Check your network and try again.`);
                }
            }
            
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
