import React from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { ThemedText } from './ThemedText';
import { Button } from './Button';
import { useAppTheme } from '../../hooks/useAppTheme';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import Animated, { Easing, FadeIn, FadeOut, Keyframe, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useModalPresence } from './useModalPresence';
import { Bug } from './Icon';

/**
 * The app's own pop-out: the same motion screens use on the way out (see
 * components/ui/ScreenMotion.tsx) - the sheet shrinks a touch and fades
 * away instead of vanishing.
 */
const POP_OUT = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    100: { opacity: 0, transform: [{ scale: 0.94 }], easing: Easing.in(Easing.quad) },
}).duration(110);

interface BugReportModalProps {
    visible: boolean;
    /** The exact text that will be sent in the email. */
    reportBody: string;
    /** How many errors were caught in the last 7 days. */
    errorCount: number;
    /** Dismissed without sending anything. */
    onClose: () => void;
    /** Opens the email. Nothing is sent until the user sends it there. */
    onReport: () => void;
}

/**
 * Confirmation sheet shown before the bug-report email opens, so the user can
 * see exactly what would be sent before an email app takes over the screen.
 * Nothing is sent from here: "Report" only opens the email app.
 *
 * The open motion is the one the group sheet uses (long-press a group chip ->
 * "Edit Group"): a slow fade on the backdrop and a soft zoom on the card.
 * Closing plays the app's pop-out.
 */
export function BugReportModal({ visible, reportBody, errorCount, onClose, onReport }: BugReportModalProps) {
    const { colors } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    // Keeps the modal alive for a beat so the pop-out can play.
    const { mounted, showContent } = useModalPresence(visible, 170);

    if (!mounted) return null;

    const hasErrors = errorCount > 0;

    return (
        <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
            <View style={styles.overlay}>
                {showContent && (
                    <>
                        {/* Backdrop. Tapping it dismisses the sheet. */}
                        <Animated.View
                            entering={FadeIn.duration(240).easing(Easing.bezier(0.05, 0.7, 0.1, 1.0))}
                            exiting={FadeOut.duration(95).easing(Easing.in(Easing.quad))}
                            style={styles.backdrop}
                        >
                            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                        </Animated.View>

                        {/* The card lives in its own layer above the backdrop.
                            box-none keeps the layer itself out of the way: a
                            tap on the card never reaches the backdrop's
                            dismiss button, and the log list keeps its own
                            scroll gestures. */}
                        <View
                            style={[
                                styles.content,
                                { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
                            ]}
                            pointerEvents="box-none"
                        >
                            <Animated.View
                                entering={ZoomIn.duration(280).springify().damping(22).stiffness(240).mass(0.85)}
                                exiting={POP_OUT}
                                style={[
                                    styles.card,
                                    {
                                        backgroundColor: colors.card,
                                        // Never taller than the screen, whatever the
                                        // amount of log text.
                                        maxHeight: height * 0.82,
                                    },
                                ]}
                            >
                                <View style={styles.iconRow}>
                                    <Bug size={26} color={colors.tint} weight="duotone" />
                                </View>

                                <ThemedText type="sectionHeader" style={styles.title}>Report a bug</ThemedText>

                                <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
                                    {hasErrors
                                        ? `${errorCount} error${errorCount === 1 ? '' : 's'} caught in the last 7 days will be sent with your report.`
                                        : 'Nothing has been caught so far. You can still send a report to describe a problem.'}
                                </ThemedText>

                                <ThemedText style={[styles.previewLabel, { color: colors.textTertiary }]}>
                                    This is what will be sent
                                </ThemedText>

                                <View style={[styles.preview, { backgroundColor: colors.surface }]}>
                                    <ScrollView
                                        style={{ maxHeight: Math.max(120, height * 0.32) }}
                                        contentContainerStyle={styles.previewContent}
                                        showsVerticalScrollIndicator
                                    >
                                        <ThemedText style={[styles.previewText, { color: colors.text }]}>{reportBody}</ThemedText>
                                    </ScrollView>
                                </View>

                                <View style={styles.actions}>
                                    <Button title="Cancel" variant="surface" onPress={onClose} style={styles.actionButton} />
                                    <Button title="Report" variant="primary" onPress={onReport} style={styles.actionButton} />
                                </View>
                            </Animated.View>
                        </View>
                    </>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
    },
    backdrop: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0,0,0,0.65)',
    },
    content: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    card: {
        width: '100%',
        borderRadius: DesignSystem.radius.xl,
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 18,
        ...DesignSystem.shadows.xl,
    },
    iconRow: {
        alignItems: 'center',
        marginBottom: 10,
    },
    title: {
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14.5,
        lineHeight: 21,
        textAlign: 'center',
        paddingHorizontal: 4,
        fontFamily: Typography.fontFamily.regular,
        marginBottom: 18,
    },
    previewLabel: {
        fontSize: 12,
        fontFamily: Typography.fontFamily.semibold,
        opacity: 0.5,
        letterSpacing: 0.2,
        marginBottom: 6,
        marginLeft: 2,
    },
    preview: {
        borderRadius: DesignSystem.radius.md,
        overflow: 'hidden',
    },
    previewContent: {
        padding: 12,
    },
    previewText: {
        fontSize: 12.5,
        lineHeight: 18,
        fontFamily: Typography.fontFamily.regular,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 18,
    },
    actionButton: {
        flex: 1,
    },
});
