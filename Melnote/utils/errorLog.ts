import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * On-device error log + bug-report email builder.
 *
 * Why this exists: a release build has no console, so "the app broke" arrives
 * with no evidence. This keeps a small history of JS errors on the device and
 * puts it into an email the user chooses to send. Nothing leaves the device on
 * its own and nothing is ever uploaded.
 *
 * Hard rules:
 *  - never throws and never changes app behaviour; every failure is ignored;
 *  - never stores stacks, objects, note text or journal text;
 *  - bounded: MAX_ENTRIES, MAX_MESSAGE_CHARS and MAX_FILE_BYTES;
 *  - entries older than MAX_AGE_DAYS are dropped on load, on write and on read;
 *  - no-op persistence where there is no app filesystem (web).
 *
 * Captured: uncaught JS errors (fatal and non-fatal), unhandled promise
 * rejections (release only — RN already reports them in dev), and
 * console.error calls. Native (Java/C++) crashes and errors inside the journal
 * WebView cannot be seen from JS and are therefore not captured.
 */

const LOG_DIR_NAME = 'diagnostics';
const LOG_FILE_NAME = 'errors.ndjson';

const MAX_ENTRIES = 150;
const MAX_AGE_DAYS = 7;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const MAX_MESSAGE_CHARS = 400;
const MAX_FILE_BYTES = 96 * 1024;
const MAX_REPORT_LOG_CHARS = 2500;
const DEDUPE_WINDOW_MS = 3000; // same message in a loop -> one entry
const DEDUPE_CACHE_SIZE = 32;

type ErrorLogSource = 'js' | 'promise' | 'console' | 'webview' | 'manual';
type ErrorLogLevel = 'error' | 'fatal';

interface ErrorLogEntry {
    /** ISO timestamp (UTC; formatted to local time in the email). */
    t: string;
    lvl: ErrorLogLevel;
    src: ErrorLogSource;
    /** Sanitised, single-line, <= MAX_MESSAGE_CHARS. */
    msg: string;
    /** App version at the time of the error, so old entries stay honest. */
    v: string;
}

export interface DeviceInfo {
    appVersion: string;
    buildNumber: string;
    deviceModel: string;
    osVersion: string;
}

let initialized = false;
let writing = false;

/** Bookkeeping for the file on disk, so the caps can be enforced cheaply. */
let diskEntryCount = 0;
let diskOldestAt = 0;

/** Kept even if the filesystem write fails, so this session is still reportable. */
const memoryEntries: ErrorLogEntry[] = [];
const recentMessages = new Map<string, number>();

// ---------------------------------------------------------------------------
// App / device identity (no extra permission-gated APIs)
// ---------------------------------------------------------------------------

let cachedIdentity: { version: string; build: string } | null = null;

function appIdentity(): { version: string; build: string } {
    if (cachedIdentity) return cachedIdentity;

    let version = 'unknown';
    let build = 'unknown';

    try {
        version = Application.nativeApplicationVersion || Constants.expoConfig?.version || 'unknown';
    } catch {
        // ignore
    }

    try {
        const installed = Application.nativeBuildVersion;
        const configured = Platform.OS === 'android'
            ? Constants.expoConfig?.android?.versionCode
            : Constants.expoConfig?.ios?.buildNumber;
        build = installed || (configured != null && configured !== '' ? String(configured) : 'unknown');
    } catch {
        // ignore
    }

    cachedIdentity = { version, build };
    return cachedIdentity;
}

