import * as FileSystem from 'expo-file-system/legacy';
import { clampCropRect, type MediaCropRect } from './media';

/** Where avatars live for the lifetime of the install. */
export const AVATARS_DIRECTORY = `${FileSystem.documentDirectory ?? ''}avatars/`;

/**
 * Longest side of a stored avatar, in pixels.
 *
 * Avatars render at 110-160px, so keeping the picked bitmap's own resolution
 * wasted memory on every list row for no visible gain. 512 leaves room for
 * larger presentations without decoding multi-megapixel files.
 */
const AVATAR_MAX_SIZE = 512;
const AVATAR_COMPRESSION = 0.9;

function extensionOf(uri: string): string {
    const name = uri.split('?')[0].split('/').pop() ?? '';
    const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg';
}

function avatarFileName(extension: string): string {
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `avatar_${stamp}_${random}.${extension}`;
}

async function ensureAvatarDirectory(): Promise<void> {
    const dirInfo = await FileSystem.getInfoAsync(AVATARS_DIRECTORY);
    if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(AVATARS_DIRECTORY, { intermediates: true });
    }
}

type ImageManipulatorModule = typeof import('expo-image-manipulator');

/**
 * Loaded lazily for the same reason as in `utils/media`: an eager import of a
 * native module would break a binary that predates it. A missing manipulator
 * means "store the picked file as-is", never "no avatar".
 */
let manipulatorModule: ImageManipulatorModule | null | undefined;

function getImageManipulator(): ImageManipulatorModule | null {
    if (manipulatorModule === undefined) {
        try {
            manipulatorModule = require('expo-image-manipulator') as ImageManipulatorModule;
        } catch {
            manipulatorModule = null;
        }
    }
    return manipulatorModule;
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

        await ensureAvatarDirectory();

        const destination = AVATARS_DIRECTORY + avatarFileName(extensionOf(uri));
        await FileSystem.copyAsync({ from: uri, to: destination });
        return destination;
    } catch (error) {
        console.warn('Could not persist avatar:', error);
        return uri;
    }
}

/**
 * Crops a picked image to the avatar frame and stores the result in app
 * storage. `rect` is in source pixels, which is exactly what `ImageCropView`
 * reports.
 *
 * The bitmap is rendered once before cropping so the rect is clamped against
 * the decoded size: EXIF-rotated photos report dimensions that differ from the
 * raw file. Everything runs in the native manipulator, off the JS thread.
 *
 * Falls back to a plain copy when the manipulator is unavailable or cannot
 * decode the source, so the picked photo is never lost.
 */
export async function persistCroppedAvatar(
    uri: string,
    rect: MediaCropRect | null
): Promise<string> {
    if (!uri || !rect) return persistAvatar(uri);

    const manipulator = getImageManipulator();
    if (!manipulator) return persistAvatar(uri);

    try {
        const decoded = await manipulator.ImageManipulator.manipulate(uri).renderAsync();
        // The avatar is always re-encoded, so a frame that covers the whole
        // photo is a valid crop here.
        const clamped = clampCropRect(decoded.width, decoded.height, rect, { allowFullFrame: true });
        if (!clamped) return persistAvatar(uri);

        let context = manipulator.ImageManipulator.manipulate(decoded).crop(clamped);
        if (Math.max(clamped.width, clamped.height) > AVATAR_MAX_SIZE) {
            context = context.resize({ width: AVATAR_MAX_SIZE });
        }
        const rendered = await context.renderAsync();
        const saved = await rendered.saveAsync({
            compress: AVATAR_COMPRESSION,
            format: manipulator.SaveFormat.JPEG,
        });

        await ensureAvatarDirectory();
        const destination = AVATARS_DIRECTORY + avatarFileName('jpg');
        await FileSystem.copyAsync({ from: saved.uri, to: destination });
        FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => { });
        return destination;
    } catch (error) {
        console.warn('Could not crop avatar:', error);
        return persistAvatar(uri);
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
