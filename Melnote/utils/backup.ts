import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { DataRepository } from '../db/repositories/DataRepository';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { MEDIA_DIRECTORY, MEDIA_REF_PREFIX, deleteMediaRef, listMediaRefs } from './media';
import { AVATARS_DIRECTORY } from './avatar';

type ZipArchiveModule = typeof import('react-native-zip-archive');

/**
 * The zip engine is a native module, so it is loaded lazily: an app binary
 * that predates it must not crash the screen that talks about backups.
 */
let zipModule: ZipArchiveModule | null | undefined;

function getZipArchive(): ZipArchiveModule | null {
    if (zipModule === undefined) {
        try {
            zipModule = require('react-native-zip-archive') as ZipArchiveModule;
        } catch {
            zipModule = null;
        }
    }
    return zipModule;
}

/**
 * Melnote backup container.
 *
 * A backup is a ZIP archive that holds the database as JSON plus the binary
 * assets it points at:
 *
 *   manifest.json   format + version + counts + the files that were captured
 *   data.json       every table (settings included, minus the device-local
 *                   lock settings), compact JSON
 *   media/          note images, stored under the same relative names the
 *                   markdown already uses, so a restore never has to rewrite
 *                   note content
 *   avatars/        person avatars, referenced relatively inside data.json
 *
 * The archive is built natively (react-native-zip-archive wraps the platform
 * zip engine), so neither export nor restore has to hold the whole backup in
 * JS memory.
 */

export const BACKUP_FORMAT = 'melnote-backup';
export const BACKUP_VERSION = 2;
export const BACKUP_EXTENSION = '.melnote';

const MEDIA_REF_PATTERN = /media\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp|gif)/gi;

/**
 * Settings that belong to the device and never travel with a backup.
 *
 * The app lock and its biometric prompt are tied to the phone they were set
 * up on: restoring someone else's lock on a device without enrolled
 * biometrics would lock the owner out of their own notes.
 */
const DEVICE_LOCAL_SETTING_KEYS = ['appLockEnabled', 'biometricEnabled'];

export interface BackupSummary {
    formatVersion: number;
    createdAt?: string;
    peopleCount: number;
    journalCount: number;
    entryCount: number;
    mediaCount: number;
    avatarCount: number;
    /** Media referenced by a note but absent from the archive. */
    missingMedia: string[];
}

export interface CreatedBackup extends BackupSummary {
    /** file:// uri of the archive inside the app cache. */
    uri: string;
    fileName: string;
    size: number;
}

export interface BackupSession {
    kind: 'archive' | 'legacy';
    /** Extraction directory (archive only). */
    dir?: string;
    /** Parsed data.json (archive only). */
    payload?: any;
    /** Parsed legacy JSON export (legacy only). */
    legacy?: any;
    summary: BackupSummary;
}

/** The native zip engine wants plain paths, not `file://` URIs. */
function stripScheme(path: string): string {
    return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

function fileNameOf(uri: string): string {
    const clean = stripScheme(uri).split('?')[0];
    return clean.substring(clean.lastIndexOf('/') + 1);
}

async function ensureDirectory(dir: string): Promise<void> {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
}

async function removeDirectory(dir: string): Promise<void> {
    await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => { });
}

function cacheRoot(): string {
    return FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
}

function collectMediaRefs(contents: string[]): string[] {
    const refs = new Set<string>();
    for (const content of contents) {
        if (!content) continue;
        const matches = content.match(MEDIA_REF_PATTERN);
        if (!matches) continue;
        for (const match of matches) refs.add(match);
    }
    return [...refs];
}

/**
 * Builds the backup container and returns the archive path.
 *
 * The staging folder is always cleaned up, even when zipping fails.
 */
