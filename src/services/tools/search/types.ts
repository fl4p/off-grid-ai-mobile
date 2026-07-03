/** A single web-search hit, normalized across providers. */
export type SearchResult = { title: string; snippet: string; url?: string };

/**
 * A web-search backend. Implementations are swappable behind this interface;
 * callers (the web_search tool handler) never branch on which one is active.
 */
export interface SearchProvider {
  /** Stable identifier persisted in settings (e.g. 'brave', 'serper'). */
  readonly id: SearchProviderId;
  /** Human-readable name shown in the settings UI. */
  readonly label: string;
  /** True when the provider needs an API key to work. */
  readonly requiresApiKey: boolean;
  /**
   * Run a search and return normalized results (may be empty).
   * Throw on transport/auth failures; the handler surfaces the message.
   * @param signal aborts the in-flight request on timeout.
   */
  search(query: string, signal: AbortSignal): Promise<SearchResult[]>;
}

export type SearchProviderId = 'brave' | 'serper';

/**
 * Outcome of checking a candidate API key against a provider.
 * - valid: the provider accepted the key.
 * - invalid: the provider rejected the key (wrong/expired).
 * - unknown: couldn't reach the provider or it returned an unexpected status,
 *   so we can't tell (network offline, rate limit, 5xx).
 */
export type KeyValidationResult =
  | { status: 'valid' }
  | { status: 'invalid'; message: string }
  | { status: 'unknown'; message: string };