export function getDeviceInfo(): DeviceInfo {
    const { version, build } = appIdentity();

    let deviceModel = 'unknown';
    let osVersion = `${Platform.OS} ${String(Platform.Version)}`;

    try {
        if (Platform.OS === 'android') {
            const constants: any = Platform.constants || {};
            const manufacturer = typeof constants.Manufacturer === 'string' ? constants.Manufacturer.trim() : '';
            const model = typeof constants.Model === 'string' ? constants.Model.trim() : '';
            deviceModel = [manufacturer, model].filter(Boolean).join(' ') || 'Android device';
            osVersion = `Android ${constants.Release || ''}${constants.Version ? ` (API ${constants.Version})` : ''}`.trim();
        } else if (Platform.OS === 'ios') {
            const constants: any = Platform.constants || {};
            const idiom = typeof constants.interfaceIdiom === 'string' ? constants.interfaceIdiom : '';
            deviceModel = idiom === 'pad' ? 'iPad' : 'iPhone';
            osVersion = `iOS ${constants.osVersion || Platform.Version}`;
        }
    } catch {
        // keep the fallbacks
    }

    return {
        appVersion: version,
        buildNumber: build,
        deviceModel,
        osVersion,
    };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function logFile(): File | null {
    try {
        // The new expo-file-system API is synchronous, which matters: a fatal
        // error may terminate the process right after the global handler
        // returns, so the entry has to reach the disk before that.
        if (Platform.OS === 'web') return null;

        const dir = new Directory(Paths.document, LOG_DIR_NAME);
        try {
            // idempotent: true makes this a no-op once the folder exists.
            dir.create({ intermediates: true, idempotent: true });
        } catch {
            // Never let a folder problem disable logging entirely: the file
            // write below creates whatever it needs.
        }
        return new File(dir, LOG_FILE_NAME);
    } catch {
        return null;
    }
}

function isEntry(value: any): value is ErrorLogEntry {
    return !!value
        && typeof value.t === 'string'
        && typeof value.msg === 'string'
        && typeof value.src === 'string'
        && typeof value.lvl === 'string'
        && typeof value.v === 'string';
}

function parseEntries(raw: string): ErrorLogEntry[] {
    const entries: ErrorLogEntry[] = [];
    if (!raw) return entries;

    for (const line of raw.split('\n')) {
        if (!line) continue;
        try {
            const parsed = JSON.parse(line);
            if (isEntry(parsed)) entries.push(parsed);
        } catch {
            // A torn line from a crash mid-write: skip it, keep the rest.
        }
    }

    return entries;
}

function updateDiskCounters(entries: ErrorLogEntry[]): void {
    diskEntryCount = entries.length;

    let oldest = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
        const time = Date.parse(entry.t);
        if (Number.isFinite(time) && time < oldest) oldest = time;
    }
    diskOldestAt = Number.isFinite(oldest) ? oldest : 0;
}

function readFromDisk(): ErrorLogEntry[] {
    const file = logFile();
    if (!file) return [];

    try {
        if (!file.exists) return [];

        const entries = parseEntries(file.textSync());
        updateDiskCounters(entries);
        return entries;
    } catch {
        return [];
    }
}

function prune(entries: ErrorLogEntry[]): ErrorLogEntry[] {
    const cutoff = Date.now() - MAX_AGE_MS;

    const fresh = entries.filter((entry) => {
        const time = Date.parse(entry.t);
        return Number.isFinite(time) && time >= cutoff;
    });

    fresh.sort((a, b) => (Date.parse(a.t) || 0) - (Date.parse(b.t) || 0));
    return fresh.length > MAX_ENTRIES ? fresh.slice(fresh.length - MAX_ENTRIES) : fresh;
}

function compact(): void {
    const file = logFile();
    if (!file) return;

    try {
        const raw = file.exists ? (file.textSync() || '') : '';
        const kept = prune(parseEntries(raw));
        updateDiskCounters(kept);

        const text = kept.map((entry) => JSON.stringify(entry)).join('\n');
        const next = text ? `${text}\n` : '';

        // Only touch the file when something actually has to change.
        if (next !== raw) file.write(next, { encoding: 'utf8' });
    } catch {
        // Logging is best-effort; never surface this.
    }
}

function appendToDisk(entry: ErrorLogEntry): void {
    const file = logFile();
    if (!file) return;

    try {
        // Append is O(1); compaction happens only when a cap is reached.
        file.write(`${JSON.stringify(entry)}\n`, { encoding: 'utf8', append: true });
        diskEntryCount += 1;

        const stale = diskOldestAt > 0 && Date.now() - diskOldestAt > MAX_AGE_MS;
        if (diskEntryCount > MAX_ENTRIES || stale || file.size > MAX_FILE_BYTES) {
            compact();
        }
    } catch {
        // ignore
    }
}

