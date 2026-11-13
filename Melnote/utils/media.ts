/**
 * Note media store.
 *
 * Images are copied into the app's own sandbox:
 *
 *   documentDirectory/media/<id>.jpg   ← the real file (resized once on import)
 *
 * and the markdown only ever references the stable relative path
 * `media/<id>.jpg`. Never an absolute `file://` path: on some platforms the
 * app container path changes across updates, which would break every note.
 *
 * The editor is a WebView and cannot read the app sandbox as a page origin,
 * so when markdown is converted to editor HTML the reference is expanded to an
 * absolute file URI (see `setMarkdownImageResolver`) and the WebView is opened
 * with `allowFileAccess`. The reader is native and reads the file directly.
 */
import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { setMarkdownImageResolver } from './markdownConverter';

export const MEDIA_DIRECTORY = `${FileSystem.documentDirectory ?? ''}media/`;
export const MEDIA_REF_PREFIX = 'media/';

/** Longest side of a stored image. A phone photo is 4000px+; 2048 keeps note
 *  pages crisp on any screen while bounding decode memory and backup size. */
const MAX_IMAGE_DIMENSION = 2048;
const JPEG_COMPRESSION = 0.88;

export interface ImportedImage {
    /** Relative markdown reference, e.g. `media/img_abc123.jpg`. */
    ref: string;
    /** Absolute file URI, for the editor WebView and native Image. */
    uri: string;
    width: number;
    height: number;
}

let directoryReady: Promise<void> | null = null;

/** Creates `media/` once per app session; safe to call on every import. */
export function ensureMediaDirectory(): Promise<void> {
    if (!directoryReady) {
        directoryReady = FileSystem.makeDirectoryAsync(MEDIA_DIRECTORY, {
            intermediates: true,
        }).catch(() => { });
    }
    return directoryReady;
}

export function isMediaRef(src: string): boolean {
    return /^media\/[^/?#]+$/.test(src || '');
}

/** Relative `media/<file>` → absolute `file://` URI. Non-references pass through. */
export function mediaUri(ref: string): string {
    if (!isMediaRef(ref)) return ref;
    return MEDIA_DIRECTORY + ref.slice(MEDIA_REF_PREFIX.length);
}

function mediaFileName(): string {
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `img_${stamp}_${random}.jpg`;
}

type ImageManipulatorModule = typeof import('expo-image-manipulator');

/**
 * The manipulator is loaded lazily on purpose. It is a native module, and this
 * file is reachable from the reader (`MarkdownText` → `mediaUri`), so an eager
 * import would crash the whole app on a binary that predates it — an old dev
 * client, a rollback, or a JS-only update. Missing module means "no
 * downscaling", not "no images".
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

/** Extension for the fallback copy. Picker metadata first: a content:// URI
 *  frequently has no usable extension. */
function sourceExtension(asset: ImagePickerAsset): string {
    const fromName = asset.fileName?.includes('.') ? asset.fileName.split('.').pop() : null;
    const fromMime = asset.mimeType?.split('/').pop() ?? null;
    return (fromName || fromMime || 'jpg')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/^jpeg$/, 'jpg') || 'jpg';
}

/**
 * Copies a picked image into the media directory, normalising it to JPEG and
 * capping the longest side at 2048px. Degrades to a plain copy when the native
 * manipulator is unavailable or cannot decode the source (rare HEIC/CMYK
 * cases) — the photo is never dropped.
 */
export async function importPickedImage(asset: ImagePickerAsset): Promise<ImportedImage> {
    await ensureMediaDirectory();

    const name = mediaFileName();
    const sourceWidth = asset.width || 0;
    const sourceHeight = asset.height || 0;

    const manipulator = getImageManipulator();
    if (manipulator) {
        try {
            const context = manipulator.ImageManipulator.manipulate(asset.uri);
            const longest = Math.max(sourceWidth, sourceHeight);
            if (longest > MAX_IMAGE_DIMENSION) {
                if (sourceWidth >= sourceHeight) {
                    context.resize({ width: MAX_IMAGE_DIMENSION });
                } else {
                    context.resize({ height: MAX_IMAGE_DIMENSION });
                }
            }
            const rendered = await context.renderAsync();
            const saved = await rendered.saveAsync({
                compress: JPEG_COMPRESSION,
                format: manipulator.SaveFormat.JPEG,
            });
            const destination = MEDIA_DIRECTORY + name;
            await FileSystem.copyAsync({ from: saved.uri, to: destination });
            FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => { });
            return {
                ref: MEDIA_REF_PREFIX + name,
                uri: destination,
                width: saved.width || sourceWidth,
                height: saved.height || sourceHeight,
            };
        } catch {
            // Fall through to the plain copy: keep the user's bytes.
        }
    }

    // Plain copy — no native manipulator, or a format it cannot decode. The
    // WebView and native <Image> still display JPEG/PNG/WebP/GIF.
    const extension = sourceExtension(asset);
    const fallbackName = extension === 'jpg' ? name : name.replace(/\.jpg$/, `.${extension}`);
    const fallbackDestination = MEDIA_DIRECTORY + fallbackName;
    await FileSystem.copyAsync({ from: asset.uri, to: fallbackDestination });
    return {
        ref: MEDIA_REF_PREFIX + fallbackName,
        uri: fallbackDestination,
        width: sourceWidth,
        height: sourceHeight,
    };
}

/**
 * Rewrites inline `data:image/...;base64,...` URLs (pasted images) into real
 * files before saving, so a pasted bitmap can never end up embedded in the
 * markdown stored in SQLite.
 */
