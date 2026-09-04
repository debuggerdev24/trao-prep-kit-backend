import type { ILanguageModelClient, LLMMessage, LLMRequestOptions } from './types.js';

export class LLMError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseBody?: string) {
    super(message);
    this.name = 'LLMError';
  }
}

export class LLMRateLimitError extends LLMError {
  public readonly retryAfterMs?: number;

  constructor(message = 'LLM rate limit exceeded (429)', statusCode = 429, responseBody?: string, retryAfterMs?: number) {
    super(message, statusCode, responseBody);
    this.name = 'LLMRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class UniversalLLMClient implements ILanguageModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = options?.apiKey || process.env.LLM_API_KEY || '';
    this.baseUrl = (options?.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = options?.model || process.env.LLM_MODEL || 'gpt-4o-mini';
  }

  public async complete(messages: LLMMessage[], options?: LLMRequestOptions): Promise<string> {
    const maxRetries = options?.maxRetries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 45000;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const body: Record<string, unknown> = {
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.1,
        };

        if (options?.maxTokens) {
          body.max_tokens = options.maxTokens;
        }

        if (options?.jsonMode) {
          body.response_format = { type: 'json_object' };
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        };

        // OpenRouter optional tracking headers
        if (this.baseUrl.includes('openrouter.ai')) {
          headers['HTTP-Referer'] = 'http://localhost:3000';
          headers['X-Title'] = 'Interview Prep Kit';
        }

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = data.choices?.[0]?.message?.content;
          if (content === undefined || content === null) {
            throw new LLMError('LLM response contained no message content');
          }
          return content;
        }

        const errorText = await response.text();

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('retry-after');
          let retryAfterMs: number | undefined;
          if (retryAfterHeader) {
            const seconds = Number(retryAfterHeader);
            if (!Number.isNaN(seconds)) {
              retryAfterMs = Math.min(seconds * 1000, 10000); // Cap at 10s
            }
          }
          throw new LLMRateLimitError(`Rate limit exceeded (429): ${errorText}`, 429, errorText, retryAfterMs);
        }

        if (response.status >= 500) {
          throw new LLMError(`Server error (${response.status}): ${errorText}`, response.status, errorText);
        }

        // Non-retriable client errors (e.g. 401, 400)
        throw new LLMError(`LLM request failed with status ${response.status}: ${errorText}`, response.status, errorText);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        attempt++;

        const isRetriable =
          lastError instanceof LLMRateLimitError ||
          (lastError instanceof LLMError && (lastError.statusCode ?? 0) >= 500) ||
          lastError.name === 'AbortError' ||
          lastError.message.includes('fetch failed');

        if (!isRetriable || attempt > maxRetries) {
          throw lastError;
        }

        // Exponential backoff with jitter: (2^attempt * 500ms) + random jitter
        // If server provided Retry-After, use that instead (capped at 10s)
        const backoffMs = (lastError instanceof LLMRateLimitError && lastError.retryAfterMs)
          ? lastError.retryAfterMs
          : Math.pow(2, attempt) * 500 + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError || new LLMError('LLM completion failed after max retries');
  }
}
