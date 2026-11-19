import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, AppStateStatus } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useSettings } from '../store/SettingsContext';
import { showToast } from '../components/ui/Toast';
import { logError } from '../utils/errorLog';
import { consumeExternalResume } from '../utils/externalActivity';
import {
    DEFAULT_APP_LOCK_TIMEOUT_SECONDS,
    PIN_LENGTH,
    authenticateBiometric,
    clearStoredPin,
    getBiometricAvailability,
    lockoutDurationFor,
    onLockCommand,
    pinMatches,
    readStoredPin,
} from '../utils/appLock';

export interface AppLockController {
    /** The lock is on and nobody has authenticated since it was armed. */
    locked: boolean;
    /** The lock screen is on screen. Only true while the app is in front. */
    presented: boolean;
    /** The passcode that has been typed so far. */
    pinInput: string;
    /** True while the unlock animation plays. */
    unlocking: boolean;
    /** Brief cooldown period after a wrong attempt to let the shake and error breathe. */
    isCoolingDown: boolean;
    /** What is written under the title. */
    message: string;
    /** True when the message is a failure rather than a hint. */
    messageIsError: boolean;
    /** Seconds left before passcode attempts are taken again. */
    lockoutSeconds: number;
    /** True when the device has a biometric that is enrolled. */
    biometricsAvailable: boolean;
    /** True when the owner has turned biometric unlock on. */
    biometricEnabled: boolean;
    pressDigit: (digit: string) => void;
    pressBackspace: () => void;
    promptBiometric: () => Promise<void>;
    /** Arms the lock right now. */
    lockNow: () => void;
}

/**
 * The app lock.
 *
 * The rules it follows, and why:
 *
 * - The lock screen is only ever built while the app is in the foreground.
 *   Android pauses the drawing surface of a dialog while another activity is
 *   in front of it, and resuming the activity only restarts the activity's
 *   own surface - not the one inside a dialog. A dialog that survives a trip
 *   to the background comes back blank while still swallowing every touch,
 *   so the lock screen is taken down when the app goes away and built again
 *   when it comes back.
 *
 * - Only a real trip to the background counts. React Native reports the app
 *   as backgrounded while a system panel is open on Android, and iOS reports
 *   it as inactive for the Control Centre, a permission alert or the Face ID
 *   prompt. None of those mean the owner left, so none of them lock.
 *
 * - A system screen Melnote opened itself - the photo picker, the camera, the
 *   document picker, the share sheet - is not the owner leaving. Those are
 *   announced through `utils/externalActivity` and the resume that belongs to
 *   them is skipped.
 *
 * - The biometric prompt is offered once per lock, never on its own twice.
 *   The prompt itself makes the app lose focus, so a prompt that was fired
 *   from the resume handler would fire another one the moment it closed.
 */
