
import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable, Platform, InteractionManager } from 'react-native';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedScrollHandler, runOnJS, useAnimatedStyle, withSpring, Easing, Extrapolation, interpolate } from 'react-native-reanimated';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { PersonRepository, Person } from '../../db/repositories/PersonRepository';
import { EntryRepository } from '../../db/repositories/EntryRepository';
import { JournalRepository } from '../../db/repositories/JournalRepository';
import { RelationshipRepository } from '../../db/repositories/RelationshipRepository';

import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { Trash, CaretLeft as ChevronLeft, DotsThree as MoreHorizontal, Info, ChatCenteredText as MessageSquare, BookOpen, Folder, PencilSimple as Edit, Star, Users, Briefcase, Heart, Lightning as Zap, Coffee, House as Home, Globe, Airplane as Plane, MusicNote as Music, Smiley as Smile, ContactsFour } from '@/components/ui/Icon';
import { GroupRepository, Group } from '../../db/repositories/GroupRepository';
import { useFocusEffect } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSettings } from '../../store/SettingsContext';
import { useAvatarVibe } from '../../hooks/useAvatarVibe';
import { getAvatarVibe } from '../../utils/avatarVibe';
import { getAcrylicPalette } from '../../utils/acrylic';
import { AvatarAura } from '../../components/person/AvatarAura';

// Extracted Components
import { PersonHeader } from '../../components/person/PersonHeader';
import { InfoTab } from '../../components/person/InfoTab';
import { EntriesTab } from '../../components/person/EntriesTab';
import { JournalsTab } from '../../components/person/JournalsTab';
import { ContactsTab } from '../../components/person/ContactsTab';
import { EditPersonModal } from '../../components/person/EditPersonModal';
import { ContactRepository, Contact } from '../../db/repositories/ContactRepository';
import { ManageGroupsModal } from '../../components/person/ManageGroupsModal';
import { DeleteModal } from '../../components/ui/DeleteModal';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { Button } from '../../components/ui/Button';
import { showToast } from '../../components/ui/Toast';

