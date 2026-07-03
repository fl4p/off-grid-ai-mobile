import { braveProvider, createBraveProvider, BRAVE_LABEL } from './braveProvider';
import { createSerperProvider, SERPER_LABEL } from './serperProvider';
import type { SearchProvider, SearchProviderId, SearchResult } from './types';

export type { SearchProvider, SearchProviderId, SearchResult };

/** Config the selector needs: the chosen provider and its (optional) key. */
export type SearchProviderConfig = {
  searchProvider: SearchProviderId;
  apiKey?: string;
};

/** Static metadata for the settings UI (no secrets, no live instances). */
export const SEARCH_PROVIDER_OPTIONS: ReadonlyArray<{
  id: SearchProviderId;
  label: string;
  /** The provider cannot run without a key (Serper). */
  requiresApiKey: boolean;
  /** The provider runs keyless but a key unlocks a better backend (Brave). */
  optionalApiKey?: boolean;
  /** One-line description shown under the option in Settings. */
  hint: string;
}> = [
  {
    id: 'brave',
    label: BRAVE_LABEL,
    requiresApiKey: false,
    optionalApiKey: true,
    hint: 'Runs on your device against Brave, no key needed. Brave rate-limits keyless searches, so add a free Brave key to use its search API. Either way the query only goes to Brave.',
  },
  {
    id: 'serper',
    label: SERPER_LABEL,
    requiresApiKey: true,
    hint: 'Returns Google results via serper.dev. Sends each query to serper.dev with your API key.',
  },
];

/**
 * Builds the live provider for an id, or null when it can't run (e.g. a
 * key-requiring provider with no key). Adding a provider means adding one entry
 * here plus one in SEARCH_PROVIDER_OPTIONS - no caller changes.
 */
const PROVIDER_FACTORIES: Record<SearchProviderId, (apiKey: string) => SearchProvider | null> = {
  // Brave upgrades to the official API when a key is present, else the keyless scrape.
  brave: (apiKey) => (apiKey.trim() ? createBraveProvider(apiKey) : braveProvider),
  serper: (apiKey) => (apiKey.trim() ? createSerperProvider(apiKey) : null),
};

/**
 * Resolve the active search provider from settings. Falls back to the Brave
 * default when the selected provider can't be used, so web_search always has a
 * working backend.
 */
export function getActiveSearchProvider(config: SearchProviderConfig): SearchProvider {
  const factory = PROVIDER_FACTORIES[config.searchProvider];
  return factory?.(config.apiKey ?? '') ?? braveProvider;
}
