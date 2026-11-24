import { View, StyleSheet, FlatList, Platform, Animated as RNAnimated } from 'react-native';
import Animated, { FadeInDown, Layout, useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, interpolate, Extrapolate, runOnJS } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { useState, useCallback, useMemo, memo, useRef } from 'react';
import { JournalRepository, Journal } from '../../db/repositories/JournalRepository';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Button } from '../../components/ui/Button';
import { SearchNoResults, Trash, Calendar, Pencil as PenTool } from '@/components/ui/Icon';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { DeleteModal } from '../../components/ui/DeleteModal';
import { SearchBar } from '../../components/ui/SearchBar';
import { Badge } from '../../components/ui/Badge';
import { Swipeable } from 'react-native-gesture-handler';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { QuickScrollButton } from '../../components/ui/QuickScrollButton';
import { markdownPreviewText } from '../../utils/markdownConverter';

type AppColors = ReturnType<typeof useAppTheme>['colors'];

interface JournalTag {
    journalId: number;
    person: { id: number; name: string; avatarUri?: string | null };
}

type JournalEntry = Journal & { tags: JournalTag[] };

// Combined max height of the absolute header (80) + search bar (52) + padding.
const HEADER_HEIGHT = 80 + 52 + 10;

const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const parts = dateStr.split('-').map(Number);
    if (parts.length >= 3 && !parts.some(isNaN)) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateStr);
};

// Cards show at most 3 lines, so converting the full markdown of a long
// entry is wasted work. Convert only a generous leading window, trimming
// a trailing image tag that the cut may have split so raw `![alt](…` can
// never leak into the preview.
const PREVIEW_WINDOW = 600;
const previewSource = (content: string | null) => {
    const raw = content || '';
    if (raw.length <= PREVIEW_WINDOW) return raw;
    let slice = raw.slice(0, PREVIEW_WINDOW);
    const lastImg = slice.lastIndexOf('![');
    if (lastImg !== -1 && slice.indexOf(')', lastImg) === -1) {
        slice = slice.slice(0, lastImg);
    }
    return slice;
};

const renderRightActions = (id: number, dragX: RNAnimated.AnimatedInterpolation<number>, colors: AppColors, onDelete: (id: number) => void) => {
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
                borderRadius: 20,
                height: '100%',
                marginLeft: 12,
            }}
            innerStyle={{ borderRadius: 20 }}
            scale={true}
            overlayColor="rgba(0,0,0,0.15)"
            onPress={() => onDelete(id)}
        >
            <RNAnimated.View style={{ transform: [{ scale: trans }] }}>
                <Trash size={24} color="#FFF" weight="fill" />
            </RNAnimated.View>
        </ScalePressable>
    );
};

