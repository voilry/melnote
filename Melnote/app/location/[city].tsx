import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, FlatList } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { PersonRepository, Person } from '../../db/repositories/PersonRepository';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { SearchBar } from '../../components/ui/SearchBar';
import {
    CaretRight,
    MapTrifold as MapEmpty,
    Users,
    PushPin,
} from '@/components/ui/Icon';
import Animated, { FadeIn, FadeInDown, Layout, useSharedValue, useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { QuickScrollButton } from '../../components/ui/QuickScrollButton';

export default function CityDetailScreen() {
    const { city } = useLocalSearchParams<{ city: string }>();
    const router = useRouter();
    const { colors, hapticsEnabled } = useAppTheme();
    const insets = useSafeAreaInsets();
    // expo-router hands back an array when a param appears more than once.
    const cityName = Array.isArray(city) ? city[0] : city;

    const [people, setPeople] = useState<Person[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');

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
                isScrolling.value = currentY > 300;
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

    useEffect(() => { loadPeople(); }, [cityName]);

    const loadPeople = async () => {
        setIsLoading(true);
        try {
            const all = await PersonRepository.getAll();
            const cityFilter = cityName?.trim().toLowerCase();
            // Normalize and filter by city
            const cityPeople = all.filter(p => p.city?.trim().toLowerCase() === cityFilter);
            // Sort by pinned first, then name
            cityPeople.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return a.name.localeCompare(b.name);
            });
            setPeople(cityPeople);
        } catch (error) {
            // Without this the screen would sit on the empty state forever.
            console.error('Failed to load city members:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredPeople = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return people;
        return people.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.elevatorPitch ? p.elevatorPitch.toLowerCase().includes(q) : false)
        );
    }, [people, search]);

    const renderItem = useCallback(({ item: person, index }: { item: Person, index: number }) => (
        <Animated.View
            layout={Layout.springify()}
        >
            <Animated.View
                entering={FadeInDown.delay(Math.min(index, 6) * 50).duration(500)}
            >
                <ScalePressable
                    onPress={() => {
                        if (hapticsEnabled && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                        router.push(`/person/${person.id}`);
                    }}
                    style={styles.pressable}
                    innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                    accessibilityRole="button"
                    accessibilityLabel={person.name}
                >
                    <Card style={styles.personCard}>
                        <View style={styles.cardMain}>
                            <Avatar name={person.name} uri={person.avatarUri} size={54} />

                            <View style={styles.personInfo}>
                                <View style={styles.nameRow}>
                                    <ThemedText style={styles.personName}>
                                        {person.name}
                                    </ThemedText>
                                    {person.isPinned && (
                                        <PushPin size={14} color={colors.tint} weight="fill" style={{ marginLeft: 6 }} />
                                    )}
                                </View>

                                <ThemedText
                                    type="small"
                                    numberOfLines={1}
                                    style={{ color: colors.secondary, opacity: 0.8 }}
                                >
                                    {person.elevatorPitch || 'No description added'}
                                </ThemedText>
                            </View>

                            <CaretRight size={18} color={colors.icon} style={{ opacity: 0.3 }} />
                        </View>
                    </Card>
                </ScalePressable>
            </Animated.View>
        </Animated.View>
    ), [colors.tint, hapticsEnabled, router]);

    return (
        <ThemedView style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="auto" />

            <ScreenHeader
                onBack={() => router.back()}
                style={styles.header}
                title={cityName}
                alignCenter={false}
            />

            <Animated.FlatList
                ref={listRef}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                data={filteredPeople}
                keyExtractor={item => `city-person-${item.id}`}
                renderItem={renderItem}
                contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                    <View style={styles.listHeader}>
                        <SearchBar
                            value={search}
                            onChangeText={setSearch}
                            placeholder="Search in city..."
                            style={styles.searchBar}
                        />

                    </View>
                }
                ListEmptyComponent={
                    !isLoading ? (
                        <Animated.View entering={FadeIn.duration(400)} style={styles.emptyState}>
                            <MapEmpty size={48} color={colors.tint} weight="fill" />
                            <ThemedText style={{ marginTop: 16, opacity: 0.9, fontSize: 18, fontFamily: Typography.fontFamily.bold }}>
                                {search ? 'No matches' : 'No contacts here'}
                            </ThemedText>
                            <ThemedText style={[styles.emptySubtitle, { color: colors.secondary }]}>
                                {search
                                    ? `Could not find anyone matching "${search}" in ${cityName}.`
                                    : `Nobody is listed under this city yet. You can add a city to a person's profile to see them here.`}
                            </ThemedText>
                        </Animated.View>
                    ) : null
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
    header: { paddingBottom: 0 },

    listHeader: {
        marginBottom: 8,
    },
    searchBar: {
        height: 58,
        borderRadius: DesignSystem.radius.xl,
        marginBottom: 8,
        paddingTop: 5,
    },

    // List
    listContent: {
        paddingTop: 12,
        paddingHorizontal: 16,
        gap: 12,
    },

    // Person card
    pressable: {
        marginBottom: 0,
    },
    personCard: {
        padding: 0,
        overflow: 'hidden',
    },
    cardMain: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        gap: 16,
    },
    personInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    personName: {
        fontSize: 17,
        fontFamily: Typography.fontFamily.bold,
    },

    // Empty
    emptyState: {
        alignItems: 'center',
        paddingTop: 60,
        paddingHorizontal: 40,
    },
    emptySubtitle: {
        fontSize: 14,
        marginTop: 10,
        textAlign: 'center',
        lineHeight: 22,
        opacity: 0.7,
    },
});