export default function PersonDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { colors, theme, hapticsEnabled } = useAppTheme();
    const { settings } = useSettings();
    const insets = useSafeAreaInsets();

    const [isLoading, setIsLoading] = useState(true);
    const [person, setPerson] = useState<Person | null>(null);
    const [entries, setEntries] = useState<any[]>([]);
    const [journals, setJournals] = useState<any[]>([]);
    const [relationships, setRelationships] = useState<any[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);

    const [allPeople, setAllPeople] = useState<Person[]>([]);
    const [personGroups, setPersonGroups] = useState<Group[]>([]);
    const [allGroups, setAllGroups] = useState<Group[]>([]);

    const getTabId = (tab: string) => tab === 'notes' ? 'entries' : tab;

    const orderedTabs = settings.profileTabsOrder.filter(tab => {
        if (tab === 'journals' && !settings.showJournalTab) return false;
        return true;
    });

    const [activeTab, setActiveTab] = useState<'info' | 'entries' | 'journals' | 'contacts'>(() => {
        if (orderedTabs.length > 0) return getTabId(orderedTabs[0]) as any;
        return 'info';
    });
    const [headerVisible, setHeaderVisible] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);

    // Modal Visibility States
    const [showEditModal, setShowEditModal] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [profileToDelete, setProfileToDelete] = useState(false);
    const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
    const [journalToDelete, setJournalToDelete] = useState<number | null>(null);
    const [contactToDelete, setContactToDelete] = useState<number | null>(null);

    const loadGeneration = useRef(0);

    const loadData = useCallback(async () => {
        // expo-router params can arrive as string | string[]
        const personId = Number(Array.isArray(id) ? id[0] : id);
        if (!Number.isFinite(personId)) {
            setPerson(null);
            setIsLoading(false);
            return;
        }

        const generation = ++loadGeneration.current;
        const isStale = () => generation !== loadGeneration.current;

        let p: Person | null = null;
        try {
            p = await PersonRepository.getById(personId);
        } catch (error) {
            // The screen would otherwise stay on the blank loading view forever.
            console.error('Failed to load profile:', error);
            if (!isStale()) setIsLoading(false);
            return;
        }
        if (isStale()) return;
        if (!p) {
            setPerson(null);
            setIsLoading(false);
            return;
        }

        // Pre-warm the acrylic palette if fast/cached, but never hold back
        // the screen transition if cold extraction takes longer.
        if (settings.profileBlurBackground && p.avatarUri) {
            await Promise.race([
                getAvatarVibe(p.avatarUri),
                new Promise((resolve) => setTimeout(resolve, 35)),
            ]);
            if (isStale()) return;
        }

        setPerson(p);
        setIsLoading(false); // Unblock screen render instantly (~5ms)

        try {
            // Let the push transition finish before hitting the DB with
            // secondary queries, so the open animation stays smooth.
            await new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));
            if (isStale()) return;

            const [e, j, r, pg, g, c] = await Promise.all([
                EntryRepository.getForPerson(personId),
                JournalRepository.getJournalsForPerson(personId),
                RelationshipRepository.getForPerson(personId),
                GroupRepository.getGroupsForPerson(personId),
                GroupRepository.getAll(),
                ContactRepository.getContactsForPerson(personId)
            ]);
            if (isStale()) return;

            // The full people list is only needed to resolve relationship
            // names/avatars — skip the table scan entirely when there are none.
            let relatedPeople: Person[] = [];
            if (r.length > 0) {
                const all = await PersonRepository.getAll();
                if (isStale()) return;
                relatedPeople = all.filter(x => x.id !== personId);
            }

            setEntries(e);
            setJournals(j);
            setRelationships(r);
            setPersonGroups(pg);
            setAllGroups(g);
            setAllPeople(relatedPeople);
            setContacts(c);
        } catch (error) {
            console.error('Error loading secondary tab data:', error);
        }
    }, [id, settings.profileBlurBackground]);

    useFocusEffect(
        useCallback(() => {
            if (id) loadData();
            return () => {
                // Invalidate any in-flight load on blur/unmount so a slow
                // stale response can never overwrite fresh state.
                loadGeneration.current++;
            };
        }, [loadData])
    );

    const toggleGroup = async (groupId: number) => {
        if (!person) return;
        const isAssigned = personGroups.some(g => g.id === groupId);

        try {
            if (isAssigned) {
                await GroupRepository.removePersonFromGroup(person.id, groupId);
            } else {
                await GroupRepository.addPersonToGroup(person.id, groupId);
            }

            // Refresh local groups
            const pg = await GroupRepository.getGroupsForPerson(person.id);
            setPersonGroups(pg);
        } catch (error) {
            console.error('Failed to update group membership:', error);
            showToast('Could not update group membership');
        }
    };

    const handleDeletePerson = () => {
        setProfileToDelete(true);
    };

    const confirmDeletePerson = async () => {
        const personId = person?.id ?? Number(Array.isArray(id) ? id[0] : id);
        setProfileToDelete(false);
        if (!Number.isFinite(personId)) return;
        try {
            await PersonRepository.delete(personId);
            router.back();
        } catch (error) {
            console.error('Failed to delete profile:', error);
            showToast('Could not delete profile');
        }
    };



    const handleUpdateProfile = async (data: any) => {
        if (!person) return;
        try {
            await PersonRepository.update(person.id, data);
            setShowEditModal(false);
            loadData();
        } catch (error) {
            console.error('Failed to update profile:', error);
            showToast('Could not update profile');
        }
    };

    const openNewNote = () => {
        if (!person) return;
        router.push({
            pathname: '/editor',
            params: {
                id: 'new',
                type: 'entry',
                personId: person.id,
                edit: 'true',
            },
        });
    };

    const handleDeleteEntry = (entryId: number) => {
        setEntryToDelete(entryId);
    };

    const confirmDeleteEntry = async () => {
        if (entryToDelete === null) return;
        const entryId = entryToDelete;
        setEntryToDelete(null);
        // Optimistic removal so the row goes away immediately; a failed
        // delete reloads to restore reality.
        setEntries(prev => prev.filter(e => e.id !== entryId));
        try {
            await EntryRepository.delete(entryId);
        } catch (error) {
            console.error('Failed to delete entry:', error);
            showToast('Could not delete note');
            loadData();
        }
    };

    const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
        if (hapticsEnabled && Platform.OS !== 'web') {
            Haptics.impactAsync(style).catch(() => {});
        }
    };

    const handleDeleteJournal = (journalId: number) => {
        setJournalToDelete(journalId);
    };

    const confirmDeleteJournal = async () => {
        if (journalToDelete === null) return;
        const journalId = journalToDelete;
        setJournalToDelete(null);
        setJournals(prev => prev.filter(j => j.id !== journalId));
        try {
            await JournalRepository.delete(journalId);
        } catch (error) {
            console.error('Failed to delete journal entry:', error);
            showToast('Could not delete journal entry');
            loadData();
        }
    };

    const confirmDeleteContact = async () => {
        if (contactToDelete === null) return;
        const contactId = contactToDelete;
        setContactToDelete(null);
        setContacts(prev => prev.filter(c => c.id !== contactId));
        try {
            await ContactRepository.deleteContact(contactId);
        } catch (error) {
            console.error('Failed to delete contact:', error);
            showToast('Could not delete contact');
            loadData();
        }
    };

    const parseFlexibleDate = (dateStr: string) => {
        let d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d;
        d = new Date(dateStr.replace(/-/g, '/'));
        if (!isNaN(d.getTime())) return d;
        d = new Date(dateStr.replace(/\//g, '-'));
        if (!isNaN(d.getTime())) return d;
        return new Date(NaN);
    };

    const getAge = (birthdate?: string | null) => {
        if (!birthdate) return null;
        const birthDate = parseFlexibleDate(birthdate);
        if (isNaN(birthDate.getTime())) return null;

        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
        return age;
    };

    const avatarVibeUri = settings.profileBlurBackground ? (person?.avatarUri ?? null) : null;
    const avatarVibe = useAvatarVibe(avatarVibeUri);
    const acrylic = useMemo(
        () => getAcrylicPalette(colors, theme, avatarVibe),
        [colors, theme, avatarVibe]
    );

    const blurTargetRef = useRef<View>(null);
    const heroNameBottom = useSharedValue(300);
    const scrollY = useSharedValue(0);
    const headerVisibleSV = useSharedValue(false);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
            // Shared-value guard: dispatch to JS exactly once per transition
            // instead of on every frame until the re-render commits.
            const shouldShow = event.contentOffset.y > 4;
            if (shouldShow !== headerVisibleSV.value) {
                headerVisibleSV.value = shouldShow;
                runOnJS(setHeaderVisible)(shouldShow);
            }
        },
    });

    // The header arrives continuously with the scroll, matching the Manage
    // Group Members header: the material backdrop fades first, then the title
    // settles into place from a short vertical offset.
    const headerBackdropStyle = useAnimatedStyle(() => {
        const revealY = heroNameBottom.value - (insets.top + 64);
        return {
            opacity: interpolate(
                scrollY.value,
                [revealY - 24, revealY + 36],
                [0, 1],
                Extrapolation.CLAMP
            ),
        };
    });

    const headerIdentityStyle = useAnimatedStyle(() => {
        const revealY = heroNameBottom.value - (insets.top + 64);
        const progress = interpolate(
            scrollY.value,
            [revealY, revealY + 44],
            [0, 1],
            Extrapolation.CLAMP
        );
        return {
            opacity: progress,
            transform: [{ translateY: interpolate(progress, [0, 1], [9, 0]) }],
        };
    });

    const handleTabChange = (tab: any) => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setActiveTab(tab);
    };

    const getTabIcon = (tab: string) => {
        switch (tab) {
            case 'info': return Info;
            case 'notes': return MessageSquare;
            case 'journals': return BookOpen;
            case 'contacts': return ContactsFour;
            default: return Info;
        }
    };

    if (isLoading) {
        return <ThemedView style={styles.container} />;
    }

    if (!person) {
        return (
            <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <ThemedText type="subtitle" style={{ marginBottom: 12, textAlign: 'center' }}>
                    Contact Not Found
                </ThemedText>
                <ThemedText style={{ color: colors.secondary, marginBottom: 24, textAlign: 'center' }}>
                    This profile may have been deleted or the link is invalid.
                </ThemedText>
                <Button title="Go Back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} />
            </ThemedView>
        );
    }

    const age = getAge(person.birthdate);

    const isAcrylic = settings.profileBlurBackground && !!person.avatarUri;

    return (
        <ThemedView style={[styles.container, isAcrylic && { backgroundColor: 'transparent' }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <BlurTargetView ref={blurTargetRef} style={StyleSheet.absoluteFill}>
                {isAcrylic && acrylic.aura && (
                    <Animated.View entering={FadeIn.duration(300)} style={StyleSheet.absoluteFill} pointerEvents="none">
                        <AvatarAura aura={acrylic.aura} />
                    </Animated.View>
                )}

                <Animated.ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                    onScroll={scrollHandler}
                    scrollEventThrottle={16}
                >
                <PersonHeader
                    person={person}
                    onEdit={() => setShowEditModal(true)}
                    scrollY={scrollY}
                    isAcrylic={isAcrylic}
                    acrylic={acrylic}
                    onNameBottomChange={(bottom) => {
                        heroNameBottom.value = bottom;
                    }}
                />



                <Animated.View entering={FadeInDown.delay(60).duration(260).springify().damping(24).stiffness(280).mass(0.7)}>
                    <ProfileTabBar
                        orderedTabs={orderedTabs}
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        getTabIcon={getTabIcon}
                        colors={colors}
                        theme={theme}
                        isAcrylic={isAcrylic}
                        acrylic={acrylic}
                    />
                </Animated.View>

                <Animated.View key={activeTab} entering={FadeIn.duration(200).easing(Easing.bezier(0.05, 0.7, 0.1, 1.0))} style={styles.content}>
                    {activeTab === 'info' && (
                        <InfoTab
                            person={person}
                            age={age}
                            relationships={relationships}
                            allPeople={allPeople}
                            onEdit={() => router.push(`/person/${person.id}/locations`)}
                            onEditProfile={() => setShowEditModal(true)}
                            isAcrylic={isAcrylic}
                            acrylic={acrylic}
                        />
                    )}

                    {activeTab === 'entries' && (
                        <EntriesTab
                            entries={entries}
                            onAdd={openNewNote}
                            onDelete={handleDeleteEntry}
                            theme={theme}
                            isAcrylic={isAcrylic}
                            acrylic={acrylic}
                        />
                    )}

                    {activeTab === 'journals' && (
                        <JournalsTab
                            journals={journals}
                            personName={person.name}
                            onDelete={handleDeleteJournal}
                            isAcrylic={isAcrylic}
                            acrylic={acrylic}
                        />
                    )}

                    {activeTab === 'contacts' && (
                        <ContactsTab
                            contacts={contacts}
                            onAdd={() => router.push({ pathname: '/contact/[id]', params: { id: 'new', personId: person.id } })}
                            onDelete={(id: number) => setContactToDelete(id)}
                            onEdit={(id: number) => router.push({ pathname: '/contact/[id]', params: { id: id } })}
                            theme={theme}
                            colors={colors}
                            isAcrylic={isAcrylic}
                            acrylic={acrylic}
                        />
                    )}
                </Animated.View>

                {/* Group Chips (Moved to Bottom) - Only Show in Info Tab */}
                {activeTab === 'info' && personGroups.length > 0 && (
                    <Animated.View
                        entering={FadeInDown.delay(330).duration(480).springify().damping(22).stiffness(110).mass(1.0)}
                        style={{ paddingHorizontal: 20, paddingBottom: 40, marginTop: 20 }}
                    >
                        <ThemedText type="sectionHeader" style={{ fontSize: 16, marginBottom: 12, opacity: 0.7 }}>Groups</ThemedText>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {personGroups.map((g, idx) => {
                                const groupAcrylicBg = isAcrylic
                                    ? acrylic.accent
                                    : (theme === 'light' ? colors.surface : 'rgba(255,255,255,0.08)');

                                return (
                                    <Animated.View
                                        key={g.id}
                                        entering={FadeInDown.delay(330 + Math.min(idx, 6) * 16).duration(380).springify().damping(22).stiffness(140).mass(0.85)}
                                    >
                                        {/* Not pressable: a chip that scales under the
                                            finger but does nothing reads as broken. */}
                                        <View
                                            style={[styles.groupChip, { backgroundColor: groupAcrylicBg, borderColor: 'transparent', paddingVertical: 6, paddingHorizontal: 12 }]}
                                        >
                                            {getGroupIcon(g.icon, colors.tint, 14)}
                                            <ThemedText style={{ fontSize: 13, color: colors.tint, fontFamily: Typography.fontFamily.bold, marginLeft: 6 }}>{g.name}</ThemedText>
                                        </View>
                                    </Animated.View>
                                );
                            })}
                        </View>
                    </Animated.View>
                )}
                </Animated.ScrollView>
            </BlurTargetView>

            <View pointerEvents="box-none" style={styles.topBarWrapper}>
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, headerBackdropStyle]}
                >
                    {headerVisible && (isAcrylic || Platform.OS === 'ios') && (
                        <BlurView
                            blurTarget={blurTargetRef}
                            blurMethod={Platform.OS === 'android'
                                ? (Platform.Version >= 31 ? 'dimezisBlurViewSdk31Plus' : 'dimezisBlurView')
                                : undefined}
                            blurReductionFactor={Platform.OS === 'android' ? 3 : undefined}
                            intensity={theme === 'dark' ? 68 : 60}
                            tint={theme === 'dark' ? 'systemChromeMaterialDark' : 'systemMaterialLight'}
                            style={StyleSheet.absoluteFill}
                            pointerEvents="none"
                        />
                    )}
                    {!isAcrylic && (
                        <View
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: theme === 'dark'
                                        ? `${colors.background}D9`
                                        : `${colors.background}E6`,
                                },
                            ]}
                        />
                    )}
                </Animated.View>

                <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                    <View style={styles.topBarContent}>
                        <ScalePressable
                            style={styles.headerIconButton}
                            onPress={() => {
                                triggerHaptic();
                                router.back();
                            }}
                            innerStyle={{ borderRadius: 22 }}
                            hitSlop={{ top: 30, bottom: 30, left: 30, right: 30 }}
                        >
                            <ChevronLeft size={26} color={colors.text} />
                        </ScalePressable>

                        <View style={{ flex: 1 }} />

                        <ScalePressable
                            style={styles.headerIconButton}
                            onPress={() => setShowMoreMenu(true)}
                            innerStyle={{ borderRadius: 22 }}
                        >
                            <MoreHorizontal size={24} color={colors.text} />
                        </ScalePressable>
                    </View>
                </View>

                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.topBarIdentity,
                        { top: insets.top + 8, height: 42 },
                        headerIdentityStyle,
                    ]}
                >
                    <ThemedText style={styles.topBarTitle} numberOfLines={1}>{person.name}</ThemedText>
                </Animated.View>
            </View>

            <EditPersonModal
                visible={showEditModal}
                onClose={() => setShowEditModal(false)}
                onSave={handleUpdateProfile}
                person={person}
            />





            <Modal visible={showMoreMenu} transparent animationType="fade" statusBarTranslucent>
                <Pressable
                    style={[styles.modalOverlay, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}
                    onPress={() => setShowMoreMenu(false)}
                >
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
                    />

                    {/* Replicated Button for Focus Persistence */}
                    <View style={{ position: 'absolute', top: insets.top + 10, right: 12 }}>
                        <View style={[styles.headerIconButton, { backgroundColor: colors.surface, borderRadius: 21 }]}>
                            <MoreHorizontal size={24} color={colors.text} />
                        </View>
                    </View>

                    <Animated.View
                        entering={FadeInDown.duration(200).springify()}
                        style={[styles.menuContent, { top: insets.top + 56, backgroundColor: colors.card, ...DesignSystem.shadows.lg }]}>
                        <ScalePressable
                            style={styles.menuItem}
                            onPress={() => {
                                setShowMoreMenu(false);
                                setShowEditModal(true);
                            }}
                            innerStyle={{ borderRadius: 12 }}
                        >
                            <Edit size={18} color={colors.text} weight="fill" />
                            <ThemedText style={styles.menuText}>Edit Profile</ThemedText>
                        </ScalePressable>

                        <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.6, marginHorizontal: 8 }} />

                        <ScalePressable
                            style={styles.menuItem}
                            onPress={() => {
                                setShowMoreMenu(false);
                                setShowGroupModal(true);
                            }}
                            innerStyle={{ borderRadius: 12 }}
                        >
                            <Folder size={18} color={colors.text} weight="fill" />
                            <ThemedText style={styles.menuText}>Manage Groups</ThemedText>
                        </ScalePressable>

                        <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.6, marginHorizontal: 8 }} />

                        <ScalePressable
                            style={styles.menuItem}
                            onPress={() => {
                                setShowMoreMenu(false);
                                handleDeletePerson();
                            }}
                            innerStyle={{ borderRadius: 12 }}
                        >
                            <Trash size={18} color={colors.error} weight="fill" />
                            <ThemedText style={[styles.menuText, { color: colors.error, fontFamily: Typography.fontFamily.bold }]}>Delete Profile</ThemedText>
                        </ScalePressable>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Manage Groups Modal */}
            <ManageGroupsModal
                visible={showGroupModal}
                onClose={() => setShowGroupModal(false)}
                personName={person.name}
                allGroups={allGroups}
                personGroups={personGroups}
                onToggleGroup={toggleGroup}
            />

            <DeleteModal
                visible={profileToDelete}
                title="Delete Profile"
                description={`Are you sure you want to delete ${person?.name}? This action cannot be undone.`}
                onCancel={() => setProfileToDelete(false)}
                onDelete={confirmDeletePerson}
            />

            <DeleteModal
                visible={entryToDelete !== null}
                title="Delete Note"
                description="Are you sure you want to remove this note?"
                onCancel={() => setEntryToDelete(null)}
                onDelete={confirmDeleteEntry}
            />

            <DeleteModal
                visible={journalToDelete !== null}
                title="Delete Journal Entry"
                description="Are you sure you want to remove this journal entry?"
                onCancel={() => setJournalToDelete(null)}
                onDelete={confirmDeleteJournal}
            />

            <DeleteModal
                visible={contactToDelete !== null}
                title="Delete Contact"
                description="Are you sure you want to remove this contact?"
                onCancel={() => setContactToDelete(null)}
                onDelete={confirmDeleteContact}
            />
        </ThemedView>
    );
}

