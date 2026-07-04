import { Share } from 'react-native';

/**
 * Share a local file through the OS share sheet.
 *
 * Prefers react-native-share, which attaches a real file cross-platform (including
 * Android, where RN's built-in Share can only share text). If that native module
 * isn't linked yet (e.g. before a rebuild) or errors, it falls back to the built-in
 * Share - on iOS a `file://` url still opens the share sheet with the file; on
 * Android the url is shared as text. So the feature works today and gets more
 * robust once react-native-share is built in.
 */
export async function shareLocalFile(
  path: string,
  opts: { title?: string; mimeType?: string } = {},
): Promise<void> {
  const url = path.startsWith('file://') ? path : `file://${path}`;
  try {
    const RNShare = require('react-native-share').default; // NOSONAR - optional native module
    await RNShare.open({ url, title: opts.title, type: opts.mimeType, failOnCancel: false });
    return;
  } catch (error) {
    // A user cancellation is not a failure and must not re-open the fallback sheet.
    if (isUserCancellation(error)) return;
    // Otherwise the module is missing / not linked yet - fall through to built-in.
  }
  await Share.share({ url, title: opts.title });
}

function isUserCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|dismiss|did not share/i.test(message);
}
