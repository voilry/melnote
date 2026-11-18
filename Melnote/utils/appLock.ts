import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { logError } from './errorLog';

/**
 * The rules of the app lock, without any React in them.
 *
 * Where the passcode lives, how long wrong attempts are punished, how the
 * device's biometrics are talked to and how long the app may stay away before
 * it locks again. Keeping all of that here means the lock screen and the
 * settings screen agree on what "locked" means, and that the rules can be
 * changed in one place.
 */

/** SecureStore key that holds the app passcode. */
export const APP_PIN_KEY = 'melnote_app_pin';

/** The passcode is always this many digits. */
export const PIN_LENGTH = 4;

/**
 * How long the lock screen refuses passcode attempts after N wrong tries.
 *
 * A four digit passcode is only ten thousand combinations, so without a
 * penalty somebody who can see the screen can simply try them all. The
 * penalty grows with every further failure and then stops growing, so an
 * owner who forgot their passcode is never locked out for good.
 *
 * Index 0 is "no failures yet". The first four wrong passcodes are free,
 * the fifth one costs half a minute.
 */
const LOCKOUT_STEPS_MS = [0, 0, 0, 0, 0, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

/** The longest a wrong passcode is ever punished. */
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

/** How long the app may be away before it locks again, in seconds. */
export const APP_LOCK_TIMEOUTS: ReadonlyArray<{ label: string; short: string; seconds: number }> = [
    { label: 'Immediately', short: 'Immediately', seconds: 0 },
    { label: 'After 30 seconds', short: '30 seconds', seconds: 30 },
    { label: 'After 1 minute', short: '1 minute', seconds: 60 },
    { label: 'After 5 minutes', short: '5 minutes', seconds: 300 },
    { label: 'After 15 minutes', short: '15 minutes', seconds: 900 },
];

/**
 * The default grace period.
 *
 * Half a minute is long enough that a short trip out - reading a message,
 * answering a permission prompt, checking a calendar - does not cost the
 * owner their place, and short enough that walking away still locks the app.
 */
export const DEFAULT_APP_LOCK_TIMEOUT_SECONDS = 30;

/** The penalty for `failedAttempts` wrong passcodes, in milliseconds. */
export function lockoutDurationFor(failedAttempts: number): number {
    const attempts = Math.max(0, Math.floor(failedAttempts));
    if (attempts < LOCKOUT_STEPS_MS.length) return LOCKOUT_STEPS_MS[attempts];
    return MAX_LOCKOUT_MS;
}

// ---------------------------------------------------------------------------
// The passcode
// ---------------------------------------------------------------------------

export type StoredPin =
    | { status: 'ok'; pin: string }
    /** There is no passcode stored. */
    | { status: 'missing' }
    /** The secure storage could not be read. */
    | { status: 'error' };

/**
 * The passcode as it was last read.
 *
 * Reading the phone's secure storage is slow on Android - every read goes
 * through the key store - and the lock screen has to answer a passcode the
 * instant the last digit is typed. Waiting for the key store there is what
 * makes the unlock feel sluggish, so the passcode is kept in memory and the
 * storage is only touched when the passcode is created, changed or removed.
 */
let cachedPin: string | null = null;

export async function readStoredPin(): Promise<StoredPin> {
    if (cachedPin !== null) return { status: 'ok', pin: cachedPin };

    try {
        const value = await SecureStore.getItemAsync(APP_PIN_KEY);
        if (!value) return { status: 'missing' };
        cachedPin = value;
        return { status: 'ok', pin: value };
    } catch (error) {
        logError(error, 'js');
        return { status: 'error' };
    }
}

/** Stores the passcode. Returns false when the secure storage refused it. */
export async function writeStoredPin(pin: string): Promise<boolean> {
    try {
        await SecureStore.setItemAsync(APP_PIN_KEY, pin);
        cachedPin = pin;
        return true;
    } catch (error) {
        logError(error, 'js');
        return false;
    }
}

export async function clearStoredPin(): Promise<void> {
    cachedPin = null;
    try {
        await SecureStore.deleteItemAsync(APP_PIN_KEY);
    } catch (error) {
        logError(error, 'js');
    }
}

/**
 * Compares two passcodes without giving away how many leading characters
 * matched. The difference cannot be measured on a device, but it costs
 * nothing to not leak it.
 */
export function pinMatches(input: string, stored: string): boolean {
    if (input.length !== stored.length) return false;

    let difference = 0;
    for (let index = 0; index < input.length; index++) {
        difference |= input.charCodeAt(index) ^ stored.charCodeAt(index);
    }
    return difference === 0;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * A small channel so a screen that is not the lock screen can still tell the
 * lock what to do - today that is the "Lock now" button in the settings.
 */
export type LockCommand = 'lock-now';

type LockCommandListener = (command: LockCommand) => void;

const commandListeners = new Set<LockCommandListener>();

/** Asks the lock to do something. Never throws. */
export function sendLockCommand(command: LockCommand): void {
    commandListeners.forEach(listener => {
        try {
            listener(command);
        } catch (error) {
            logError(error, 'js');
        }
    });
}

/** Listens for commands. Returns the function that stops listening. */
export function onLockCommand(listener: LockCommandListener): () => void {
    commandListeners.add(listener);
    return () => {
        commandListeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// Biometrics
// ---------------------------------------------------------------------------

export type BiometricOutcome =
    | 'success'
    | 'cancelled'
    | 'unavailable'
    | 'locked-out'
    | 'error';

export interface BiometricAvailability {
    /** There is hardware and something is enrolled on it. */
    usable: boolean;
    enrolled: boolean;
    hasFace: boolean;
    hasFingerprint: boolean;
}

const NO_BIOMETRICS: BiometricAvailability = {
    usable: false,
    enrolled: false,
    hasFace: false,
    hasFingerprint: false,
};

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
    try {
        const [hasHardware, enrolled, types] = await Promise.all([
            LocalAuthentication.hasHardwareAsync(),
            LocalAuthentication.isEnrolledAsync(),
            LocalAuthentication.supportedAuthenticationTypesAsync()
                .catch((): LocalAuthentication.AuthenticationType[] => []),
        ]);

        return {
            usable: hasHardware && enrolled,
            enrolled,
            hasFace: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
            hasFingerprint: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
        };
    } catch {
        return NO_BIOMETRICS;
    }
}

/**
 * Asks the device who the owner is.
 *
 * The phone's own passcode is deliberately not offered as a fallback: Melnote
 * has its own passcode, and quietly accepting the phone's would downgrade it
 * to whatever the phone happens to use. The passcode keypad is right there.
 */
export async function authenticateBiometric(promptMessage: string): Promise<BiometricOutcome> {
    try {
        const availability = await getBiometricAvailability();
        if (!availability.usable) return 'unavailable';

        const result = await LocalAuthentication.authenticateAsync({
            promptMessage,
            cancelLabel: 'Cancel',
            disableDeviceFallback: true,
        });

        if (result.success) return 'success';

        switch (result.error) {
            case 'user_cancel':
            case 'app_cancel':
            case 'system_cancel':
            case 'user_fallback':
                return 'cancelled';
            case 'not_available':
            case 'not_enrolled':
            case 'passcode_not_set':
                return 'unavailable';
            case 'lockout':
                return 'locked-out';
            default:
                return 'error';
        }
    } catch (error) {
        logError(error, 'js');
        return 'error';
    }
}
