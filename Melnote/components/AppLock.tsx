import React, { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

import { ThemedText } from './ui/ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppLock } from '../hooks/useAppLock';
import { LockKey, LockKeyOpen } from '@/components/ui/Icon';
import { Typography } from '../constants/Typography';
import { DesignSystem } from '../constants/DesignSystem';
import { PinKeypad } from './ui/PinKeypad';
import { PIN_LENGTH } from '../utils/appLock';

const DEFAULT_HINT = 'Enter your passcode to continue.';

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
    const lock = useAppLock();

    // The success mark grows in when the passcode was right.
    const successScale = useSharedValue(0);
    useEffect(() => {
        successScale.value = lock.unlocking
            ? withSpring(1, DesignSystem.animation.easing.spring)
            : 0;
    }, [lock.unlocking, successScale]);

    const successStyle = useAnimatedStyle(() => ({
        transform: [{ scale: successScale.value }]
    }));

    const lockedOut = lock.lockoutSeconds > 0;
    const subtitle = lockedOut
        ? `Too many wrong passcodes. Try again in ${lock.lockoutSeconds}s.`
        : lock.message || DEFAULT_HINT;
    const subtitleIsError = lockedOut || lock.messageIsError;
    const keypadDisabled = lockedOut || lock.unlocking;

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
                    <View
                        style={[styles.container, { backgroundColor: colors.background }]}
                        accessibilityViewIsModal
                    >
                        {lock.unlocking ? (
                            <Animated.View style={[styles.successWrap, successStyle]}>
                                <View style={[styles.successCircle, { backgroundColor: colors.tint }]}>
                                    <LockKeyOpen
                                        size={48}
                                        color={theme === 'dark' ? '#000' : '#fff'}
                                        weight="bold"
                                    />
                                </View>
                                <ThemedText style={styles.title}>Unlocked</ThemedText>
                            </Animated.View>
                        ) : (
                            <>
                                <View style={styles.header}>
                                    <LockKey
                                        size={44}
                                        color={lockedOut ? colors.error : colors.tint}
                                        weight="duotone"
                                        style={styles.lockIcon}
                                    />
                                    <ThemedText style={styles.title}>Melnote is locked</ThemedText>

                                    {/*
                                        The area keeps its height whatever the
                                        message says, so a wrong passcode does
                                        not shove the keypad around.
                                    */}
                                    <View style={styles.messageArea}>
                                        <ThemedText
                                            style={[
                                                styles.subtitle,
                                                subtitleIsError ? { color: colors.error } : null,
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
                            </>
                        )}
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
        paddingBottom: 24,
    },
    header: {
        alignItems: 'center',
    },
    lockIcon: {
        marginBottom: 18,
    },
    title: {
        fontSize: 26,
        lineHeight: 32,
        letterSpacing: -0.6,
        fontFamily: Typography.fontFamily.display,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14.5,
        lineHeight: 21,
        fontFamily: Typography.fontFamily.regular,
        textAlign: 'center',
    },
    messageArea: {
        minHeight: 44,
        justifyContent: 'center',
        marginTop: 6,
    },
    successWrap: {
        alignItems: 'center',
    },
    successCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        ...DesignSystem.shadows.lg,
    },
});
