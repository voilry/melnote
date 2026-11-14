import * as FileSystem from 'expo-file-system/legacy';

/** Where avatars live for the lifetime of the install. */
export const AVATARS_DIRECTORY = `${FileSystem.documentDirectory ?? ''}avatars/`;

function extensionOf(uri: string): string {
    const name = uri.split('?')[0].split('/').pop() ?? '';
    const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
}

/**
 * Copies a picked image into the app's own storage and returns the new URI.
 *
 * The image picker hands back a temporary file in the cache directory, which
 * Android is free to purge. Storing that URI in the database means a person's
 * avatar can disappear while the row still points at it - and backups would
 * have nothing to capture. Persisting the file here keeps the avatar for as
 * long as the app is installed.
 *
 * The original URI is returned unchanged if the file cannot be copied, so the
 * picker result is never lost.
 */
export async function persistAvatar(uri: string): Promise<string> {
    if (!uri) return uri;
    if (uri.startsWith(AVATARS_DIRECTORY)) return uri;

    try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) return uri;

        const dirInfo = await FileSystem.getInfoAsync(AVATARS_DIRECTORY);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(AVATARS_DIRECTORY, { intermediates: true });
        }

        const stamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        const destination = `${AVATARS_DIRECTORY}avatar_${stamp}_${random}.${extensionOf(uri)}`;
        await FileSystem.copyAsync({ from: uri, to: destination });
        return destination;
    } catch (error) {
        console.warn('Could not persist avatar:', error);
        return uri;
    }
}

/** Removes an avatar file that the app owns. Safe to call with any URI. */
export async function deleteAvatarFile(uri?: string | null): Promise<void> {
    if (!uri || !uri.startsWith(AVATARS_DIRECTORY)) return;
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => { });
}

/** Removes every avatar file the app owns. */
export async function clearAvatarFiles(): Promise<void> {
    try {
        const names = await FileSystem.readDirectoryAsync(AVATARS_DIRECTORY);
        for (const name of names) {
            if (name.startsWith('.')) continue;
            await FileSystem.deleteAsync(`${AVATARS_DIRECTORY}${name}`, { idempotent: true });
        }
    } catch {
        // No avatars folder yet - nothing to clear.
    }
}

/**
 * True when a URI points at the app's own avatar storage.
 *
 * Anything else (the picker cache, a shared photo, an old backup path) is
 * outside the app's control and can disappear at any time.
 */
export function isStoredAvatar(uri?: string | null): boolean {
    return !!uri && uri.startsWith(AVATARS_DIRECTORY);
}
