
import React, { memo, useCallback } from 'react';
import { View, StyleSheet, Animated as RNAnimated } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { ScalePressable } from '../ui/ScalePressable';
import { Swipeable } from 'react-native-gesture-handler';
import { ThemedText } from '../ui/ThemedText';
import { Card } from '../ui/Card';
import { Typography } from '../../constants/Typography';
import { BookOpen, Trash } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AcrylicPalette } from '../../utils/acrylic';
import { markdownPreviewText } from '../../utils/markdownConverter';

interface JournalsTabProps {
    journals: any[];
    personName: string;
    onDelete: (id: number) => void;
    isAcrylic?: boolean;
    acrylic: AcrylicPalette;
}

const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-').map(Number);
    if (parts.length >= 3 && !parts.some(isNaN)) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateStr);
};

// A single journal card.
const JournalCard = memo(({ item, index, colors, router, isAcrylic, acrylic, renderRightActions }: any) => {
    return (
        <Animated.View
            layout={Layout.springify().damping(26).stiffness(280)}
            entering={FadeInDown.delay(Math.min(index, 5) * 20).duration(260).springify().damping(26).stiffness(280).mass(0.7)}
        >
            <Swipeable
                renderRightActions={(_progress: any, dragX: any) => renderRightActions(item.journal.id, dragX)}
                overshootRight={false}
                friction={3}
                overshootFriction={8}
                rightThreshold={60}
            >
                <ScalePressable
                    onPress={() => router.push(`/journal/${item.journal.id}`)}
                    style={{ marginBottom: 16 }}
                    innerStyle={{ borderRadius: 16 }}
                >
                    <Card style={[{ borderRadius: 16, backgroundColor: isAcrylic ? acrylic.panel : colors.surface, borderWidth: 0 }]} padding="md">
                        <View style={styles.entryHeader}>
                            <View style={[styles.journalDateBadge, { backgroundColor: colors.tint + '15' }]}>
                                <ThemedText type="tiny" style={{ color: colors.tint, fontFamily: Typography.fontFamily.extrabold }}>
                                    {parseLocalDate(item.journal.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </ThemedText>
                            </View>
                        </View>
                        {item.journal.title ? (
                            <ThemedText type="sectionHeader" style={styles.journalTitle}>{item.journal.title}</ThemedText>
                        ) : null}
                        <ThemedText style={styles.journalContent} numberOfLines={4}>{markdownPreviewText(item.journal.content)}</ThemedText>
                    </Card>
                </ScalePressable>
            </Swipeable>
        </Animated.View>
    );
});

export function JournalsTab({ journals, personName, onDelete, isAcrylic, acrylic }: JournalsTabProps) {
    const router = useRouter();
    const { colors, hapticsEnabled } = useAppTheme();

    // Kept stable so the memoised JournalCard is not re-rendered (and its
    // markdown preview not re-parsed) on every parent render.
    const renderRightActions = useCallback((id: number, dragX: RNAnimated.AnimatedInterpolation<number>) => {
        const trans = dragX.interpolate({
            inputRange: [-80, 0],
            outputRange: [1, 0],
            extrapolate: 'clamp',
        });

        return (
            <ScalePressable
                style={{
                    backgroundColor: colors.error,
                    justifyContent: 'center',
                    alignItems: 'center',
                    width: 75,
                    borderRadius: 16,
                    marginBottom: 16,
                    marginLeft: 12,
                }}
                innerStyle={{ borderRadius: 16 }}
                scale={true}
                overlayColor="rgba(0,0,0,0.15)"
                onPress={() => onDelete(id)}
            >
                <RNAnimated.View style={{ transform: [{ scale: trans }] }}>
                    <Trash size={24} color="#FFF" weight="fill" />
                </RNAnimated.View>
            </ScalePressable>
        );
    }, [colors.error, onDelete]);

    return (
        <View style={styles.entriesSection}>
            {journals.length === 0 ? (
                <Animated.View
                    entering={FadeInDown.duration(260).springify().damping(26).stiffness(280).mass(0.7)}
                    style={styles.emptyState}
                >
                    <BookOpen size={48} color={colors.tint} weight="fill" />
                    <ThemedText style={{ marginTop: 16, fontSize: 18, fontFamily: Typography.fontFamily.bold }}>No Mentions</ThemedText>
                    <ThemedText style={{ color: colors.secondary, marginTop: 2, fontSize: 12, textAlign: 'center' }}>
                        Tag {personName.split(' ')[0]} in your daily journal to see them here.
                    </ThemedText>
                </Animated.View>
            ) : (
                journals.map((item, index) => (
                    <JournalCard
                        key={item.journal.id}
                        item={item}
                        index={index}
                        colors={colors}
                        router={router}
                        isAcrylic={isAcrylic}
                        acrylic={acrylic}
                        renderRightActions={renderRightActions}
                    />
                ))
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    entriesSection: {
        paddingTop: 8,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
        opacity: 0.8,
    },
    entryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    journalDateBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    journalTitle: {
        fontSize: 18,
        marginBottom: 8,
    },
    journalContent: {
        lineHeight: 20,
        fontSize: 14,
        opacity: 0.9,
    }
});
