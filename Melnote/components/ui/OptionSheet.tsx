import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './ThemedText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { ScalePressable } from './ScalePressable';
import { useModalPresence } from './useModalPresence';
import { useModalHost } from './useModalHost';
import { Check } from './Icon';

const EASE_ENTER = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const SHEET_ENTER = SlideInDown.duration(320).springify().damping(24).stiffness(240).mass(0.9);

export interface SheetOption {
    label: string;
    description?: string;
    value: string | number;
}

interface OptionSheetProps {
    visible: boolean;
    title: string;
    options: SheetOption[];
    selectedValue?: string | number;
    onSelect: (value: any) => void;
    onClose: () => void;
}

/**
 * A bottom sheet that picks one value out of a list.
 *
 * Used for settings that have more than two sensible answers, where a
 * toggle or a segmented control would be too cramped.
 */
export function OptionSheet({
    visible,
    title,
    options,
    selectedValue,
    onSelect,
    onClose,
}: OptionSheetProps) {
    const { colors } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { mounted, showContent } = useModalPresence(visible);
    // A sheet that is left open while the app goes away comes back blank on
    // Android unless the dialog is built again. See `useModalHost`.
    const generation = useModalHost(visible);

    if (!mounted) return null;

    return (
        <Modal key={generation} visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
            {showContent && (
            <View style={styles.overlay}>
                <Animated.View
                    entering={FadeIn.duration(220).easing(EASE_ENTER)}
                    exiting={FadeOut.duration(210)}
                    style={[StyleSheet.absoluteFill, styles.dim]}
                    pointerEvents="none"
                />
                <Pressable style={styles.backdrop} onPress={onClose}>
                    <Animated.View
                        entering={SHEET_ENTER}
                        exiting={FadeOutDown.duration(260).easing(Easing.bezier(0.4, 0, 0.5, 1))}
                        style={[
                            styles.sheet,
                            {
                                backgroundColor: colors.background,
                                paddingBottom: 100 + insets.bottom + 24,
                                marginBottom: -100,
                            },
                        ]}
                        onStartShouldSetResponder={() => true}
                    >
                        <View style={[styles.handle, { backgroundColor: colors.border }]} />
                        <ThemedText style={[styles.title, { color: colors.secondary }]}>{title}</ThemedText>

                        {options.map(option => {
                            const selected = option.value === selectedValue;
                            return (
                                <ScalePressable
                                    key={String(option.value)}
                                    style={styles.row}
                                    innerStyle={{ borderRadius: 12 }}
                                    onPress={() => {
                                        onSelect(option.value);
                                        onClose();
                                    }}
                                    accessibilityRole="button"
                                    accessibilityLabel={option.label}
                                >
                                    <View style={styles.rowText}>
                                        <ThemedText style={[styles.label, { color: colors.text }]}>
                                            {option.label}
                                        </ThemedText>
                                        {option.description ? (
                                            <ThemedText style={[styles.description, { color: colors.textSecondary }]}>
                                                {option.description}
                                            </ThemedText>
                                        ) : null}
                                    </View>
                                    {selected ? <Check size={20} color={colors.tint} weight="bold" /> : null}
                                </ScalePressable>
                            );
                        })}
                    </Animated.View>
                </Pressable>
            </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    dim: {
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    sheet: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingTop: 14,
        paddingHorizontal: 8,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 18,
        opacity: 0.5,
    },
    title: {
        fontSize: 13,
        lineHeight: 18,
        fontFamily: Typography.fontFamily.semibold,
        letterSpacing: 0.2,
        opacity: 0.6,
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        paddingVertical: 15,
        paddingHorizontal: 16,
        borderRadius: 12,
        minHeight: 52,
    },
    rowText: {
        flex: 1,
    },
    label: {
        fontSize: 16,
        lineHeight: 22,
        fontFamily: Typography.fontFamily.medium,
    },
    description: {
        fontSize: 13,
        lineHeight: 18,
        fontFamily: Typography.fontFamily.regular,
        opacity: 0.6,
        marginTop: 2,
    },
});