export async function materializeDataImages(html: string): Promise<string> {
    if (!html || !html.includes('data:image/')) return html;
    await ensureMediaDirectory();

    const matcher = /src=("|')(data:image\/([a-z0-9.+-]+);base64,([^"']+))\1/gi;
    const found = Array.from(html.matchAll(matcher));
    if (!found.length) return html;

    let output = html;
    for (const match of found) {
        const [, , dataUri, subtype, base64] = match;
        const extension = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = mediaFileName().replace(/\.jpg$/, `.${extension}`);
        const uri = MEDIA_DIRECTORY + fileName;
        try {
            await FileSystem.writeAsStringAsync(uri, base64, {
                encoding: FileSystem.EncodingType.Base64,
            });
            output = output.split(dataUri).join(uri);
        } catch {
            // Leave this one embedded rather than corrupting the document.
        }
    }
    return output;
}

/** Absolute URI or stored reference → relative `media/<file>` reference. */
export function mediaRefFromUri(src: string): string | null {
    if (isMediaRef(src)) return src;
    const clean = (src || '').split('?')[0].split('#')[0];
    const marker = '/media/';
    const index = clean.lastIndexOf(marker);
    if (index === -1) return null;
    const name = clean.slice(index + marker.length);
    if (!name || name.includes('/')) return null;
    return MEDIA_REF_PREFIX + name;
}

/** True when this binary ships the native image manipulator. */
export function isImageEditingAvailable(): boolean {
    return getImageManipulator() !== null;
}

export type MediaEditAction =
    | { type: 'rotate'; degrees: number }
    | { type: 'flip'; axis: 'horizontal' | 'vertical' }
    | { type: 'crop'; aspect: number | null };

/** Center-crops the given dimensions to `aspect` (width / height). */
function centerCropRect(
    width: number,
    height: number,
    aspect: number
): { originX: number; originY: number; width: number; height: number } | null {
    if (!width || !height || !Number.isFinite(aspect) || aspect <= 0) return null;
    const current = width / height;
    if (Math.abs(current - aspect) < 0.01) return null;
    if (current > aspect) {
        const cropWidth = Math.max(1, Math.round(height * aspect));
        return {
            originX: Math.max(0, Math.round((width - cropWidth) / 2)),
            originY: 0,
            width: cropWidth,
            height,
        };
    }
    const cropHeight = Math.max(1, Math.round(width / aspect));
    return {
        originX: 0,
        originY: Math.max(0, Math.round((height - cropHeight) / 2)),
        width,
        height: cropHeight,
    };
}

/**
 * Applies rotate/flip/crop edits to an existing image and stores the result as a
 * NEW media file. Keeping the original file untouched means the editor's image
 * cache can never serve the pre-edit bitmap under an unchanged URI; the orphan
 * sweep removes the unreferenced original after the note is saved.
 *
 * Returns null when the native manipulator is unavailable (old binary) or the
 * source cannot be decoded — callers keep the original image in that case.
 */
export async function editMediaImage(
    src: string,
    actions: MediaEditAction[]
): Promise<ImportedImage | null> {
    const manipulator = getImageManipulator();
    if (!manipulator || !src || actions.length === 0) return null;
    await ensureMediaDirectory();

    try {
        let context = manipulator.ImageManipulator.manipulate(mediaUri(src));
        let hasTransform = false;
        for (const action of actions) {
            if (action.type === 'rotate' && action.degrees) {
                context = context.rotate(action.degrees);
                hasTransform = true;
            } else if (action.type === 'flip') {
                context = context.flip(action.axis);
                hasTransform = true;
            }
        }

        let rendered = hasTransform ? await context.renderAsync() : null;

        // Crop is applied after rotation/flip so the preset refers to the image
        // the user is looking at on screen.
        const crop = [...actions].reverse().find(
            (action): action is Extract<MediaEditAction, { type: 'crop' }> =>
                action.type === 'crop'
        );
        if (crop && crop.aspect) {
            if (!rendered) {
                rendered = await manipulator.ImageManipulator.manipulate(mediaUri(src)).renderAsync();
            }
            const rect = centerCropRect(rendered.width, rendered.height, crop.aspect);
            if (rect) {
                rendered = await manipulator.ImageManipulator.manipulate(rendered)
                    .crop(rect)
                    .renderAsync();
            }
        }

        if (!rendered) return null;

        const saved = await rendered.saveAsync({
            compress: JPEG_COMPRESSION,
            format: manipulator.SaveFormat.JPEG,
        });
        const name = mediaFileName();
        const destination = MEDIA_DIRECTORY + name;
        await FileSystem.copyAsync({ from: saved.uri, to: destination });
        FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => { });
        return {
            ref: MEDIA_REF_PREFIX + name,
            uri: destination,
            width: saved.width || rendered.width,
            height: saved.height || rendered.height,
        };
    } catch {
        return null;
    }
}

/** Permanently removes a stored image. Used by the orphan sweep. */
export async function deleteMediaRef(ref: string): Promise<void> {
    if (!isMediaRef(ref)) return;
    await FileSystem.deleteAsync(mediaUri(ref), { idempotent: true }).catch(() => { });
}

/** Media files currently on disk, as relative references. */
export async function listMediaRefs(): Promise<string[]> {
    try {
        const names = await FileSystem.readDirectoryAsync(MEDIA_DIRECTORY);
        return names.filter(name => !name.startsWith('.')).map(name => MEDIA_REF_PREFIX + name);
    } catch {
        return [];
    }
}

// The markdown converter stays dependency-free; this wires the sandbox path in
// exactly once, when the media layer first loads.
setMarkdownImageResolver(mediaUri);