export async function createBackup(): Promise<CreatedBackup> {
    const zipper = getZipArchive();
    if (!zipper) {
        throw new Error('Backup needs a newer build of Melnote. Update the app and try again.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `melnote-backup-${stamp.slice(0, 19)}${BACKUP_EXTENSION}`;
    const root = cacheRoot();
    const staging = `${root}melnote-staging-${Date.now()}/`;
    const archivePath = `${root}${fileName}`;

    await removeDirectory(staging);
    await ensureDirectory(`${staging}media`);
    await ensureDirectory(`${staging}avatars`);

    try {
        const payload = await DataRepository.exportAllData({ embedAvatars: false });
        const people: any[] = payload?.data?.people ?? [];
        const journals: any[] = payload?.data?.journals ?? [];
        const entries: any[] = payload?.data?.entries ?? [];

        // The lock settings stay on this device - they are not written to the
        // archive at all.
        if (payload?.data?.settings) {
            const exportedSettings: Record<string, string> = { ...payload.data.settings };
            for (const key of DEVICE_LOCAL_SETTING_KEYS) delete exportedSettings[key];
            payload.data.settings = exportedSettings;
        }

        // Avatars travel as files, so the rows only keep a relative name.
        // The picker leaves avatars in the (volatile) cache directory, so each
        // one is copied out under a name that cannot collide.
        const avatarNames = new Set<string>();
        let avatarCount = 0;
        for (const person of people) {
            if (!person.avatarUri) continue;
            const sourceUri = person.avatarUri as string;
            const rawName = fileNameOf(sourceUri);
            if (!rawName) {
                person.avatarUri = null;
                continue;
            }
            const name = `avatar_${person.id ?? avatarNames.size}_${rawName}`.replace(/[^A-Za-z0-9_.-]/g, '_');
            try {
                await FileSystem.copyAsync({ from: sourceUri, to: `${staging}avatars/${name}` });
            } catch {
                // The picked file is gone (cache cleared) - drop the dangling
                // reference instead of archiving a broken avatar.
                person.avatarUri = null;
                continue;
            }
            avatarNames.add(name);
            person.avatarUri = `avatars/${name}`;
            avatarCount++;
        }

        const mediaNames: string[] = [];
        for (const ref of await listMediaRefs()) {
            const name = ref.slice(MEDIA_REF_PREFIX.length);
            const info = await FileSystem.getInfoAsync(`${MEDIA_DIRECTORY}${name}`);
            if (!info.exists) continue;
            await FileSystem.copyAsync({ from: `${MEDIA_DIRECTORY}${name}`, to: `${staging}media/${name}` });
            mediaNames.push(name);
        }

        const referenced = collectMediaRefs([
            ...journals.map(j => j.content ?? ''),
            ...entries.map(e => e.content ?? ''),
        ]);
        const missingMedia = referenced.filter(
            ref => !mediaNames.includes(ref.slice(MEDIA_REF_PREFIX.length))
        );

        const manifest = {
            format: BACKUP_FORMAT,
            formatVersion: BACKUP_VERSION,
            appVersion: Constants.expoConfig?.version ?? '0.5.0',
            createdAt: new Date().toISOString(),
            counts: {
                people: people.length,
                journals: journals.length,
                entries: entries.length,
                media: mediaNames.length,
                avatars: avatarCount,
            },
            media: mediaNames,
            avatars: [...avatarNames],
            missingMedia,
        };

        await FileSystem.writeAsStringAsync(
            `${staging}manifest.json`,
            JSON.stringify(manifest, null, 2),
            { encoding: 'utf8' }
        );
        await FileSystem.writeAsStringAsync(`${staging}data.json`, JSON.stringify(payload), {
            encoding: 'utf8',
        });

        await FileSystem.deleteAsync(archivePath, { idempotent: true }).catch(() => { });
        await zipper.zip(stripScheme(staging), stripScheme(archivePath));

        const info = await FileSystem.getInfoAsync(archivePath);
        const size = info.exists && 'size' in info ? Number((info as any).size) || 0 : 0;

        return {
            uri: `file://${archivePath}`,
            fileName,
            size,
            formatVersion: BACKUP_VERSION,
            createdAt: manifest.createdAt,
            peopleCount: people.length,
            journalCount: journals.length,
            entryCount: entries.length,
            mediaCount: mediaNames.length,
            avatarCount,
            missingMedia,
        };
    } finally {
        await removeDirectory(staging);
    }
}

/**
 * Opens a backup file without touching the database, so the UI can show what
 * is inside before the user commits to a restore.
 */
export async function openBackup(fileUri: string): Promise<BackupSession> {
    const root = cacheRoot();
    const dir = `${root}melnote-restore-${Date.now()}/`;

    let extracted = false;
    try {
        const zipper = getZipArchive();
        if (!zipper) throw new Error('Backup needs a newer build of Melnote. Update the app and try again.');
        await ensureDirectory(dir);
        await zipper.unzip(stripScheme(fileUri), stripScheme(dir));
        extracted = true;
    } catch {
        extracted = false;
    }

    if (extracted) {
        try {
            const manifestRaw = await FileSystem.readAsStringAsync(`${dir}manifest.json`);
            const manifest = JSON.parse(manifestRaw);
            if (manifest?.format !== BACKUP_FORMAT) {
                throw new Error('This archive is not a Melnote backup.');
            }
            if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BACKUP_VERSION) {
                throw new Error(
                    `This backup was made by a newer version of Melnote (format ${manifest.formatVersion}).`
                );
            }

            const payload = JSON.parse(await FileSystem.readAsStringAsync(`${dir}data.json`));
            const people: any[] = payload?.data?.people ?? [];
            const journals: any[] = payload?.data?.journals ?? [];
            const entries: any[] = payload?.data?.entries ?? [];
            const media: string[] = Array.isArray(manifest.media) ? manifest.media : [];

            return {
                kind: 'archive',
                dir,
                payload,
                summary: {
                    formatVersion: manifest.formatVersion,
                    createdAt: manifest.createdAt,
                    peopleCount: people.length,
                    journalCount: journals.length,
                    entryCount: entries.length,
                    mediaCount: media.length,
                    avatarCount: Array.isArray(manifest.avatars) ? manifest.avatars.length : 0,
                    missingMedia: Array.isArray(manifest.missingMedia) ? manifest.missingMedia : [],
                },
            };
        } catch (error: any) {
            await removeDirectory(dir);
            throw error;
        }
    }

    await removeDirectory(dir);

    // Not a zip container - fall back to the legacy JSON export format.
    try {
        const raw = await FileSystem.readAsStringAsync(fileUri);
        const legacy = JSON.parse(raw);
        if (!legacy || typeof legacy !== 'object') {
            throw new Error('The backup file is empty.');
        }
        const data = legacy.data ?? legacy;
        return {
            kind: 'legacy',
            legacy,
            summary: {
                formatVersion: 1,
                createdAt: legacy.exportedAt,
                peopleCount: data.people?.length ?? 0,
                journalCount: data.journals?.length ?? 0,
                entryCount: data.entries?.length ?? 0,
                mediaCount: 0,
                avatarCount: 0,
                missingMedia: [],
            },
        };
    } catch (legacyError: any) {
        throw new Error(legacyError?.message || 'This file is not a valid Melnote backup.');
    }
}

/** Releases the extraction folder of a session. */
export async function closeBackup(session: BackupSession | null): Promise<void> {
    if (session?.kind === 'archive' && session.dir) {
        await removeDirectory(session.dir);
    }
}

/**
 * Restores a session: assets first, then the database in a single transaction,
 * then the leftovers are swept. If the database step fails the app keeps the
 * data it had.
 */
export async function restoreBackup(session: BackupSession): Promise<BackupSummary> {
    if (session.kind === 'legacy') {
        await DataRepository.importData(session.legacy);
        return session.summary;
    }

    const dir = session.dir;
    const payload = session.payload;
    if (!dir || !payload) throw new Error('This backup session is no longer valid.');

    const people: any[] = payload?.data?.people ?? [];
    const createdAvatars: string[] = [];
    const restoredAvatars = new Set<string>();

    try {
        await ensureDirectory(AVATARS_DIRECTORY);

        for (const person of people) {
            if (!person.avatarUri || !person.avatarUri.startsWith('avatars/')) continue;
            const name = fileNameOf(person.avatarUri);
            const source = `${dir}avatars/${name}`;
            const destination = `${AVATARS_DIRECTORY}${name}`;

            const sourceInfo = await FileSystem.getInfoAsync(source);
            if (!sourceInfo.exists) {
                person.avatarUri = null;
                continue;
            }

            const destinationInfo = await FileSystem.getInfoAsync(destination);
            if (!destinationInfo.exists) createdAvatars.push(destination);

            await FileSystem.copyAsync({ from: source, to: destination });
            person.avatarUri = destination;
            restoredAvatars.add(name);
        }

        // Media keeps its relative reference in the markdown, so restoring is a
        // plain file copy.
        const archiveMedia: string[] = [];
        const mediaDir = `${dir}media`;
        const mediaInfo = await FileSystem.getInfoAsync(mediaDir);
        if (mediaInfo.exists) {
            const names = await FileSystem.readDirectoryAsync(mediaDir);
            for (const name of names) {
                if (name.startsWith('.')) continue;
                await FileSystem.copyAsync({ from: `${mediaDir}/${name}`, to: `${MEDIA_DIRECTORY}${name}` });
                archiveMedia.push(name);
            }
        }

        await DataRepository.importData(payload);

        // The restore replaces everything, so media that the backup did not
        // carry is stale and gets removed.
        for (const ref of await listMediaRefs()) {
            const name = ref.slice(MEDIA_REF_PREFIX.length);
            if (!archiveMedia.includes(name)) {
                await deleteMediaRef(ref);
            }
        }

        // Same for avatars that belonged to people the backup does not carry.
        try {
            const avatarNames = await FileSystem.readDirectoryAsync(AVATARS_DIRECTORY);
            for (const name of avatarNames) {
                if (name.startsWith('.') || restoredAvatars.has(name)) continue;
                await FileSystem.deleteAsync(`${AVATARS_DIRECTORY}${name}`, { idempotent: true });
            }
        } catch {
            // No avatars folder yet - nothing to sweep.
        }

        const settings = payload?.data?.settings;
        if (settings && typeof settings === 'object') {
            // The lock settings were never exported, so the device's current
            // values are carried over into the restored table.
            const current = await SettingsRepository.getAll();
            const restored = { ...settings };
            for (const key of DEVICE_LOCAL_SETTING_KEYS) {
                if (current[key] !== undefined) restored[key] = current[key];
                else delete restored[key];
            }
            await SettingsRepository.replaceAll(restored);
        }

        return session.summary;
    } catch (error) {
        for (const uri of createdAvatars) {
            await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => { });
        }
        throw error;
    } finally {
        await removeDirectory(dir);
    }
}
