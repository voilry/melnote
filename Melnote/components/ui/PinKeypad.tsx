import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from './ThemedText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { ScalePressable } from './ScalePressable';
import { Backspace, Fingerprint } from './Icon';

/**
 * The passcode dots and the keypad.
 *
 * Shared by the lock screen and by the settings screen that creates the
 * passcode, so the two always look and feel the same.
 *
 * What makes the typing feel smooth:
 *
 * - One number holds how much of the passcode has been typed, and every dot
 *   reads from it. A single spring drives all of them, so a digit does not
 *   arrive in the dots one after another.
 *
 * - The dots do not pop. The inner disc grows out of the ring while the ring
 *   grows a little, and a wrong passcode empties them with the same spring
 *   instead of snapping back to nothing.
 *
 * - The keypad uses a spring without overshoot. A key that wobbles past its
 *   resting size and bounces back reads as lag, not as life.
 */

const DIGIT_ROWS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
];

const KEY_SIZE = 68;
const KEY_GAP = 24;
const DOT_SIZE = 18;
const DOT_CORE = 12;
const DOT_GAP = 18;

export interface PinKeypadProps {
    /** How many digits the passcode has. */
    length: number;
    /** The digits that have been typed so far. */
    value: string;
    onDigit: (digit: string) => void;
    onBackspace: () => void;
    /** Called when the fingerprint key is pressed. */
    onBiometric?: () => void;
    /** Whether the fingerprint key should be shown at all. */
    showBiometric?: boolean;
    /** The keypad refuses every key while this is true. */
    disabled?: boolean;
    /** Turns the dots red and shakes them. */
    error?: boolean;
}

export function PinKeypad({
    length,
    value,
    onDigit,
    onBackspace,
    onBiometric,
    showBiometric = false,
    disabled = false,
    error = false,
}: PinKeypadProps) {
    const { colors } = useAppTheme();
    const { height } = useWindowDimensions();

    // A short screen has to give the keypad some of its room back, or the
    // bottom row falls off the bottom of the display.
    const compact = height < 700;
    const keySize = compact ? 58 : KEY_SIZE;
    const keyGap = compact ? 20 : KEY_GAP;
    const keypadGap = compact ? 30 : 40;
    const dotSize = compact ? 16 : DOT_SIZE;
    const dotCore = compact ? 10 : DOT_CORE;

    const keyStyle = {
        width: keySize,
        height: keySize,
        borderRadius: keySize / 2,
    };
    const rowStyle = { gap: keyGap, marginBottom: compact ? 14 : 18 };

    // How much of the passcode has been typed. Every dot reads from it.
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = withSpring(value.length, DesignSystem.animation.springs.snappy);
    }, [value.length, progress]);

    // The shake. It runs when the error state switches on, so a failed
    // attempt always tells the owner something went wrong.
    const shake = useSharedValue(0);
    const wasError = useRef(error);

    useEffect(() => {
        if (error && !wasError.current) {
            shake.value = withSequence(
                withTiming(-12, { duration: 55 }),
                withTiming(12, { duration: 55 }),
                withTiming(-8, { duration: 55 }),
                withTiming(0, { duration: 55 })
            );
        }
        wasError.current = error;
    }, [error, shake]);

    const dotsStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: shake.value }],
    }));

    const ringColor = error ? colors.error : colors.border;
    const coreColor = error ? colors.error : colors.tint;

    return (
        <View style={styles.root}>
            <Animated.View
                style={[styles.dots, { gap: compact ? 16 : DOT_GAP }, dotsStyle]}
                accessible
                accessibilityLabel={`${value.length} of ${length} passcode digits entered`}
            >
                {Array.from({ length }).map((_, index) => (
                    <PinDot
                        key={index}
                        index={index}
                        progress={progress}
                        ringColor={ringColor}
                        coreColor={coreColor}
                        size={dotSize}
                        core={dotCore}
                    />
                ))}
            </Animated.View>

            <View style={[styles.keypad, { marginTop: keypadGap }]}>
                {DIGIT_ROWS.map((row, rowIndex) => (
                    <View key={rowIndex} style={[styles.keypadRow, rowStyle]}>
                        {row.map(digit => (
                            <DigitKey
                                key={digit}
                                digit={digit}
                                disabled={disabled}
                                onPress={() => onDigit(digit)}
                                keyStyle={keyStyle}
                            />
                        ))}
                    </View>
                ))}

                <View style={[styles.keypadRow, rowStyle]}>
                    {showBiometric && onBiometric ? (
                        <ScalePressable
                            onPress={onBiometric}
                            disabled={disabled}
                            style={[styles.key, keyStyle]}
                            scaleTo={0.88}
                            springConfig={DesignSystem.animation.springs.snappy}
                            accessibilityRole="button"
                            accessibilityLabel="Unlock with biometrics"
                        >
                            <Fingerprint size={compact ? 24 : 26} color={colors.text} />
                        </ScalePressable>
                    ) : (
                        <View style={[styles.key, keyStyle]} />
                    )}

                    <DigitKey
                        digit="0"
                        disabled={disabled}
                        onPress={() => onDigit('0')}
                        keyStyle={keyStyle}
                    />

                    <ScalePressable
                        onPress={onBackspace}
                        disabled={disabled}
                        style={[styles.key, keyStyle]}
                        scaleTo={0.88}
                        springConfig={DesignSystem.animation.springs.snappy}
                        accessibilityRole="button"
                        accessibilityLabel="Delete the last digit"
                    >
                        <Backspace size={compact ? 24 : 26} color={colors.text} />
                    </ScalePressable>
                </View>
            </View>
        </View>
    );
}

function DigitKey({
    digit,
    onPress,
    disabled,
    keyStyle,
}: {
    digit: string;
    onPress: () => void;
    disabled: boolean;
    keyStyle: { width: number; height: number; borderRadius: number };
}) {
    return (
        <ScalePressable
            onPress={onPress}
            disabled={disabled}
            style={[styles.key, keyStyle]}
            scaleTo={0.88}
            springConfig={DesignSystem.animation.springs.snappy}
            accessibilityRole="button"
            accessibilityLabel={digit}
        >
            <ThemedText style={styles.keyText}>{digit}</ThemedText>
        </ScalePressable>
    );
}

function PinDot({
    index,
    progress,
    ringColor,
    coreColor,
    size,
    core,
}: {
    index: number;
    progress: SharedValue<number>;
    ringColor: string;
    coreColor: string;
    size: number;
    core: number;
}) {
    const ringStyle = useAnimatedStyle(() => {
        const amount = interpolate(progress.value, [index, index + 1], [0, 1], Extrapolation.CLAMP);
        return {
            transform: [{ scale: 1 + 0.12 * amount }],
        };
    });

    const coreStyle = useAnimatedStyle(() => {
        const amount = interpolate(progress.value, [index, index + 1], [0, 1], Extrapolation.CLAMP);
        return {
            opacity: amount,
            transform: [{ scale: 0.35 + 0.65 * amount }],
        };
    });

    return (
        <Animated.View
            style={[
                styles.dot,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderColor: ringColor,
                },
                ringStyle,
            ]}
        >
            <Animated.View
                style={[
                    styles.dotCore,
                    { width: core, height: core, borderRadius: core / 2, backgroundColor: coreColor },
                    coreStyle,
                ]}
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    root: {
        alignItems: 'center',
        width: '100%',
    },
    dots: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dotCore: {},
    keypad: {
        alignItems: 'center',
    },
    keypadRow: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
    key: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    keyText: {
        fontSize: 28,
        lineHeight: 34,
        fontFamily: Typography.fontFamily.medium,
    },
});