const JournalItem = memo(function JournalItem({ item, index, colors, router, onDelete, shouldAnimate }: {
    item: JournalEntry;
    index: number;
    colors: AppColors;
    router: ReturnType<typeof useRouter>;
    onDelete: (id: number) => void;
    shouldAnimate: boolean;
}) {
    const preview = useMemo(() => markdownPreviewText(previewSource(item.content)), [item.content]);
    const dateLabel = useMemo(
        () => parseLocalDate(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        [item.date]
    );

    return (
        <Animated.View
            entering={shouldAnimate ? FadeInDown.delay(Math.min(index, 5) * 15).duration(260).springify().damping(24).stiffness(280).mass(0.7) : undefined}
            layout={Layout.springify().damping(26).stiffness(280)}
            style={styles.journalItem}
        >
            <Swipeable
                renderRightActions={(_progress, dragX) => renderRightActions(item.id, dragX, colors, onDelete)}
                overshootRight={false}
                friction={3}
                overshootFriction={8}
                rightThreshold={60}
            >
                <ScalePressable
                    onPress={() => router.push({ pathname: '/journal/[id]', params: { id: item.id } })}
                    style={{ width: '100%' }}
                    innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                    scale={true}
                    scaleTo={0.96}
                >
                    <Card style={[{ backgroundColor: colors.surface, borderColor: colors.text + '10' }]} padding="lg">
                        <View style={styles.cardHeader}>
                            <Badge variant="tint" icon={<Calendar size={12} color={colors.tint} weight="bold" />}>
                                {dateLabel}
                            </Badge>
                        </View>

                        {item.title ? (
                            <ThemedText type="sectionHeader" style={styles.journalTitle}>{item.title}</ThemedText>
                        ) : null}
                        <ThemedText style={styles.journalContent} numberOfLines={3}>{preview}</ThemedText>

                        {item.tags.length > 0 && (
                            <View style={styles.tagsContainer}>
                                {item.tags.map((t, idx) => (
                                    <View key={`journal-${item.id}-tag-${t.person.id}-${idx}`} style={[styles.tag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                        <Avatar name={t.person.name} uri={t.person.avatarUri} size={18} />
                                        <ThemedText type="tiny" style={styles.tagName}>{t.person.name.split(' ')[0]}</ThemedText>
                                    </View>
                                ))}
                            </View>
                        )}
                    </Card>
                </ScalePressable>
            </Swipeable>
        </Animated.View>
    );
});

export default function JournalScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [journals, setJournals] = useState<JournalEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
    const [tabFocusKey, setTabFocusKey] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');

    const { colors, hapticsEnabled } = useAppTheme();
    const keyboardVisible = useKeyboardState((state) => state.isVisible);

    // A ref, not state: entering animations only matter when a row mounts,
    // so flipping this must not re-render every visible row.
    const shouldAnimateRef = useRef(true);

    const loadData = useCallback(async () => {
        try {
            const journalData = await JournalRepository.getAll();
            setJournals(journalData as JournalEntry[]);
        } catch (error) {
            console.error('Failed to load journals:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            setTabFocusKey(k => k + 1);
            shouldAnimateRef.current = true;
            loadData();
            // Disable animations after initial load to prevent scroll-triggered animations
            const timer = setTimeout(() => { shouldAnimateRef.current = false; }, 1200);
            return () => clearTimeout(timer);
        }, [loadData])
    );

    const handleAddPress = useCallback(() => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: '/journal/[id]', params: { id: 'new', edit: 'true' } });
    }, [hapticsEnabled, router]);

    const handleDelete = useCallback((id: number) => {
        setEntryToDelete(id);
    }, []);

    const confirmDelete = async () => {
        if (entryToDelete === null) return;
        const id = entryToDelete;
        setEntryToDelete(null);
        // Optimistic removal: the row collapses via its layout animation
        // immediately; a failed delete restores reality with a reload.
        setJournals(prev => prev.filter(j => j.id !== id));
        try {
            await JournalRepository.delete(id);
        } catch (error) {
            console.error('Failed to delete journal entry:', error);
            loadData();
        }
    };

    const renderJournalItem = useCallback(({ item, index }: { item: JournalEntry, index: number }) => (
        <JournalItem
            item={item}
            index={index}
            colors={colors}
            router={router}
            onDelete={handleDelete}
            shouldAnimate={shouldAnimateRef.current}
        />
    ), [colors, router, handleDelete]);

    const scrollY = useSharedValue(0);
    const scrollDirection = useSharedValue<'up' | 'down'>('up');
    const isScrolling = useSharedValue(false);
    const lastScrollNotify = useSharedValue(0);
    const hideTimeout = useRef<any>(null);
    const journalListRef = useRef<FlatList>(null);

    const startHideTimer = useCallback(() => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => {
            isScrolling.value = false;
        }, 800);
    }, []);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            const currentY = event.contentOffset.y;
            const diff = currentY - scrollY.value;

            if (Math.abs(diff) > 5) {
                scrollDirection.value = diff > 0 ? 'down' : 'up';
                isScrolling.value = currentY > 400;
            }
            scrollY.value = currentY;

            // The hide timer only needs ~800ms accuracy; crossing to JS every
            // frame is wasted bridge traffic, so throttle to ~150ms.
            const now = Date.now();
            if (now - lastScrollNotify.value > 150) {
                lastScrollNotify.value = now;
                runOnJS(startHideTimer)();
            }
        },
    });

    const handleQuickScroll = () => {
        if (scrollDirection.value === 'up') {
            journalListRef.current?.scrollToOffset({ offset: 0, animated: true });
        } else {
            journalListRef.current?.scrollToEnd({ animated: true });
        }
    };

    const headerAnimatedStyle = useAnimatedStyle(() => {
        // Steeper interpolation for better responsiveness to scroll speed
        const opacity = interpolate(scrollY.value, [-50, 0, 60, 100], [1, 1, 1, 0], Extrapolate.CLAMP);
        const translateY = interpolate(scrollY.value, [-50, 0, 60, 100], [0, 0, 0, -30], Extrapolate.CLAMP);
        return {
            opacity,
            transform: [{ translateY }],
            height: 80,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
        };
    });

    const searchAnimatedStyle = useAnimatedStyle(() => {
        const scale = interpolate(scrollY.value, [-50, 0, 30, 80], [1, 1, 1, 0.95], Extrapolate.CLAMP);
        const opacity = interpolate(scrollY.value, [-50, 0, 30, 80], [1, 1, 1, 0], Extrapolate.CLAMP);
        const translateY = interpolate(scrollY.value, [-50, 0, 80], [80, 80, 0], Extrapolate.CLAMP);
        return {
            transform: [{ scale }, { translateY }],
            position: 'absolute',
            opacity,
            left: 0,
            right: 0,
            height: 52,
            zIndex: 9,
        };
    });

    // Precomputed once per data load so filtering per keystroke is plain
    // string matching — no date formatting or lowercasing in the hot path.
    const searchIndex = useMemo(() => journals.map(j => {
        let dateFormats: string[] = [];
        if (j.date) {
            const d = parseLocalDate(j.date);
            if (!isNaN(d.getTime())) {
                dateFormats = [
                    d.toLocaleDateString('default', { month: 'long', day: 'numeric' }).toLowerCase(),
                    d.toLocaleDateString('default', { month: 'short', day: 'numeric' }).toLowerCase(),
                    d.toLocaleDateString('default', { month: 'long', year: 'numeric' }).toLowerCase(),
                    d.toLocaleDateString('default', { month: 'short', year: 'numeric' }).toLowerCase(),
                    j.date.toLowerCase(),
                ];
            }
        }
        return {
            journal: j,
            title: (j.title || '').toLowerCase(),
            content: (j.content || '').toLowerCase(),
            tagNames: (j.tags || []).map(t => t.person.name.toLowerCase()),
            dateFormats,
        };
    }), [journals]);

    const filteredJournals = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        if (!q) return journals;
        const qParts = q.includes(' ') ? q.split(/\s+/) : null;
        return searchIndex
            .filter(e => {
                if (e.title.includes(q) || e.content.includes(q)) return true;
                if (e.tagNames.some(name => name.includes(q))) return true;
                if (e.dateFormats.some(f => f.includes(q))) return true;
                // Multi-word queries may match date parts across formats.
                return !!qParts && qParts.every(part => e.dateFormats.some(f => f.includes(part)));
            })
            .map(e => e.journal);
    }, [journals, searchIndex, searchQuery]);

    const listHeader = useMemo(() => <View style={{ height: HEADER_HEIGHT }} />, []);

    return (
        <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
            <View style={{ position: 'relative', zIndex: 110 }}>
                <Animated.View style={headerAnimatedStyle}>
                    <View style={styles.header}>
                        <View style={styles.headerTitleContainer}>
                            <ThemedText type="display" style={styles.title}>Journal</ThemedText>
                        </View>
                        <ScalePressable
                            onPress={handleAddPress}
                            style={[styles.headerAction, { backgroundColor: colors.surface, marginRight: 0 }]}
                            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                            innerStyle={{ borderRadius: DesignSystem.radius.full }}
                            scaleTo={0.88}
                            springConfig={DesignSystem.animation.springs.fast}
                        >
                            <PenTool size={22} color={colors.text} weight="fill" />
                        </ScalePressable>
                    </View>
                </Animated.View>

                <Animated.View style={[searchAnimatedStyle, { paddingHorizontal: 20 }]}>
                    <SearchBar
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search memories..."
                        style={{ height: 52, borderRadius: DesignSystem.radius.md }}
                        backgroundColor={colors.card}
                        borderColor={colors.text + '15'}
                    />
                </Animated.View>
            </View>

            <Animated.FlatList
                ref={journalListRef}
                data={filteredJournals}
                keyExtractor={(item) => `journal-${item.id}-${tabFocusKey}`}
                extraData={tabFocusKey}
                renderItem={renderJournalItem}
                ListHeaderComponent={listHeader}
                contentContainerStyle={[
                    styles.list,
                    { paddingBottom: insets.bottom + 100 },
                    filteredJournals.length === 0 && { flexGrow: 1 }
                ]}
                showsVerticalScrollIndicator={false}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={true}
                ListEmptyComponent={
                    isLoading ? null : (
                        <View style={[
                            styles.emptyContainer,
                            searchQuery.trim().length > 0 && keyboardVisible && styles.emptyKeyboardShift
                        ]}>
                            {searchQuery ? <SearchNoResults size={64} color={colors.icon} weight="fill" /> : <PenTool size={48} color={colors.tint} weight="fill" />}
                            <ThemedText style={[styles.emptyTitle, { fontFamily: Typography.fontFamily.bold }]}>
                                {searchQuery ? 'No results' : 'Journal'}
                            </ThemedText>
                            {searchQuery && (
                                <ThemedText style={[styles.emptySubtitle, { color: colors.secondary }]}>
                                    {`No matches for "${searchQuery}"`}
                                </ThemedText>
                            )}
                            {!searchQuery && (
                                <Button
                                    title="Write First Journal"
                                    onPress={handleAddPress}
                                    style={styles.emptyButton}
                                />
                            )}
                        </View>
                    )
                }
            />

            <DeleteModal
                visible={entryToDelete !== null}
                title="Delete Entry"
                description="Are you sure you want to remove this journal entry?"
                onCancel={() => setEntryToDelete(null)}
                onDelete={confirmDelete}
            />

            <QuickScrollButton
                isScrolling={isScrolling}
                direction={scrollDirection}
                onPress={handleQuickScroll}
            />
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: DesignSystem.spacing.md,
        marginTop: DesignSystem.spacing.md,
        marginBottom: DesignSystem.spacing.lg,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {},
    headerAction: {
        width: 44,
        height: 44,
        borderRadius: DesignSystem.radius.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    list: {
        paddingHorizontal: DesignSystem.spacing.md,
        paddingTop: DesignSystem.spacing.xs,
    },
    journalItem: { marginBottom: DesignSystem.spacing.md },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    journalTitle: { fontSize: 18, marginBottom: 8 },
    journalContent: { fontSize: 16, lineHeight: 24, marginBottom: 16, fontWeight: '500' },
    tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    tagName: { marginLeft: 6, fontWeight: '600', opacity: 0.8 },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 40,
        alignItems: 'center',
    },
    emptyKeyboardShift: {
        transform: [{ translateY: -DesignSystem.spacing['3xl'] }],
    },
    emptyTitle: {
        fontSize: 20,
        marginTop: 6,
        marginBottom: 2,
        textAlign: 'center',
        fontFamily: Typography.fontFamily.bold,
    },
    emptySubtitle: {
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 20,
        opacity: 0.6,
        marginBottom: 20,
    },
    emptyButton: {
        alignSelf: 'center',
        paddingHorizontal: 28,
        borderRadius: 24,
        marginTop: 8,
    },
});