export function useAppLock(): AppLockController {
    const { settings, isLoading: settingsLoading, updateSetting } = useSettings();

    const enabled = settings.appLockEnabled;
    const biometricsEnabled = settings.biometricEnabled;
    const timeoutSeconds = Number.isFinite(settings.appLockTimeout)
        ? settings.appLockTimeout
        : DEFAULT_APP_LOCK_TIMEOUT_SECONDS;
    const timeoutMs = Math.max(0, timeoutSeconds) * 1000;

    // --- what the lock screen shows ---------------------------------------
    const [unlocked, setUnlocked] = useState(false);
    const [unlocking, setUnlocking] = useState(false);
    const [isCoolingDown, setIsCoolingDown] = useState(false);
    const [pinInput, setPinInputState] = useState('');
    const [message, setMessage] = useState('');
    const [messageIsError, setMessageIsError] = useState(false);
    const [lockoutUntil, setLockoutUntil] = useState(0);
    const [clock, setClock] = useState(() => Date.now());
    const [biometricsAvailable, setBiometricsAvailable] = useState(false);
    const [active, setActive] = useState(() => AppState.currentState === 'active');

    // --- bookkeeping that has to survive re-renders ------------------------
    const pinRef = useRef('');
    const failedAttempts = useRef(0);
    const pinReadErrors = useRef(0);
    const biometricBusy = useRef(false);
    const biometricOffered = useRef(false);
    const leftApp = useRef(false);
    const backgroundedAt = useRef(0);
    const lockedRef = useRef(false);
    const seeded = useRef(false);
    const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setPin = useCallback((value: string) => {
        pinRef.current = value;
        setPinInputState(value);
    }, []);

    // --- the lock being switched on or off ---------------------------------
    //
    // The settings arrive after the first render, so the switch from "not
    // known yet" to "on" has to be told apart from the owner switching the
    // lock on. The splash screen stays up until the settings are known, so
    // nothing of the app is shown while this is still undecided.
    const [hydrated, setHydrated] = useState(false);
    const [lastEnabled, setLastEnabled] = useState(false);

    if (!settingsLoading && !hydrated) {
        setHydrated(true);
        setLastEnabled(enabled);
    } else if (hydrated && lastEnabled !== enabled) {
        setLastEnabled(enabled);
        if (enabled) {
            // The lock was just switched on. Whoever did it has already proved
            // they are the owner by creating the passcode, so Melnote must not
            // spring the lock screen on top of the settings page.
            setUnlocked(true);
        } else {
            setUnlocked(false);
        }
    }

    // Clearing the passcode is left to an effect: a ref must not be written
    // while rendering, because a render that React throws away would leave
    // the ref and the state disagreeing.
    useEffect(() => {
        if (enabled) return;
        setPin('');
        setMessage('');
        setMessageIsError(false);
    }, [enabled, setPin]);

    // The wrong-passcode count and the waiting time are kept in the settings,
    // so that restarting the app does not wipe the penalty for guessing.
    useEffect(() => {
        if (!hydrated || settingsLoading || seeded.current) return;
        seeded.current = true;

        failedAttempts.current = settings.appLockFailures;
        if (settings.appLockLockedUntil > Date.now()) {
            setLockoutUntil(settings.appLockLockedUntil);
        }
    }, [hydrated, settingsLoading, settings.appLockFailures, settings.appLockLockedUntil]);

    const locked = enabled && !unlocked;
    const presented = locked && active;

    useEffect(() => {
        lockedRef.current = locked;
    }, [locked]);

    useEffect(() => {
        return () => {
            if (unlockTimer.current) clearTimeout(unlockTimer.current);
            if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
        };
    }, []);

    // --- arming and disarming ---------------------------------------------
    const lockNow = useCallback(() => {
        // An unlock that is still playing its success animation must not be
        // able to open the app after it has just been locked again.
        if (unlockTimer.current) {
            clearTimeout(unlockTimer.current);
            unlockTimer.current = null;
        }
        if (cooldownTimer.current) {
            clearTimeout(cooldownTimer.current);
            cooldownTimer.current = null;
        }

        setIsCoolingDown(false);
        setUnlocked(false);
        setUnlocking(false);
        setPin('');
        setMessage('');
        setMessageIsError(false);
        // The failure count and the waiting time are deliberately left alone:
        // walking away from the app must not be a way to shake off the
        // penalty for a wrong passcode.
        // A fresh lock may offer the biometric prompt again.
        biometricOffered.current = false;
    }, [setPin]);

    const completeUnlock = useCallback(() => {
        if (unlockTimer.current) {
            clearTimeout(unlockTimer.current);
            unlockTimer.current = null;
        }
        if (cooldownTimer.current) {
            clearTimeout(cooldownTimer.current);
            cooldownTimer.current = null;
        }

        setIsCoolingDown(false);
        setPin('');
        setMessage('');
        setMessageIsError(false);
        setLockoutUntil(0);
        failedAttempts.current = 0;
        pinReadErrors.current = 0;
        updateSetting('appLockFailures', 0);
        updateSetting('appLockLockedUntil', 0);

        if (settings.hapticsEnabled) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        AccessibilityInfo.announceForAccessibility('Melnote unlocked');

        // Immediately dismiss lock screen
        setUnlocked(true);
        setUnlocking(false);
    }, [setPin, settings.hapticsEnabled, updateSetting]);

    const registerFailure = useCallback((text: string) => {
        failedAttempts.current += 1;
        const count = failedAttempts.current;

        const penalty = lockoutDurationFor(count);
        const until = penalty > 0 ? Date.now() + penalty : 0;
        if (penalty > 0) setLockoutUntil(until);

        // The count and the waiting time are kept in the settings, so that
        // restarting the app is not a way around the penalty.
        updateSetting('appLockFailures', count);
        updateSetting('appLockLockedUntil', until);

        setPin('');
        setMessage(text);
        setMessageIsError(true);
        setIsCoolingDown(true);

        // Give the error shake and message a brief breathe room (~550ms)
        // so fast typing does not instantly dismiss or swallow the error
        if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
        cooldownTimer.current = setTimeout(() => {
            cooldownTimer.current = null;
            setIsCoolingDown(false);
        }, 550);

        if (settings.hapticsEnabled) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }
        AccessibilityInfo.announceForAccessibility(text);
    }, [setPin, settings.hapticsEnabled, updateSetting]);

    // --- the passcode ------------------------------------------------------
    const handleMissingPin = useCallback(async () => {
        // The passcode is gone but the lock is still switched on: the secure
        // storage was cleared, or the key store of the phone was invalidated.
        // There is no way to let the owner back in, and an app that stays
        // locked forever takes their notes with it, so the lock is switched
        // off and they are told what happened.
        logError(new Error('App lock passcode missing; app lock switched off'), 'manual');

        await clearStoredPin();
        updateSetting('appLockEnabled', false);
        updateSetting('biometricEnabled', false);

        setUnlocked(true);
        setUnlocking(false);
        setPin('');
        setMessage('');
        setMessageIsError(false);
        setLockoutUntil(0);
        failedAttempts.current = 0;
        pinReadErrors.current = 0;
        updateSetting('appLockFailures', 0);
        updateSetting('appLockLockedUntil', 0);

        showToast('Your passcode was missing, so App Lock was switched off.');
    }, [setPin, updateSetting]);

    const verifyPin = useCallback(async (candidate: string) => {
        const stored = await readStoredPin();

        if (stored.status === 'missing') {
            await handleMissingPin();
            return;
        }

        if (stored.status === 'error') {
            pinReadErrors.current += 1;
            registerFailure('Could not read the passcode.');
            if (pinReadErrors.current >= 3) {
                // The secure storage cannot be read at all. Trying again will
                // not help, so the lock is switched off rather than leaving
                // the owner locked out of their own notes.
                await handleMissingPin();
            }
            return;
        }

        if (pinMatches(candidate, stored.pin)) {
            completeUnlock();
            return;
        }

        registerFailure('Wrong passcode');
    }, [completeUnlock, handleMissingPin, registerFailure]);

    const pressDigit = useCallback((digit: string) => {
        if (unlocking || isCoolingDown) return;
        if (Date.now() < lockoutUntil) return;

        const next = pinRef.current + digit;
        if (next.length > PIN_LENGTH) return;

        setPin(next);
        if (messageIsError) {
            setMessage('');
            setMessageIsError(false);
        }

        if (next.length === PIN_LENGTH) {
            void verifyPin(next);
        }
    }, [isCoolingDown, lockoutUntil, messageIsError, setPin, unlocking, verifyPin]);

    const pressBackspace = useCallback(() => {
        if (unlocking || isCoolingDown) return;
        if (Date.now() < lockoutUntil) return;

        setPin(pinRef.current.slice(0, -1));
        if (messageIsError) {
            setMessage('');
            setMessageIsError(false);
        }
    }, [isCoolingDown, lockoutUntil, messageIsError, setPin, unlocking]);

    // --- biometrics ---------------------------------------------------------
    const promptBiometric = useCallback(async () => {
        if (biometricBusy.current) return;
        if (!biometricsEnabled) return;

        biometricBusy.current = true;
        try {
            const outcome = await authenticateBiometric('Unlock Melnote');

            if (outcome === 'success') {
                completeUnlock();
                return;
            }

            if (outcome === 'unavailable') {
                // The owner removed their fingerprint or face from the phone.
                updateSetting('biometricEnabled', false);
                setBiometricsAvailable(false);
                setMessage('Biometric unlock is not available. Use your passcode.');
                setMessageIsError(false);
                return;
            }

            if (outcome === 'locked-out') {
                setMessage('Biometrics are locked. Use your passcode.');
                setMessageIsError(false);
                return;
            }

            if (outcome === 'error') {
                setMessage('Biometric unlock failed. Use your passcode.');
                setMessageIsError(false);
                return;
            }

            // A cancelled prompt says nothing. The passcode keypad is right
            // there, and the prompt is not offered again on its own - that is
            // what used to trap people in a loop of prompts they could only
            // dismiss forever.
        } finally {
            biometricBusy.current = false;
        }
    }, [biometricsEnabled, completeUnlock, updateSetting]);

    // The prompt is offered once per lock, when the lock screen appears.
    useEffect(() => {
        if (!presented) return;
        if (!biometricsEnabled) return;
        if (biometricOffered.current) return;

        biometricOffered.current = true;
        void promptBiometric();
    }, [presented, biometricsEnabled, promptBiometric]);

    // Read the passcode while the lock screen is on its way in, so the check
    // after the last digit does not have to wait for the phone's secure
    // storage.
    useEffect(() => {
        if (!presented) return;
        void readStoredPin();
    }, [presented]);

    // Whether the device can do biometrics at all.
    useEffect(() => {
        if (!enabled) {
            setBiometricsAvailable(false);
            return;
        }

        let cancelled = false;
        void getBiometricAvailability().then(availability => {
            if (cancelled) return;
            setBiometricsAvailable(availability.usable);

            if (settings.biometricEnabled && !availability.usable) {
                // The setting says biometrics are on, but the phone no longer
                // has any enrolled. The passcode still works, so Melnote stops
                // offering a prompt that cannot succeed.
                updateSetting('biometricEnabled', false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, settings.biometricEnabled, updateSetting]);

    // --- coming and going ---------------------------------------------------
    const handleAppStateChange = useCallback((next: AppStateStatus) => {
        if (next === 'background') {
            leftApp.current = true;
            backgroundedAt.current = Date.now();

            // The lock screen is taken down while the app is away, so that it
            // is built from scratch on the way back. See the note at the top
            // of this file.
            setActive(false);

            // A half-typed passcode must not still be there when the owner
            // comes back, and neither must the note about the last mistake.
            // Both belong to the attempt that was interrupted.
            setPin('');
            setMessage('');
            setMessageIsError(false);
            return;
        }

        if (next !== 'active') return;

        const wasAway = leftApp.current;
        leftApp.current = false;
        setActive(true);

        if (!wasAway) {
            // The app never really left. This is a system panel being opened
            // and closed again, or the app switcher being dismissed. There is
            // nothing to lock.
            return;
        }

        if (!enabled) return;

        // A system screen Melnote opened itself is not the owner leaving.
        if (consumeExternalResume()) return;

        // A short trip out - reading a message, answering a permission
        // prompt - should not cost the owner their place.
        if (timeoutMs > 0 && Date.now() - backgroundedAt.current < timeoutMs) return;

        if (lockedRef.current) {
            // The lock screen was already up when the app went away. It comes
            // back as it was, and the biometric prompt is not offered a second
            // time.
            return;
        }

        lockNow();
    }, [enabled, timeoutMs, lockNow, setPin]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => subscription.remove();
    }, [handleAppStateChange]);

    // --- the waiting time after wrong passcodes -----------------------------
    useEffect(() => {
        if (!lockoutUntil) return;

        const tick = () => {
            const remaining = lockoutUntil - Date.now();
            setClock(Date.now());

            if (remaining <= 0) {
                setLockoutUntil(0);
                // The penalty starts over once the waiting time is over.
                failedAttempts.current = 0;
                updateSetting('appLockFailures', 0);
                updateSetting('appLockLockedUntil', 0);
                // The "wrong passcode" note belongs to the attempt that
                // caused the wait. Once the wait is over it is stale, and
                // leaving it on the screen would accuse the owner of
                // typing the wrong passcode when they have not even tried.
                setMessage('');
                setMessageIsError(false);
            }
        };

        tick();
        const timer = setInterval(tick, 500);
        return () => clearInterval(timer);
    }, [lockoutUntil, updateSetting]);

    // --- the "lock now" button in the settings ------------------------------
    useEffect(() => {
        return onLockCommand(command => {
            if (command === 'lock-now') lockNow();
        });
    }, [lockNow]);

    const lockoutSeconds = lockoutUntil > 0
        ? Math.max(0, Math.ceil((lockoutUntil - clock) / 1000))
        : 0;

    return {
        locked,
        presented,
        pinInput,
        unlocking,
        isCoolingDown,
        message,
        messageIsError,
        lockoutSeconds,
        biometricsAvailable,
        biometricEnabled: biometricsEnabled,
        pressDigit,
        pressBackspace,
        promptBiometric,
        lockNow,
    };
}
