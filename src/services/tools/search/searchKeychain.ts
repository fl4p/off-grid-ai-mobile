import * as Keychain from 'react-native-keychain';
import logger from '../../../utils/logger';
import type { SearchProviderId } from './types';

/**
 * Secure storage for search-provider API keys. Keys are secrets, so they live
 * in the OS keychain (same approach as remote-server keys), never in the plain
 * AsyncStorage settings blob. Keyed by provider id so new providers need no
 * new storage code.
 */
const KEYCHAIN_SERVICE = 'ai.offgridmobile.search';

function serviceFor(providerId: SearchProviderId): string {
  return `${KEYCHAIN_SERVICE}.${providerId}`;
}

export async function storeSearchApiKey(providerId: SearchProviderId, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await removeSearchApiKey(providerId);
    return;
  }
  try {
    await Keychain.setGenericPassword(`search_${providerId}`, trimmed, {
      service: serviceFor(providerId),
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
  } catch (error) {
    logger.error('[SearchKeychain] Failed to store API key:', error);
    throw error;
  }
}

/** Returns the stored key, or '' when none is set (or on read failure). */
export async function getSearchApiKey(providerId: SearchProviderId): Promise<string> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: serviceFor(providerId) });
    return credentials ? credentials.password : '';
  } catch (error) {
    logger.error('[SearchKeychain] Failed to read API key:', error);
    return '';
  }
}

export async function removeSearchApiKey(providerId: SearchProviderId): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: serviceFor(providerId) });
  } catch (error) {
    logger.error('[SearchKeychain] Failed to remove API key:', error);
  }
}
