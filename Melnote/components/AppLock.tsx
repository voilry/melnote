import React from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './ui/ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppLock } from '../hooks/useAppLock';
import { LockKey } from '@/components/ui/Icon';
import { Typography } from '../constants/Typography';
import { PinKeypad } from './ui/PinKeypad';
import { PIN_LENGTH } from '../utils/appLock';

const DEFAULT_HINT = 'Enter passcode to continue';

function formatLockout(seconds: number): string {
    if (seconds >= 60) {
        const mins = Math.ceil(seconds / 60);
        return `Too many wrong passcodes. Try again in ${mins}m.`;
    }
    return `Too many wrong passcodes. Try again in ${seconds}s.`;
}

/**
 * The lock screen.
 *
 * It is a native `Modal` so that it covers every other window in the app - a
 * sheet that is open underneath must not peek out - but it is only ever
 * built while the app is in the foreground. See `hooks/useAppLock` for why
 * that matters on Android.
 */
export function AppLock() {
    const { colors, theme } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const lock = useAppLock();

    const compact = height < 700;
    const lockIconSize = compact ? 36 : 42;

    const lockedOut = lock.lockoutSeconds > 0;
    const subtitle = lockedOut
        ? formatLockout(lock.lockoutSeconds)
        : lock.message || DEFAULT_HINT;
    const subtitleIsError = lockedOut || lock.messageIsError;
    const keypadDisabled = lockedOut || lock.unlocking || lock.isCoolingDown;

    return (
        <>
            {/*
                Covers the app while the lock screen is on its way, so a note is
                never visible for even a frame when the app is opened.
            */}
            {lock.locked && (
                <View
                    style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                />
            )}

            {lock.presented && (
                <Modal
                    transparent
                    animationType="fade"
                    visible
                    statusBarTranslucent
                    navigationBarTranslucent
                    // The lock screen cannot be dismissed. The back button
                    // does nothing at all.
                    onRequestClose={() => {}}
                >
                    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
                    <View
                        style={[
                            styles.container,
                            {
                                backgroundColor: colors.background,
                                paddingTop: Math.max(insets.top + 16, compact ? 24 : 40),
                                paddingBottom: Math.max(insets.bottom + 16, compact ? 20 : 32),
                            },
                        ]}
                        accessibilityViewIsModal
                    >
                        <View style={styles.content}>
                            <View style={[styles.header, compact && styles.headerCompact]}>
                                <LockKey
                                    size={lockIconSize}
                                    color={lockedOut ? colors.error : colors.tint}
                                    weight="bold"
                                    style={styles.lockIcon}
                                />
                                <ThemedText style={styles.title}>App Locked</ThemedText>

                                {/*
                                    The area keeps its height whatever the
                                    message says, so a wrong passcode does
                                    not shove the keypad around.
                                */}
                                <View style={styles.messageArea}>
                                    <ThemedText
                                        style={[
                                            styles.subtitle,
                                            { color: subtitleIsError ? colors.error : colors.textSecondary },
                                        ]}
                                    >
                                        {subtitle}
                                    </ThemedText>
                                </View>
                            </View>

                            <PinKeypad
                                length={PIN_LENGTH}
                                value={lock.pinInput}
                                onDigit={lock.pressDigit}
                                onBackspace={lock.pressBackspace}
                                onBiometric={() => { void lock.promptBiometric(); }}
                                showBiometric={lock.biometricEnabled && lock.biometricsAvailable}
                                disabled={keypadDisabled}
                                error={lock.messageIsError}
                            />
                        </View>
                    </View>
                </Modal>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    content: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    header: {
        alignItems: 'center',
        marginBottom: 28,
    },
    headerCompact: {
        marginBottom: 18,
    },
    lockIcon: {
        marginBottom: 14,
    },
    title: {
        fontSize: 24,
        lineHeight: 30,
        letterSpacing: -0.5,
        fontFamily: Typography.fontFamily.display,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        lineHeight: 20,
        fontFamily: Typography.fontFamily.regular,
        textAlign: 'center',
    },
    messageArea: {
        minHeight: 22,
        justifyContent: 'center',
        marginTop: 4,
    },
});