function allEntries(): ErrorLogEntry[] {
    const seen = new Set<string>();
    const merged: ErrorLogEntry[] = [];

    for (const entry of [...readFromDisk(), ...memoryEntries]) {
        const key = `${entry.t}|${entry.msg}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
    }

    return prune(merged);
}

// ---------------------------------------------------------------------------
// Sanitising (the privacy boundary)
// ---------------------------------------------------------------------------

function describe(value: unknown): string {
    if (value == null) return '';

    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    // console.error('label', err) arrives as an array.
    if (Array.isArray(value)) {
        return value.slice(0, 6).map(describe).filter(Boolean).join(' ');
    }

    if (typeof value === 'object') {
        const error = value as any;
        const message = typeof error.message === 'string' ? error.message : '';
        if (message) {
            const name = typeof error.name === 'string' && error.name !== 'Error' ? error.name : '';
            return name ? `${name}: ${message}` : message;
        }

        // Deliberately do not serialise objects: they routinely carry note or
        // journal content (document JSON, entry rows, editor state).
        return '[object]';
    }

    return '';
}

function sanitize(input: string): string {
    let text = String(input).replace(/\u0000/g, ' ').trim();

    // Error messages are one line. Anything after the first line is either a
    // stack or dumped content, and note/journal text is usually multi-line.
    const newline = text.search(/[\r\n]/);
    if (newline >= 0) text = `${text.slice(0, newline)} …`;

    text = text.replace(/\s+/g, ' ').trim();

    // Redact payloads that can carry user content:
    //  - long quoted strings (editors quote the document in errors)
    //  - a JSON/HTML blob: everything from the opening brace/angle bracket on
    //  - data URIs and long base64-ish runs
    text = text
        .replace(/data:[^\s"'<>]{24,}/gi, '[data]')
        .replace(/(["'“”‘’])[^"'“”‘’]{40,}\1/g, '$1[text]$1')
        .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[blob]')
        .replace(/\{.{80,}/s, '[object]')
        .replace(/<.{80,}/s, '[markup]')
        .replace(/\s+/g, ' ')
        .trim();

    if (text.length > MAX_MESSAGE_CHARS) {
        text = `${text.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}…`;
    }

    return text;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function isDuplicate(message: string): boolean {
    const now = Date.now();
    const last = recentMessages.get(message);

    if (last != null && now - last < DEDUPE_WINDOW_MS) return true;

    if (recentMessages.size >= DEDUPE_CACHE_SIZE) {
        for (const [key, at] of recentMessages) {
            if (now - at >= DEDUPE_WINDOW_MS) recentMessages.delete(key);
        }
    }
    recentMessages.set(message, now);
    return false;
}

/**
 * Record one error. Safe to call from anywhere, including inside React's error
 * handler: it swallows every failure and never rethrows.
 */
export function logError(
    error: unknown,
    source: ErrorLogSource = 'js',
    level: ErrorLogLevel = 'error',
): void {
    if (writing) return; // a log call must never recurse into itself

    try {
        writing = true;

        const message = sanitize(describe(error));
        if (!message) return;
        if (isDuplicate(message)) return;

        const entry: ErrorLogEntry = {
            t: new Date().toISOString(),
            lvl: level,
            src: source,
            msg: message,
            v: appIdentity().version,
        };

        memoryEntries.push(entry);
        if (memoryEntries.length > MAX_ENTRIES) memoryEntries.shift();

        appendToDisk(entry);
    } catch {
        // Never let diagnostics break the app.
    } finally {
        writing = false;
    }
}

function installGlobalHandler(): void {
    try {
        const errorUtils = (globalThis as any).ErrorUtils;
        if (!errorUtils || typeof errorUtils.setGlobalHandler !== 'function') return;
        if (errorUtils.__melnoteErrorLog) return; // Fast Refresh / double import

        const previous = typeof errorUtils.getGlobalHandler === 'function'
            ? errorUtils.getGlobalHandler()
            : null;

        errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
            try {
                logError(error, 'js', isFatal ? 'fatal' : 'error');
            } catch {
                // ignore
            }

            // Preserve RN's own behaviour (redbox in dev, crash in release).
            if (typeof previous === 'function') previous(error, isFatal);
        });

        errorUtils.__melnoteErrorLog = true;
    } catch {
        // ignore
    }
}

function installConsoleHook(): void {
    try {
        if (typeof console === 'undefined' || typeof console.error !== 'function') return;

        const current = console.error as any;
        if (current.__melnoteErrorLog) return;

        const wrapped = function (this: any, ...args: any[]) {
            try {
                logError(args, 'console');
            } catch {
                // ignore
            }
            return current.apply(this, args);
        };

        wrapped.__melnoteErrorLog = true;
        console.error = wrapped as any;
    } catch {
        // ignore
    }
}

function installPromiseTracker(): void {
    try {
        // In dev RN already enables a tracker that reports through
        // console.error, so our hook sees those. Installing ours would replace
        // RN's and change dev behaviour, so only do it in release.
        if (__DEV__) return;

        const hermes = (globalThis as any).HermesInternal;
        if (!hermes || typeof hermes.enablePromiseRejectionTracker !== 'function') return;

        hermes.enablePromiseRejectionTracker({
            // With allRejections, Hermes still waits before reporting, so a
            // rejection that gets handled is never logged.
            allRejections: true,
            onUnhandled: (_id: number, rejection: unknown) => {
                try {
                    logError(rejection, 'promise');
                } catch {
                    // ignore
                }
            },
            onHandled: () => {
                // Nothing to clear: entries are written only from onUnhandled.
            },
        });
    } catch {
        // ignore
    }
}

/**
 * Install capture hooks and drop stale entries. Call once, as early as
 * possible (module load of the root layout). Idempotent.
 */
export function initErrorLog(): void {
    if (initialized) return;
    initialized = true;

    try {
        compact();
    } catch {
        // ignore
    }

    installGlobalHandler();
    installConsoleHook();
    installPromiseTracker();

    // Manual trigger for QA in a dev build. Not a UI feature.
    if (__DEV__) {
        try {
            (globalThis as any).__melnoteErrorLogTest = (message = 'Melnote test error') => {
                logError(new Error(String(message)), 'manual');
            };
        } catch {
            // ignore
        }
    }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad2(value: number): string {
    return value < 10 ? `0${value}` : String(value);
}

function formatTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
        + `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export interface BugReport {
    subject: string;
    body: string;
    errorCount: number;
}

export function buildBugReport(): BugReport {
    const info = getDeviceInfo();
    const entries = allEntries().slice().reverse(); // newest first

    const lines: string[] = [];
    let used = 0;

    for (const entry of entries) {
        const line = `${formatTime(entry.t)}  ${entry.lvl === 'fatal' ? 'CRASH' : 'ERROR'}  [${entry.src}] ${entry.msg}`;
        if (used + line.length + 1 > MAX_REPORT_LOG_CHARS) break;
        lines.push(line);
        used += line.length + 1;
    }

    // How many entries came from each source, so noisy sources are obvious
    // without reading every line.
    const bySource: Record<string, number> = {};
    for (const entry of entries) {
        bySource[entry.src] = (bySource[entry.src] || 0) + 1;
    }
    const sourceSummary = Object.keys(bySource)
        .sort()
        .map((source) => `${source} ${bySource[source]}`)
        .join(', ');

    const notShown = entries.length - lines.length;
    const logSection = lines.length
        ? [
            `${entries.length} error${entries.length === 1 ? '' : 's'} in the last ${MAX_AGE_DAYS} days (newest first).`,
            `Sources: ${sourceSummary}.`,
            '',
            ...lines,
            notShown > 0 ? `\n...and ${notShown} older error(s) left out to keep the email small.` : '',
        ].join('\n')
        : `No errors were recorded in the last ${MAX_AGE_DAYS} days.`;

    const body = [
        'Hello,',
        '',
        'I want to report a problem with Melnote.',
        '',
        'What happened:',
        '(describe it here)',
        '',
        '--- App info ---',
        `App version: ${info.appVersion}`,
        `Build number: ${info.buildNumber}`,
        `Device: ${info.deviceModel}`,
        `OS version: ${info.osVersion}`,
        '',
        '--- Recent errors (device log) ---',
        logSection,
        '',
        'This log lives only on this device. It is included because I chose to send this email.',
    ].join('\n');

    return {
        subject: `Melnote bug report - v${info.appVersion} (${info.buildNumber}) - ${info.osVersion}`,
        body,
        errorCount: entries.length,
    };
}

/**
 * Build a mailto: URL that already contains the report. Never throws: if the
 * log cannot be read, the mail still opens with the device/version info.
 *
 * Pass a previously built report to send exactly what the user previewed.
 */
export function buildBugReportMailto(email: string, report?: BugReport): string {
    let subject = 'Melnote bug report';
    let body = 'Melnote bug report: describe the problem here.';

    try {
        const built = report || buildBugReport();
        subject = built.subject;
        body = built.body;
    } catch {
        try {
            const info = getDeviceInfo();
            subject = `Melnote bug report - v${info.appVersion} (${info.buildNumber})`;
            body = [
                'I want to report a problem with Melnote.',
                '',
                `App version: ${info.appVersion}`,
                `Build number: ${info.buildNumber}`,
                `Device: ${info.deviceModel}`,
                `OS version: ${info.osVersion}`,
            ].join('\n');
        } catch {
            // keep the bare fallback above
        }
    }

    const address = (email || '').trim();
    return `mailto:${address}?`
        + `subject=${encodeURIComponent(subject)}&`
        + `body=${encodeURIComponent(body)}`;
}
