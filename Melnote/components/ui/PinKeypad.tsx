import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    interpolateColor,
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
 * Key features:
 * - Clean, borderless solid dots that smoothly interpolate to the theme tint
 *   on input and error red on mistake.
 * - Tactile, borderless circular keys with soft surface backgrounds.
 * - Responsive sizing and safe area awareness.
 * - Single spring driving the dots progress for fluid transitions.
 */

const DIGIT_ROWS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
];

const KEY_SIZE = 68;
const KEY_GAP = 22;
const DOT_SIZE = 14;
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
    const { colors, theme } = useAppTheme();
    const { height } = useWindowDimensions();

    const compact = height < 700;
    const keySize = compact ? 58 : KEY_SIZE;
    const keyGap = compact ? 18 : KEY_GAP;
    const keypadGap = compact ? 26 : 36;
    const dotSize = compact ? 12 : DOT_SIZE;
    const dotGap = compact ? 14 : DOT_GAP;

    const keyStyle = {
        width: keySize,
        height: keySize,
        borderRadius: keySize / 2,
    };
    const rowStyle = { gap: keyGap, marginBottom: compact ? 12 : 16 };

    // Soft borderless key background adhering to Melnote's surface elevation
    const keyBackground = theme === 'dark' ? 'rgba(255, 255, 255, 0.06)' : colors.surface;
    const emptyDotColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.09)';
    const activeDotColor = error ? colors.error : colors.tint;

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

    return (
        <View style={styles.root}>
            <Animated.View
                style={[styles.dots, { gap: dotGap }, dotsStyle]}
                accessible
                accessibilityLabel={`${value.length} of ${length} passcode digits entered`}
            >
                {Array.from({ length }).map((_, index) => (
                    <PinDot
                        key={index}
                        index={index}
                        progress={progress}
                        activeColor={activeDotColor}
                        emptyColor={emptyDotColor}
                        size={dotSize}
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
                                backgroundColor={keyBackground}
                                compact={compact}
                            />
                        ))}
                    </View>
                ))}

                <View style={[styles.keypadRow, rowStyle]}>
                    {showBiometric && onBiometric ? (
                        <ScalePressable
                            onPress={onBiometric}
                            disabled={disabled}
                            style={[styles.key, keyStyle, { backgroundColor: keyBackground }]}
                            scaleTo={0.92}
                            springConfig={DesignSystem.animation.springs.snappy}
                            accessibilityRole="button"
                            accessibilityLabel="Unlock with biometrics"
                        >
                            <Fingerprint size={compact ? 22 : 24} color={colors.text} />
                        </ScalePressable>
                    ) : (
                        <View style={[styles.key, keyStyle]} />
                    )}

                    <DigitKey
                        digit="0"
                        disabled={disabled}
                        onPress={() => onDigit('0')}
                        keyStyle={keyStyle}
                        backgroundColor={keyBackground}
                        compact={compact}
                    />

                    <ScalePressable
                        onPress={onBackspace}
                        disabled={disabled || value.length === 0}
                        style={[
                            styles.key,
                            keyStyle,
                            {
                                opacity: value.length === 0 ? 0 : 1,
                            },
                        ]}
                        scaleTo={0.92}
                        springConfig={DesignSystem.animation.springs.snappy}
                        accessibilityRole="button"
                        accessibilityLabel="Delete the last digit"
                    >
                        <Backspace size={compact ? 22 : 24} color={colors.text} />
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
    backgroundColor,
    compact,
}: {
    digit: string;
    onPress: () => void;
    disabled: boolean;
    keyStyle: { width: number; height: number; borderRadius: number };
    backgroundColor: string;
    compact: boolean;
}) {
    return (
        <ScalePressable
            onPress={onPress}
            disabled={disabled}
            style={[styles.key, keyStyle, { backgroundColor }]}
            scaleTo={0.92}
            springConfig={DesignSystem.animation.springs.snappy}
            accessibilityRole="button"
            accessibilityLabel={digit}
        >
            <ThemedText style={[styles.keyText, compact && styles.keyTextCompact]}>
                {digit}
            </ThemedText>
        </ScalePressable>
    );
}

function PinDot({
    index,
    progress,
    activeColor,
    emptyColor,
    size,
}: {
    index: number;
    progress: SharedValue<number>;
    activeColor: string;
    emptyColor: string;
    size: number;
}) {
    const dotAnimStyle = useAnimatedStyle(() => {
        const amount = interpolate(progress.value, [index, index + 1], [0, 1], Extrapolation.CLAMP);
        const backgroundColor = interpolateColor(
            amount,
            [0, 1],
            [emptyColor, activeColor]
        );
        return {
            backgroundColor,
            transform: [{ scale: 1 + 0.15 * amount }],
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
                },
                dotAnimStyle,
            ]}
        />
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
        justifyContent: 'center',
    },
    dot: {
        alignItems: 'center',
        justifyContent: 'center',
    },
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
        fontSize: 27,
        lineHeight: 33,
        fontFamily: Typography.fontFamily.medium,
    },
    keyTextCompact: {
        fontSize: 24,
        lineHeight: 30,
    },
});