const getGroupIcon = (name: string | null, color: string, size = 16) => {
    const weight = "fill";
    switch (name) {
        case 'Star': return <Star size={size} color={color} weight={weight} />;
        case 'Briefcase': return <Briefcase size={size} color={color} weight={weight} />;
        case 'Heart': return <Heart size={size} color={color} weight={weight} />;
        case 'Users': return <Users size={size} color={color} weight={weight} />;
        case 'Zap': return <Zap size={size} color={color} weight={weight} />;
        case 'Coffee': return <Coffee size={size} color={color} weight={weight} />;
        case 'Home': return <Home size={size} color={color} weight={weight} />;
        case 'Globe': return <Globe size={size} color={color} weight={weight} />;
        case 'Plane': return <Plane size={size} color={color} weight={weight} />;
        case 'Music': return <Music size={size} color={color} weight={weight} />;
        case 'Book': return <BookOpen size={size} color={color} weight={weight} />;
        case 'Smile': return <Smile size={size} color={color} weight={weight} />;
        default: return <Folder size={size} color={color} weight={weight} />;
    }
};

function ProfileTabBar({
    orderedTabs,
    activeTab,
    onTabChange,
    getTabIcon,
    colors,
    theme,
    isAcrylic,
    acrylic
}: any) {
    const [width, setWidth] = useState(0);
    const activeIndex = orderedTabs.findIndex((t: string) => (t === 'notes' ? 'entries' : t) === activeTab);
    const activeBg = isAcrylic
        ? acrylic.indicator
        : (theme === 'dark' ? colors.card : colors.surface);

    const pillStyle = useAnimatedStyle(() => {
        if (width === 0 || orderedTabs.length === 0) return { opacity: 0 };
        const tabWidth = (width - 10) / orderedTabs.length;
        const validIndex = activeIndex >= 0 ? activeIndex : 0;
        return {
            width: tabWidth,
            transform: [
                {
                    translateX: withSpring(5 + validIndex * tabWidth, {
                        damping: 20,
                        stiffness: 240,
                        mass: 0.8,
                    })
                }
            ],
            opacity: 1,
        };
    });

    return (
        <View
            style={[
                styles.tabContainer,
                isAcrylic ? {
                    overflow: 'hidden',
                    backgroundColor: acrylic.chrome,
                    borderWidth: 0,
                } : {
                    backgroundColor: theme === 'dark' ? colors.surface : colors.card,
                    borderWidth: 0,
                }
            ]}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
            {/* Material 3 Expressive Sliding Indicator Pill */}
            <Animated.View
                style={[
                    styles.slidingPill,
                    { backgroundColor: activeBg },
                    pillStyle
                ]}
                pointerEvents="none"
            />

            {orderedTabs.map((tab: string) => {
                const tabId = tab === 'notes' ? 'entries' : tab;
                const active = activeTab === tabId;
                const Icon = getTabIcon(tab);

                return (
                    <ScalePressable
                        key={tab}
                        onPress={() => onTabChange(tabId)}
                        scaleTo={0.92}
                        style={styles.tab}
                        innerStyle={{ borderRadius: 10 }}
                        overlayColor="transparent"
                        accessibilityRole="button"
                        accessibilityLabel={tab.charAt(0).toUpperCase() + tab.slice(1)}
                    >
                        <View style={styles.tabContent} collapsable={false}>
                            <Icon
                                color={active ? colors.tint : colors.icon}
                                size={18}
                                weight={active ? 'fill' : 'regular'}
                            />
                        </View>
                    </ScalePressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBarWrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
    },
    topBar: {
        justifyContent: 'flex-end',
    },
    topBarContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingBottom: 14,
    },
    topBarIdentity: {
        position: 'absolute',
        left: 62,
        right: 62,
        alignItems: 'center',
        justifyContent: 'center',
    },
    topBarTitle: {
        fontSize: 17,
        fontFamily: Typography.fontFamily.bold,
        textAlign: 'center',
        marginHorizontal: 10,
        includeFontPadding: false,
    },
    headerIconButton: {
        width: 42,
        height: 42,
        borderRadius: 21,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    scrollContent: { paddingBottom: 120 },
    tabContainer: {
        flexDirection: 'row',
        marginHorizontal: 20,
        padding: 5,
        borderRadius: 14,
        borderWidth: 0,
        position: 'relative',
    },
    slidingPill: {
        position: 'absolute',
        top: 5,
        bottom: 5,
        borderRadius: 10,
        zIndex: 0,
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderRadius: 10,
        alignItems: 'center',
        zIndex: 1,
    },
    tabContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    content: { paddingHorizontal: 20, marginTop: 12 },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    menuContent: {
        borderRadius: 16,
        padding: 6,
        minWidth: 180,
        position: 'absolute',
        right: 16,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingLeft: 12,
        paddingRight: 16,
        borderRadius: 12,
    },
    menuText: {
        marginLeft: 12,
        fontFamily: Typography.fontFamily.semibold,
    },
    groupChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 0,
    },
});
