import type { ILanguageModelClient, LLMMessage, LLMRequestOptions } from './types.js';
import { LLMRateLimitError } from './client.js';

export class MockLanguageModelClient implements ILanguageModelClient {
  public callCount = 0;
  public lastMessages: LLMMessage[] = [];
  public lastOptions?: LLMRequestOptions;

  constructor(
    private responseHandler:
      | string
      | ((messages: LLMMessage[], callCount: number) => Promise<string> | string),
    private simulateRateLimitFailures = 0
  ) {}

  public async complete(messages: LLMMessage[], options?: LLMRequestOptions): Promise<string> {
    this.callCount++;
    this.lastMessages = messages;
    this.lastOptions = options;

    if (this.simulateRateLimitFailures > 0) {
      this.simulateRateLimitFailures--;
      throw new LLMRateLimitError('Simulated 429 rate limit exceeded');
    }

    if (typeof this.responseHandler === 'function') {
      return await this.responseHandler(messages, this.callCount);
    }

    return this.responseHandler;
  }
}
