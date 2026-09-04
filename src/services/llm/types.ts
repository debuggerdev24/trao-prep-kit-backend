/**
 * LLM Provider Abstraction Types
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ILanguageModelClient {
  complete(messages: LLMMessage[], options?: LLMRequestOptions): Promise<string>;
}
