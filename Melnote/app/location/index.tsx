import { View, StyleSheet, FlatList, Platform } from 'react-native';
import Animated, { FadeInDown, Layout, useSharedValue, useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { Card } from '../../components/ui/Card';
import { useRouter, Stack } from 'expo-router';
import { useState, useEffect, memo, useRef, useCallback } from 'react';
import { PersonRepository, Person } from '../../db/repositories/PersonRepository';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MapTrifold as Map, Globe } from '@/components/ui/Icon';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../../hooks/useAppTheme';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { QuickScrollButton } from '../../components/ui/QuickScrollButton';

// Module scope: defining this inside the screen created a new component type
// on every render, so React unmounted and rebuilt every card (and replayed its
// entrance animation) each time the list state changed.
const CityItem = memo(({ item, index, colors, hapticsEnabled, router }: any) => (
    <Animated.View
        layout={Layout.springify()}
        style={{ flex: 1, maxWidth: '48%' }}
    >
        <Animated.View
            entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(500)}
        >
            <ScalePressable
                onPress={() => {
                    if (hapticsEnabled && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                    router.push(`/location/${encodeURIComponent(item.name)}`);
                }}
                style={styles.locationItem}
                innerStyle={{ borderRadius: 24 }}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${item.count} ${item.count === 1 ? 'person' : 'people'}`}
            >
                <Card style={[styles.locationCard, { backgroundColor: colors.card, borderWidth: 0 }]} padding="none">
                    <View style={styles.locationCardInner}>
                        <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
                            <Globe size={24} color={colors.tint} weight="duotone" />
                        </View>

                        <View style={styles.locationInfo}>
                            <ThemedText style={styles.cityName} numberOfLines={1}>
                                {item.name}
                            </ThemedText>
                            <ThemedText style={[styles.peopleCount, { color: colors.secondary }]}>
                                {item.count} {item.count === 1 ? 'person' : 'people'}
                            </ThemedText>
                        </View>
                    </View>
                </Card>
            </ScalePressable>
        </Animated.View>
    </Animated.View>
));

export default function LocationsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [cityGroups, setCityGroups] = useState<{ name: string; count: number }[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { colors, hapticsEnabled } = useAppTheme();

    // Scroll Logic
    const scrollY = useSharedValue(0);
    const scrollDirection = useSharedValue<'up' | 'down'>('up');
    const isScrolling = useSharedValue(false);
    const lastScrollNotify = useSharedValue(0);
    const hideTimeout = useRef<any>(null);
    const listRef = useRef<FlatList>(null);

    const startHideTimer = useCallback(() => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => {
            isScrolling.value = false;
        }, 800);
    }, []);

    // Stop the pending hide timer when the screen goes away.
    useEffect(() => () => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
    }, []);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            const currentY = event.contentOffset.y;
            const diff = currentY - scrollY.value;

            if (Math.abs(diff) > 5) {
                scrollDirection.value = diff > 0 ? 'down' : 'up';
                isScrolling.value = currentY > 200;
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
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
        } else {
            listRef.current?.scrollToEnd({ animated: true });
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const data = await PersonRepository.getAll();

            // Group by City (Normalized to Title Case)
            const groups: { [key: string]: number } = {};
            data.forEach((p: Person) => {
                const rawCity = p.city?.trim();
                if (rawCity) {
                    // Better normalization: Title Case every word (e.g., "San francisco" -> "San Francisco")
                    const normalized = rawCity.split(' ').map(word =>
                        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    ).join(' ');
                    groups[normalized] = (groups[normalized] || 0) + 1;
                }
            });

            const sortedGroups = Object.keys(groups)
                .sort()
                .map(name => ({ name, count: groups[name] }));

            setCityGroups(sortedGroups);
        } catch (error) {
            // Without this the empty state would show as if there were no
            // cities, hiding the real failure.
            console.error('Failed to load cities:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const renderItem = useCallback(({ item, index }: { item: any; index: number }) => (
        <CityItem
            item={item}
            index={index}
            colors={colors}
            hapticsEnabled={hapticsEnabled}
            router={router}
        />
    ), [colors, hapticsEnabled, router]);

    return (
        <ThemedView style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="auto" />
            
            <ScreenHeader
                onBack={() => router.back()}
                alignCenter={false}
                centerContent={
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <ThemedText type="display" style={{ fontSize: 32 }}>Cities</ThemedText>
                    </View>
                }
            />

            <Animated.FlatList
                ref={listRef}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                data={cityGroups}
                keyExtractor={item => item.name}
                renderItem={renderItem}
                numColumns={2}
                columnWrapperStyle={styles.columnWrapper}
                contentContainerStyle={[
                    styles.list,
                    { paddingBottom: insets.bottom + 40 },
                    cityGroups.length === 0 && { flexGrow: 1 }
                ]}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    isLoading ? null : (
                        <View style={styles.emptyContainer}>
                            <Map size={48} color={colors.tint} weight="fill" />
                            <ThemedText style={styles.emptyTitle}>No Cities Yet</ThemedText>
                            <ThemedText style={[styles.emptySubtitle, { color: colors.secondary }]}>
                                Add a city to a person's profile to see them appear here.
                            </ThemedText>
                        </View>
                    )
                }
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
    columnWrapper: {
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        gap: 16,
    },
    list: {
        paddingTop: 12,
    },
    locationItem: { 
        marginBottom: 16,
    },
    locationCard: {
        borderRadius: 24,
    },
    locationCardInner: {
        padding: 20,
        height: 160,
        justifyContent: 'space-between',
    },
    iconBox: {
        width: 48,
        height: 48,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    locationInfo: {
        marginTop: 12,
    },
    cityName: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.bold,
        marginBottom: 4,
    },
    peopleCount: {
        fontSize: 11,
        fontFamily: Typography.fontFamily.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        opacity: 0.7,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 40,
        alignItems: 'center',
        marginTop: -60, // Adjust to account for header height and feel truly centered
    },
    emptyTitle: {
        fontSize: 20,
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
        fontFamily: Typography.fontFamily.bold,
    },
    emptySubtitle: {
        textAlign: 'center',
        fontSize: 14,
        lineHeight: 22,
        opacity: 0.6,
    },
});
