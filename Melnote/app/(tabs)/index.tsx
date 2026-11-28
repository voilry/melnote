import { View, StyleSheet, FlatList, TouchableOpacity, Modal, Platform, ScrollView, DeviceEventEmitter, Pressable, BackHandler, DimensionValue } from 'react-native';
import { KeyboardAwareScrollView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeIn, FadeOut, SlideInDown, FadeOutDown, ZoomIn, useSharedValue, useAnimatedScrollHandler, runOnJS, Easing } from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { Input } from '../../components/ui/Input';
import { Avatar } from '../../components/ui/Avatar';
import { DatePicker } from '../../components/ui/DatePicker';
import { useRouter } from 'expo-router';
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { PersonRepository, Person } from '../../db/repositories/PersonRepository';
import { GroupRepository, Group } from '../../db/repositories/GroupRepository';
import { JournalRepository } from '../../db/repositories/JournalRepository';
import { SettingsRepository } from '../../db/repositories/SettingsRepository';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router/react-navigation';
import { Button } from '../../components/ui/Button';
import { MagnifyingGlass as Search, SearchNoResults, Camera, X, Check, CaretLeft, Faders as Filter, Gear as Settings, User as UserIcon, Book, PushPin } from '@/components/ui/Icon';
import { Skeleton } from '../../components/ui/Skeleton';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { SearchBar } from '../../components/ui/SearchBar';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../../hooks/useAppTheme';
import { GroupSelector, GroupSelectorHandle } from '../../components/GroupSelector';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { useModalPresence } from '../../components/ui/useModalPresence';
import { useFullScreenModal } from '../../components/ui/useFullScreenModal';
import { PersonPickerModal } from '../../components/person/PersonPickerModal';
import { QuickNoteModal } from '../../components/person/QuickNoteModal';
import { GalleryPersonCard } from '../../components/person/GalleryPersonCard';
import { DashboardGroupCard } from '../../components/person/DashboardGroupCard';
import { ManageGroupMembersModal } from '../../components/person/ManageGroupMembersModal';
import { EntryRepository } from '../../db/repositories/EntryRepository';
import { markdownPreviewText } from '../../utils/markdownConverter';
import { persistCroppedAvatar, deleteAvatarFile } from '../../utils/avatar';
import { usePickerHost } from '../../components/ui/usePickerHost';
import type { MediaCropRect } from '../../utils/media';
import { ImageCropView } from '../../components/ui/ImageCropView';
import { useSettings } from '../../store/SettingsContext';
import { AddReminderModal } from '../../components/calendar/AddReminderModal';
import { DeleteModal } from '../../components/ui/DeleteModal';
import { ContactRepository } from '../../db/repositories/ContactRepository';
import { AddressBook } from '@/components/ui/Icon';
import { QuickScrollButton } from '../../components/ui/QuickScrollButton';

const sameGlanceIds = (a: any[], b: any[], getId: (x: any) => any = (x) => x.id) =>
    a.length === b.length && a.every((x, i) => getId(x) === getId(b[i]));

// People digest moves in days/weeks, so refetching more often than this
// is just battery for nothing.
const GLANCE_CACHE_MS = 5 * 60 * 1000;

const formatLocalDateShort = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-').map(Number);
    if (parts.length >= 3 && !parts.some(isNaN)) {
        return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const PersonItem = memo(({ item, colors, onPress, onLongPress }: any) => (
    <View>
        <ScalePressable
            onPress={onPress}
            onLongPress={onLongPress}
            style={[
                styles.itemContainer,
                {
                    backgroundColor: colors.card,
                    borderRadius: DesignSystem.radius.lg,
                    borderWidth: 0,
                    borderColor: colors.border,
                    flexDirection: 'row',
                    alignItems: 'center',
                }
            ]}
        >
            <View style={[styles.personCard, { flex: 1, flexDirection: 'row', alignItems: 'center' }]}>
                <Avatar name={item.name} uri={item.avatarUri} size={52} />
                <View style={[styles.personInfo, { flex: 1 }]}>
                    <ThemedText type="defaultSemiBold" style={styles.personName}>{item.name}</ThemedText>
                    <ThemedText
                        type="small"
                        style={[styles.personPitch, { color: colors.secondary }]}
                        numberOfLines={1}
                    >
                        {item.elevatorPitch || 'No headline'}
                    </ThemedText>
                </View>
                {item.isPinned && (
                    <PushPin size={20} color={colors.icon} weight="fill" style={{ marginLeft: 12, marginRight: 4 }} />
                )}
            </View>
        </ScalePressable>
    </View>
));

// Memory Lane card. Kept as its own component so it can hold a ref for the
// shared card frame (kept for layout stability, the note opens with the
// standard screen pop).
const MemoryLaneCard = memo(({ entry, colors, router }: any) => {
    // The card shows 2 lines; memoising keeps the markdown pass from running
    // again every time the dashboard section re-renders.
    const preview = useMemo(() => markdownPreviewText(entry.content), [entry.content]);
    const dateLabel = useMemo(() => formatLocalDateShort(entry.date), [entry.date]);

    return (
        <ScalePressable
            style={[styles.highlightCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 0 }]}
            onPress={() => router.push({ pathname: '/journal/[id]', params: { id: entry.id } })}
        >
            <View style={styles.highlightHeader}>
                <View style={[styles.highlightTitleRow, { marginBottom: 4 }]}>
                    <Book size={14} color={colors.tint} weight="bold" />
                    <ThemedText type="tiny" style={{ color: colors.tint, fontFamily: Typography.fontFamily.extrabold, marginLeft: 6 }}>
                        {dateLabel}
                    </ThemedText>
                </View>
                {entry.title && (
                    <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ fontSize: 13, marginBottom: 4 }}>{entry.title}</ThemedText>
                )}
                <ThemedText type="small" numberOfLines={2} style={{ color: colors.secondary, fontSize: 12, lineHeight: 18 }}>
                    {preview}
                </ThemedText>
            </View>
        </ScalePressable>
    );
});

export default function PeopleScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [search, setSearch] = useState('');
    const [people, setPeople] = useState<Person[]>([]);
    const [allPeople, setAllPeople] = useState<Person[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
    const { colors, theme, hapticsEnabled } = useAppTheme();
    const { settings } = useSettings();
    const keyboardVisible = useKeyboardState((state) => state.isVisible);

    // Scroll Logic
    const scrollY = useSharedValue(0);
    const scrollDirection = useSharedValue<'up' | 'down'>('up');
    const isScrolling = useSharedValue(false);
    const listContentHeight = useSharedValue(0);
    const listLayoutHeight = useSharedValue(0);
    // JS-thread mirrors for computing exact jump offsets (shared values above
    // feed the arrow visibility checks on the UI thread).
    const contentHeightRef = useRef(0);
    const layoutHeightRef = useRef(0);
    const hideTimeout = useRef<any>(null);
    const flatListRef = useRef<FlatList>(null);
    // Set while a jump-to-bottom is in flight; cleared on user takeover or timeout.
    const pendingEndScroll = useRef(false);
    const endScrollTimeout = useRef<any>(null);

    const startHideTimer = useCallback(() => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        hideTimeout.current = setTimeout(() => {
            isScrolling.value = false;
        }, 800);
    }, []);

    const lastJSCallRef = useRef<number>(0);
    const triggerHideTimerJS = useCallback(() => {
        const now = Date.now();
        if (now - lastJSCallRef.current > 200) {
            lastJSCallRef.current = now;
            startHideTimer();
        }
    }, [startHideTimer]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            const currentY = event.contentOffset.y;
            const diff = currentY - scrollY.value;

            if (Math.abs(diff) > 5) {
                scrollDirection.value = diff > 0 ? 'down' : 'up';
            }
            // Show past the threshold no matter how slow the scroll; hiding is
            // left to the stop-timer so both arrows stay visible through the end
            // of the gesture in either direction.
            if (currentY > 200) {
                isScrolling.value = true;
            }
            scrollY.value = currentY;

            runOnJS(triggerHideTimerJS)();
        },
    });

    // Jump to the absolute end of the list, including the intentional bottom
    // breathing room below the last card (scrollToEnd stops at the last row).
    const scrollToTrueEnd = () => {
        const ch = contentHeightRef.current;
        const lh = layoutHeightRef.current;
        if (ch > 0 && lh > 0) {
            flatListRef.current?.scrollToOffset({ offset: Math.max(0, ch - lh), animated: true });
        } else {
            flatListRef.current?.scrollToEnd({ animated: true });
        }
    };

    const handleQuickScroll = () => {
        if (endScrollTimeout.current) clearTimeout(endScrollTimeout.current);
        if (scrollDirection.value === 'up') {
            pendingEndScroll.current = false;
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        } else {
            // Rows past the render window have no measured size yet, so one jump
            // can land short; follow-ups chain via onContentSizeChange until the
            // content is fully measured and the true end is reached.
            pendingEndScroll.current = true;
            endScrollTimeout.current = setTimeout(() => {
                pendingEndScroll.current = false;
            }, 3000);
            scrollToTrueEnd();
        }
    };

    // Add Menu is now handled globally in _layout.tsx

    // Add Person Modal State
    const [showAddModal, setShowAddModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPitch, setNewPitch] = useState('');
    const [newGender, setNewGender] = useState('');
    const [newBirthdate, setNewBirthdate] = useState('');
    const [newFirstMet, setNewFirstMet] = useState('');
    const [newAvatarUri, setNewAvatarUri] = useState<string | null>(null);
    // A freshly picked photo, before it has been cropped into app storage.
    const [newAvatarSource, setNewAvatarSource] = useState<string | null>(null);
    const [isCroppingAvatar, setIsCroppingAvatar] = useState(false);
    // True while the sheet is being rebuilt around a photo pick. The rebuild
    // remounts the sheet, and without this its entrance animations would
    // replay in the middle of the interaction.
    const [skipIntro, setSkipIntro] = useState(false);
    // Keeps the sheet out of Android's way for the duration of the picker.
    const { generation: pickerGeneration, pick: pickAvatar } = usePickerHost();

    // Group Assignment state was removed with the unreachable ManageGroupsModal
    // instance; group membership is managed via ManageGroupMembersModal.
    const [reconnects, setReconnects] = useState<any[]>([]);
    const [highlights, setHighlights] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGroupSwitching, setIsGroupSwitching] = useState(false);
    // A ref, not state: entering animations only matter when a row mounts, so
    // flipping this must not re-render every visible row.
    const shouldAnimateRef = useRef(true);
    const groupAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (groupAnimTimerRef.current) clearTimeout(groupAnimTimerRef.current);
    }, []);

    const [isDashboardActive, setIsDashboardActive] = useState(false);

    useEffect(() => {
        if (settings.peopleTabMode === 'discovery' && selectedGroupId === null && search === '') {
            setIsDashboardActive(true);
        } else {
            setIsDashboardActive(false);
        }
    }, [settings.peopleTabMode, selectedGroupId, search]);

    // Intercept hardware/gesture back in discovery mode when viewing a group
    useFocusEffect(
        useCallback(() => {
            const onBackPress = () => {
                if (settings.peopleTabMode === 'discovery' && !isDashboardActive) {
                    setSearch('');
                    setSelectedGroupId(null);
                    setIsDashboardActive(true);
                    return true; // consume the event
                }
                return false;
            };
            const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => sub.remove();
        }, [settings.peopleTabMode, isDashboardActive])
    );

    // Quick Actions State
    const [showPersonPicker, setShowPersonPicker] = useState(false);
    const [showQuickNoteModal, setShowQuickNoteModal] = useState(false);
    const [selectedPersonForNote, setSelectedPersonForNote] = useState<Person | null>(null);

    // Profile Modals
    const [showAddReminderModal, setShowAddReminderModal] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState<number | null>(null);
    const [showManageGroupModal, setShowManageGroupModal] = useState(false);
    const [groupToManage, setGroupToManage] = useState<Group | null>(null);
    const [modalMembers, setModalMembers] = useState<Person[]>([]);
    const [initialManageAddingMode, setInitialManageAddingMode] = useState(false);
    const [alertConfig, setAlertConfig] = useState<{ visible: boolean, title: string, description: string, type: 'success' | 'error' | 'info' | 'warning', onClose?: () => void } | null>(null);

    const [personToManage, setPersonToManage] = useState<Person | null>(null);
    const [showPersonManageModal, setShowPersonManageModal] = useState(false);
    const personManagePresence = useModalPresence(showPersonManageModal);
    // The Add Person screen animates itself away: Android destroys a native
    // Modal's content the moment `visible` flips, which would leave an empty
    // white window sliding out instead of the screen.
    const { mounted: addModalMounted, animatedStyle: addModalSlideStyle } = useFullScreenModal(showAddModal);

    const groupSelectorRef = useRef<GroupSelectorHandle>(null);
    const glanceFetchedAt = useRef<number>(0);
    const dailyHighlights = useRef<{ day: string; data: any[] }>({ day: '', data: [] });

    const [pickerMode, setPickerMode] = useState<'note' | 'contact' | null>(null);
    const [activitySortedPeople, setActivitySortedPeople] = useState<Person[]>([]);

    const handleQuickNote = async () => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPickerMode('note');
        let sorted: Person[] = allPeople;
        try {
            sorted = await PersonRepository.getPeopleSortedByNotesFrequency();
        } catch (error) {
            console.error('Failed to sort people by note frequency:', error);
        }
        setActivitySortedPeople(sorted);
        setShowPersonPicker(true);
    };

    const handleQuickContact = () => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPickerMode('contact');
        setShowPersonPicker(true);
    };

    const handlePersonSelected = (person: Person) => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.selectionAsync();
        setShowPersonPicker(false);
        if (pickerMode === 'note') {
            setSelectedPersonForNote(person);
            setTimeout(() => {
                setShowQuickNoteModal(true);
            }, 400); // Wait for modal animation
        } else if (pickerMode === 'contact') {
            setTimeout(() => {
                router.push({ pathname: '/contact/[id]', params: { id: 'new', personId: person.id } });
            }, 200);
        }
    };

    const handleSaveQuickNote = async (category: string, content: string) => {
        if (selectedPersonForNote) {
            await EntryRepository.addEntry(selectedPersonForNote.id, category, content, settings.addTimestampToNotes);
            const name = selectedPersonForNote.name;

            const { showToast } = require('../../components/ui/Toast');
            showToast(`Note added for ${name}`);
            // Optional: feedback
            if (hapticsEnabled && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
    };

    const handleCloseQuickNote = () => {
        setShowQuickNoteModal(false);
        setTimeout(() => setSelectedPersonForNote(null), 350);
    };

    const handleQuickReminder = () => {
        setShowAddReminderModal(true);
    };

    const handlePersonLongPress = useCallback((person: Person) => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setPersonToManage(person);
        setShowPersonManageModal(true);
    }, [hapticsEnabled]);

    useEffect(() => {
        const sub1 = DeviceEventEmitter.addListener('globalAction:newPerson', () => setShowAddModal(true));
        const sub2 = DeviceEventEmitter.addListener('globalAction:quickNote', () => handleQuickNote());
        const sub3 = DeviceEventEmitter.addListener('globalAction:quickContact', () => handleQuickContact());
        const sub4 = DeviceEventEmitter.addListener('globalAction:setReminder', () => handleQuickReminder());

        return () => {
            sub1.remove();
            sub2.remove();
            sub3.remove();
            sub4.remove();
        };
    }, [hapticsEnabled]);

    const handleTogglePin = async () => {
        if (!personToManage) return;
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.selectionAsync();
        await PersonRepository.togglePin(personToManage.id, !personToManage.isPinned);
        setShowPersonManageModal(false);
        setPersonToManage(null);
        loadPeople();
    };

    const isFirstViewRef = useRef(true);

    useFocusEffect(
        useCallback(() => {
            // Only animate on the very first time the app is opened, or when changing groups
            if (isFirstViewRef.current) {
                shouldAnimateRef.current = true;
                const timer = setTimeout(() => {
                    shouldAnimateRef.current = false;
                    isFirstViewRef.current = false;
                }, 1500);
                loadData();
                return () => clearTimeout(timer);
            } else {
                loadData(true); // silent update
            }
            // Always reset local sort to user choice on focus
            setSortBy(settings.defaultSort);
        }, [selectedGroupId, settings.defaultSort])
    );

    const loadData = async (isSilent = false) => {
        // Only show loading if we have absolutely no data yet and not a silent update
        if (!isSilent && people.length === 0 && reconnects.length === 0 && highlights.length === 0) {
            setIsLoading(true);
        }
        try {
            // Load Groups
            const allGroups = await GroupRepository.getAll();
            setGroups(allGroups);

            // Load People based on selection. Paint the list first so it never
            // waits behind the glance queries below.
            let data;
            if (selectedGroupId === null) {
                data = await PersonRepository.getAll(settings.defaultSort);
                setPeople(data);

                // Load Quick Glance data only on main view and only when the panel is
                // enabled — group-hopping back and forth must not refetch or
                // remount the section.
                if (settings.showQuickArray) {
                    // People digest: rule-based, refetched at most every 5 minutes.
                    if (Date.now() - glanceFetchedAt.current > GLANCE_CACHE_MS) {
                        const r = await PersonRepository.getReconnectSuggestions();
                        glanceFetchedAt.current = Date.now();
                        // Preserve array identity when nothing changed so cards keep
                        // state and the list keeps scroll position.
                        setReconnects(prev => sameGlanceIds(prev, r, (s) => `${s.person.id}:${s.type}`) ? prev : r);
                    }
                    // Memory Lane: one random throwback set per calendar day,
                    // persisted so restarts keep the same 3 rows.
                    const nowDate = new Date();
                    const todayKey = `${nowDate.getFullYear()}-${nowDate.getMonth() + 1}-${nowDate.getDate()}`;
                    if (settings.showJournalTab) {
                        if (dailyHighlights.current.day !== todayKey) {
                            let h: any[] = [];
                            try {
                                const storedDay = await SettingsRepository.get('dailyHighlightDay');
                                if (storedDay === todayKey) {
                                    const raw = await SettingsRepository.get('dailyHighlightIds');
                                    const ids: number[] = raw ? JSON.parse(raw).filter((n: any) => typeof n === 'number') : [];
                                    const resolved = await Promise.all(ids.map(id => JournalRepository.getById(id)));
                                    h = resolved.filter(j => j && (j.title || j.content));
                                }
                            } catch {
                                h = [];
                            }
                            if (h.length === 0) {
                                h = await JournalRepository.getHighlights(3);
                                try {
                                    await SettingsRepository.set('dailyHighlightDay', todayKey);
                                    await SettingsRepository.set('dailyHighlightIds', JSON.stringify(h.map(j => j.id)));
                                } catch {
                                    // Persistence is best-effort; the in-memory set still applies.
                                }
                            }
                            dailyHighlights.current = { day: todayKey, data: h };
                            setHighlights(prev => sameGlanceIds(prev, h) ? prev : h);
                        }
                    } else {
                        dailyHighlights.current = { day: todayKey, data: [] };
                        setHighlights(prev => (prev.length === 0 ? prev : []));
                    }
                }
            } else {
                data = await GroupRepository.getPeopleInGroup(selectedGroupId, settings.defaultSort);
                setPeople(data);
            }

            // Always keep a full list for group assignment, sorted by preference.
            // The main view already fetched everyone, so reuse it instead of
            // running the same full query twice.
            setAllPeople(selectedGroupId === null ? data : await PersonRepository.getAll(settings.defaultSort));
        } catch (error) {
            console.error('Failed to load people:', error);
        } finally {
            setIsLoading(false);
            setIsGroupSwitching(false);
        }
    };

    const loadPeople = async () => {
        // Re-fetch just people (helper for other ops)
        try {
            let data;
            if (selectedGroupId === null) {
                data = await PersonRepository.getAll(settings.defaultSort);
            } else {
                data = await GroupRepository.getPeopleInGroup(selectedGroupId, settings.defaultSort);
            }
            setPeople(data);

            // Always sync allPeople too (same query when viewing all people).
            setAllPeople(selectedGroupId === null ? data : await PersonRepository.getAll(settings.defaultSort));
        } catch (error) {
            console.error('Failed to refresh people:', error);
        }
    };

    const handleCreateGroup = async (name: string, icon: string, color: string) => {
        await GroupRepository.create({ name, icon, color });
        const all = await GroupRepository.getAll();
        setGroups(all);
    };

    const handleUpdateGroup = async (id: number, name: string, icon: string, color?: string) => {
        await GroupRepository.update(id, { name, icon, color });
        const all = await GroupRepository.getAll();
        setGroups(all);
    };

    const handleDeleteGroup = async (id: number) => {
        setGroupToDelete(id);
    };

    const handleGroupSelection = (id: number | null) => {
        const isSwitchingFromDashboard = isDashboardActive;
        const groupChanged = id !== selectedGroupId;

        if (groupChanged || isSwitchingFromDashboard) {
            shouldAnimateRef.current = true;
            if (groupAnimTimerRef.current) clearTimeout(groupAnimTimerRef.current);
            groupAnimTimerRef.current = setTimeout(() => { shouldAnimateRef.current = false; }, 800);

            if (groupChanged) {
                // Clear only the people list so its switch animation replays.
                // Quick Glance runs on its own cache and stays mounted.
                setIsGroupSwitching(true);
                setPeople([]);
                setSelectedGroupId(id);
            }
        }

        setSearch('');
        if (isSwitchingFromDashboard) {
            setIsDashboardActive(false);
        }
    };

    const confirmDeleteGroup = async () => {
        if (groupToDelete !== null) {
            await GroupRepository.delete(groupToDelete);
            const all = await GroupRepository.getAll();
            setGroups(all);
            if (selectedGroupId === groupToDelete) setSelectedGroupId(null);
            setGroupToDelete(null);
        }
    };

    const handleOpenManageGroup = async (group: Group, startInAddingMode: boolean = false) => {
        setGroupToManage(group);
        setInitialManageAddingMode(startInAddingMode);
        const members = await GroupRepository.getPeopleInGroup(group.id, settings.defaultSort);
        setModalMembers(members);
        setShowManageGroupModal(true);
    };

    const pickImage = async () => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        // The sheet stays up while the picker animates in; `usePickerHost`
        // drops the dialog once the picker covers us. See that hook.
        setSkipIntro(true);
        const uri = await pickAvatar();
        if (uri) setNewAvatarSource(uri);
    };

    const applyAvatarCrop = async (rect: MediaCropRect) => {
        if (!newAvatarSource) return;

        setIsCroppingAvatar(true);
        const persisted = await persistCroppedAvatar(newAvatarSource, rect);
        setIsCroppingAvatar(false);
        setNewAvatarSource(null);
        if (newAvatarUri) void deleteAvatarFile(newAvatarUri);
        setNewAvatarUri(persisted);
    };

    const handleAddPerson = async () => {
        if (!newName.trim()) return;

        const newPerson = await PersonRepository.create({
            name: newName,
            elevatorPitch: newPitch,
            gender: newGender,
            birthdate: newBirthdate,
            firstMet: newFirstMet,
            avatarUri: newAvatarUri
        });

        const { showToast } = require('../../components/ui/Toast');
        showToast(`Added ${newName}`);

        resetForm();
        setShowAddModal(false);
        loadPeople();

        // Show success feedback
        setAlertConfig({
            visible: true,
            title: 'Person Added',
            description: `${newPerson.name} has been added to your network.`,
            type: 'success',
            onClose: () => {
                router.push(`/person/${newPerson.id}`);
            }
        });
    };

    const resetForm = () => {
        setNewName('');
        setNewPitch('');
        setNewGender('');
        setNewBirthdate('');
        setNewFirstMet('');
        setNewAvatarUri(null);
        setNewAvatarSource(null);
    };

    const closeAddModal = () => {
        // An avatar that was picked but never saved is ours to remove.
        if (newAvatarUri) void deleteAvatarFile(newAvatarUri);
        setNewAvatarUri(null);
        setNewAvatarSource(null);
        // The next open is a normal one, so it gets its entrance animation back.
        setSkipIntro(false);
        setShowAddModal(false);
    };

    const [sortBy, setSortBy] = useState<'name' | 'newest' | 'oldest'>(settings.defaultSort);
    const [showSortMenu, setShowSortMenu] = useState(false);

    useEffect(() => {
        setSortBy(settings.defaultSort);
    }, [settings.defaultSort]);

    const filteredPeople = useMemo(() => {
        const q = search.trim().toLowerCase();
        return people.filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.elevatorPitch ? p.elevatorPitch.toLowerCase().includes(q) : false)
        ).sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;

            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            return 0;
        });
    }, [people, search, sortBy]);

    const isGallery = settings.peopleListStyle === 'gallery';
    const galleryColumns = Math.min(3, Math.max(2, Math.round(settings.peopleGalleryColumns || 2)));
    // 3-up needs a tighter gutter so the narrower tiles keep their size.
    const galleryGutter = galleryColumns >= 3 ? 4 : 6;
    const galleryItemWidth: DimensionValue = `${100 / galleryColumns}%`;

    // The list remounts when gallery/dashboard mode or the gallery column count
    // flips (see key on the FlatList below); reset the scroll trackers so the
    // first scroll after the switch doesn't compute against a stale offset and
    // flash the wrong arrow.
    useEffect(() => {
        scrollY.value = 0;
        scrollDirection.value = 'up';
        isScrolling.value = false;
    }, [isGallery, galleryColumns, isDashboardActive]);

    const renderItem = useCallback(({ item, index }: { item: Person, index: number }) => {
        if (isGallery) {
            return (
                <Animated.View
                    entering={shouldAnimateRef.current ? FadeInDown.delay(Math.min(index, 5) * 55).duration(440).springify().damping(22).stiffness(160).mass(0.9) : undefined}
                    style={{ width: galleryItemWidth, paddingHorizontal: galleryGutter, marginBottom: 12 }}
                >
                    <GalleryPersonCard
                        person={item}
                        colors={colors}
                        columns={galleryColumns}
                        onPress={() => router.push(`/person/${item.id}`)}
                        onLongPress={() => handlePersonLongPress(item)}
                    />
                </Animated.View>
            );
        }
        return (
            <Animated.View entering={shouldAnimateRef.current ? FadeInDown.delay(Math.min(index, 5) * 55).duration(440).springify().damping(22).stiffness(160).mass(0.9) : undefined}>
                <PersonItem
                    item={item}
                    colors={colors}
                    onPress={() => {
                        router.push(`/person/${item.id}`);
                    }}
                    onLongPress={() => handlePersonLongPress(item)}
                />
            </Animated.View>
        );
    }, [colors, router, isGallery, galleryColumns, galleryGutter, handlePersonLongPress]);

    return (
        <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <View style={styles.headerTitleContainer}>
                    <ThemedText type="display" style={styles.title}>People</ThemedText>
                </View>
                <View style={styles.headerActions}>
                    <ScalePressable
                        onPress={() => router.push('/settings')}
                        style={[styles.headerAction, { backgroundColor: colors.surface, marginRight: 0 }]}
                        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                        innerStyle={{ borderRadius: DesignSystem.radius.full }}
                        scaleTo={0.88}
                        springConfig={DesignSystem.animation.springs.fast}
                    >
                        <Settings size={22} color={colors.text} />
                    </ScalePressable>
                </View>
            </View>



            <Animated.FlatList
                ref={flatListRef}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                onScrollBeginDrag={() => {
                    if (showSortMenu) setShowSortMenu(false);
                    // User took over; stop chaining jump-to-bottom follow-ups.
                    pendingEndScroll.current = false;
                    if (endScrollTimeout.current) clearTimeout(endScrollTimeout.current);
                }}
                onLayout={(e) => {
                    layoutHeightRef.current = e.nativeEvent.layout.height;
                    listLayoutHeight.value = e.nativeEvent.layout.height;
                }}
                onContentSizeChange={(_w, h) => {
                    contentHeightRef.current = h;
                    listContentHeight.value = h;
                    if (pendingEndScroll.current) {
                        scrollToTrueEnd();
                    }
                }}
                data={isDashboardActive ? [] : filteredPeople}
                key={isGallery && !isDashboardActive ? `gallery-view-${galleryColumns}` : 'list-view'}
                numColumns={isGallery && !isDashboardActive ? galleryColumns : 1}
                columnWrapperStyle={isGallery && !isDashboardActive ? { marginHorizontal: -galleryGutter, justifyContent: 'flex-start' } : undefined}
                keyExtractor={(item) => `person-${item.id}`}
                renderItem={renderItem}
                contentContainerStyle={[
                    styles.list,
                    { paddingBottom: insets.bottom + 100 },
                    filteredPeople.length === 0 && { flexGrow: 1 }
                ]}
                showsVerticalScrollIndicator={false}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={Platform.OS === 'android'}
                ListHeaderComponent={
                    <View style={{ zIndex: 1000, elevation: 10 }}>
                        {isDashboardActive ? (
                            <View style={{ padding: 20, paddingTop: 10 }}>
                                <Animated.View entering={FadeInDown.duration(260).springify().damping(24).stiffness(280).mass(0.7)}>
                                    <DashboardGroupCard
                                        title="All People"
                                        description="Your entire network"
                                        isMaster
                                        count={allPeople.length}
                                        colors={colors}
                                        color={colors.tint}
                                        onPress={() => handleGroupSelection(null)}
                                    />
                                </Animated.View>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
                                    {groups.map((g, idx) => (
                                        <Animated.View
                                            key={g.id}
                                            entering={FadeInDown.delay(Math.min(idx, 6) * 40).duration(380).springify().damping(22).stiffness(180).mass(0.85)}
                                            style={{ width: '47%' }}
                                        >
                                            <DashboardGroupCard
                                                title={g.name}
                                                iconName={g.icon}
                                                color={g.color || colors.tint}
                                                colors={colors}
                                                onPress={() => handleGroupSelection(g.id)}
                                                onLongPress={() => {
                                                    groupSelectorRef.current?.openEdit(g);
                                                }}
                                            />
                                        </Animated.View>
                                    ))}
                                    {groups.length < 8 && (
                                        <Animated.View
                                            entering={FadeInDown.delay(Math.min(groups.length, 6) * 40).duration(380).springify().damping(22).stiffness(180).mass(0.85)}
                                            style={{ width: '47%' }}
                                        >
                                            <DashboardGroupCard
                                                title="Create Group"
                                                description="Organize people"
                                                iconName="Plus"
                                                color={colors.text}
                                                colors={colors}
                                                isAddCard
                                                onPress={() => groupSelectorRef.current?.openCreate()}
                                            />
                                        </Animated.View>
                                    )}
                                </View>
                            </View>
                        ) : (
                            <Animated.View entering={FadeIn.duration(300)}>
                                {settings.peopleTabMode === 'discovery' && (
                                    <ScalePressable
                                        onPress={() => {
                                            if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setSearch('');
                                            setSelectedGroupId(null);
                                            setIsDashboardActive(true);
                                        }}
                                        style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5, flexDirection: 'row', alignItems: 'center' }}
                                        innerStyle={{ borderRadius: 8 }}
                                        overlayColor="transparent"
                                        scaleTo={0.97}
                                        springConfig={DesignSystem.animation.springs.fast}
                                    >
                                        <CaretLeft size={20} color={colors.secondary} />
                                        <ThemedText style={{ color: colors.secondary, marginLeft: 8, fontFamily: Typography.fontFamily.semibold }}>Back to Dashboard</ThemedText>
                                    </ScalePressable>
                                )}
                                <View style={styles.searchSection}>
                                    <View style={styles.searchRow}>
                                        <SearchBar
                                            value={search}
                                            onChangeText={setSearch}
                                            placeholder="Search..."
                                            style={{ height: 52, borderRadius: DesignSystem.radius.xl, marginRight: 10 }}
                                        />
                                        <ScalePressable
                                            style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 0 }]}
                                            onPress={() => setShowSortMenu(!showSortMenu)}
                                            innerStyle={{ borderRadius: DesignSystem.radius.xl }}
                                        >
                                            <Filter size={20} color={showSortMenu ? colors.tint : colors.text} />
                                        </ScalePressable>
                                    </View>
                                </View>
                            </Animated.View>
                        )}

                        <GroupSelector
                            ref={groupSelectorRef}
                            groups={groups}
                            selectedGroupId={selectedGroupId}
                            onSelectGroup={handleGroupSelection}
                            onCreateGroup={handleCreateGroup}
                            onUpdateGroup={handleUpdateGroup}
                            onDeleteGroup={handleDeleteGroup}
                            onManageMembers={handleOpenManageGroup}
                            hidden={settings.peopleTabMode === 'discovery'}
                        />

                        {(!isDashboardActive && !search && !selectedGroupId && settings.showQuickArray && (isLoading || reconnects.length > 0 || (highlights.length > 0 && settings.showJournalTab))) && (
                            <View style={[styles.dashboardContainer, !isLoading && { marginTop: 12 }]}>
                                {isLoading ? (
                                    <View>
                                        <View style={styles.section}>
                                            <Skeleton width={120} height={20} style={{ marginBottom: 12 }} />
                                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                                <Skeleton width={180} height={70} borderRadius={16} />
                                                <Skeleton width={180} height={70} borderRadius={16} />
                                            </View>
                                        </View>
                                    </View>
                                ) : (
                                    <>

                                        {/* Memory Lane */}
                                        {highlights.length > 0 && settings.showJournalTab && (
                                            <View style={[styles.section, { marginBottom: 10 }]}>
                                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                                    {highlights.map((h, idx) => (
                                                        <MemoryLaneCard
                                                            key={`highlight-${h.id}-${idx}`}
                                                            entry={h}
                                                            colors={colors}
                                                            router={router}
                                                        />
                                                    ))}
                                                </ScrollView>
                                            </View>
                                        )}

                                        {/* Reconnect Suggestions */}
                                        {reconnects.length > 0 && (
                                            <View style={styles.section}>
                                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                                                    {reconnects.map((s, idx) => (
                                                        <ScalePressable
                                                            key={`reconnect-${s.person.id}-${idx}`}
                                                            style={[styles.reconnectCard, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 0 }]}
                                                            onPress={() => router.push(`/person/${s.person.id}`)}
                                                        >
                                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                                                <Avatar name={s.person.name} uri={s.person.avatarUri} size={44} />
                                                                <View style={{ flex: 1 }}>
                                                                    <ThemedText type="defaultSemiBold" style={{ fontSize: 14 }}>{s.person.name}</ThemedText>
                                                                    <ThemedText type="tiny" style={{ color: colors.tint, fontFamily: Typography.fontFamily.semibold }}>{s.reason}</ThemedText>
                                                                </View>
                                                            </View>
                                                        </ScalePressable>
                                                    ))}
                                                </ScrollView>
                                            </View>
                                        )}
                                    </>
                                )}
                            </View>
                        )}
                        <View style={{ height: 4 }} />
                    </View>
                }
                ListEmptyComponent={
                    (isLoading || isGroupSwitching || isDashboardActive) ? null : (
                        <View style={[
                            styles.emptyContainer,
                            search.trim().length > 0 && keyboardVisible && styles.emptyKeyboardShift
                        ]}>
                            {search ? <SearchNoResults size={64} color={colors.icon} weight="fill" /> : <UserIcon size={48} color={colors.tint} weight="fill" />}
                            <ThemedText style={[styles.emptyTitle, { fontFamily: Typography.fontFamily.bold }]}>
                                {search ? 'No results' : selectedGroupId ? 'Group Empty' : 'Network'}
                            </ThemedText>
                            {search && (
                                <ThemedText style={[styles.emptySubtitle, { color: colors.secondary }]}>
                                    {`No matches for "${search}"`}
                                </ThemedText>
                            )}
                            {!search && !selectedGroupId && (
                                <Button
                                    title="Add First Person"
                                    onPress={() => setShowAddModal(true)}
                                    style={styles.emptyButton}
                                />
                            )}
                            {!search && selectedGroupId && allPeople.length > 0 && (
                                <Button
                                    title="Add Members to Group"
                                    onPress={() => {
                                        const currentGroup = groups.find(g => g.id === selectedGroupId);
                                        if (currentGroup) handleOpenManageGroup(currentGroup, true);
                                    }}
                                    style={styles.emptyButton}
                                />
                            )}
                            {!search && selectedGroupId && allPeople.length === 0 && (
                                <Button
                                    title="Add First Person"
                                    onPress={() => setShowAddModal(true)}
                                    style={styles.emptyButton}
                                />
                            )}
                        </View>
                    )
                }
            />

            <Modal
                key={pickerGeneration}
                visible={addModalMounted}
                animationType="none"
                transparent
                statusBarTranslucent={true}
                onRequestClose={() => {
                    // While the crop is open, back belongs to the crop.
                    if (newAvatarSource) {
                        setNewAvatarSource(null);
                        return;
                    }
                    closeAddModal();
                }}
            >
                <Animated.View style={[styles.fullScreenPage, { backgroundColor: colors.background }, addModalSlideStyle]}>
                    <StatusBar style="auto" />
                    <View style={[styles.fullScreenHeader, { paddingTop: insets.top + 8, paddingBottom: 12 }]}>
                        <ScalePressable
                            onPress={closeAddModal}
                            style={styles.modalHeaderAction}
                            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                            overlayColor="transparent"
                            scaleTo={0.9}
                        >
                            <X size={24} color={colors.text} />
                        </ScalePressable>
                        <ThemedText type="display" style={styles.headerTitle}>New Person</ThemedText>
                        <ScalePressable
                            onPress={handleAddPerson}
                            disabled={!newName.trim()}
                            style={styles.modalHeaderAction}
                            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                            overlayColor="transparent"
                            scaleTo={0.9}
                        >
                            <Check size={24} color={newName.trim() ? colors.tint : colors.secondary} />
                        </ScalePressable>
                    </View>

                    <KeyboardAwareScrollView
                        style={{ flex: 1 }}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                        bottomOffset={24}
                    >
                            <Animated.View
                                entering={skipIntro ? undefined : ZoomIn.duration(440).springify().damping(22).stiffness(140).mass(0.9)}
                                style={styles.fullScreenAvatarSection}
                            >
                                <ScalePressable
                                    onPress={pickImage}
                                    style={styles.fullScreenAvatarWrapper}
                                    overlayColor="transparent"
                                    scaleTo={0.94}
                                >
                                    <Avatar name={newName || '?'} uri={newAvatarUri} size={110} />
                                    <View style={[styles.fullScreenCameraBadge, { backgroundColor: colors.tint, borderColor: colors.background }]}>
                                        <Camera size={18} color={theme === 'dark' ? '#000' : '#fff'} />
                                    </View>
                                </ScalePressable>
                            </Animated.View>

                            <View style={styles.fullScreenForm}>
                                <Animated.View entering={skipIntro ? undefined : FadeInDown.delay(70).duration(460).springify().damping(22).stiffness(120).mass(1.0)}>
                                    <Input
                                        label="Full Name"
                                        placeholder="e.g. Jean-Luc Picard"
                                        value={newName}
                                        onChangeText={setNewName}
                                        maxLength={40}
                                    />
                                    <View style={{ height: 16 }} />

                                    <Input
                                        label="Headline / Role"
                                        placeholder="e.g. Captain"
                                        value={newPitch}
                                        onChangeText={setNewPitch}
                                        multiline
                                        maxLength={35}
                                    />
                                </Animated.View>

                                <Animated.View entering={skipIntro ? undefined : FadeInDown.delay(140).duration(460).springify().damping(22).stiffness(120).mass(1.0)} style={{ marginTop: 16 }}>
                                    <View style={styles.fullScreenRow}>
                                        <View style={{ flex: 1, marginRight: 12 }}>
                                            <Input
                                                label="Gender"
                                                placeholder="Optional"
                                                value={newGender}
                                                onChangeText={setNewGender}
                                                maxLength={20}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <DatePicker
                                                label="Birthdate"
                                                value={newBirthdate}
                                                onChange={setNewBirthdate}
                                                maxDate={new Date()}
                                            />
                                        </View>
                                    </View>

                                    <View style={{ marginTop: 16 }}>
                                        <DatePicker
                                            label="First Met Date"
                                            value={newFirstMet}
                                            onChange={setNewFirstMet}
                                            maxDate={new Date()}
                                        />
                                    </View>
                                </Animated.View>
                            </View>
                    </KeyboardAwareScrollView>

                    {newAvatarSource && (
                        <View style={StyleSheet.absoluteFill}>
                            <ImageCropView
                                uri={newAvatarSource}
                                busy={isCroppingAvatar}
                                lockedRatio={1}
                                confirmUnchanged
                                onCancel={() => setNewAvatarSource(null)}
                                onConfirm={applyAvatarCrop}
                            />
                        </View>
                    )}
                </Animated.View>
            </Modal>
            <ManageGroupMembersModal
                visible={showManageGroupModal}
                group={groupToManage}
                members={modalMembers}
                allPeople={allPeople}
                onClose={() => {
                    setShowManageGroupModal(false);
                    setModalMembers([]);
                    loadPeople();
                }}
                onAddMembers={async (ids) => {
                    if (!groupToManage || ids.length === 0) return;
                    await GroupRepository.addPeopleToGroup(ids, groupToManage.id);

                    const idSet = new Set(ids);
                    setModalMembers((prev) => {
                        const existing = new Set(prev.map((p) => p.id));
                        const added = allPeople.filter(
                            (p) => idSet.has(p.id) && !existing.has(p.id)
                        );
                        return [...prev, ...added];
                    });
                }}
                onRemoveMembers={async (ids) => {
                    if (!groupToManage || ids.length === 0) return;
                    await GroupRepository.removePeopleFromGroup(ids, groupToManage.id);

                    const idSet = new Set(ids);
                    setModalMembers((prev) => prev.filter((p) => !idSet.has(p.id)));
                }}
                colors={colors}
                theme={theme}
                hapticsEnabled={hapticsEnabled}
                initialAddingMode={initialManageAddingMode}
            />

            {/* Sort Menu Dropdown Overlay */}
            {showSortMenu && (
                <View style={styles.addMenuOverlay}>
                    <TouchableOpacity
                        style={StyleSheet.absoluteFill}
                        activeOpacity={1}
                        onPress={() => setShowSortMenu(false)}
                    />
                    <Animated.View
                        entering={FadeInDown.duration(200)}
                        style={[
                            styles.sortMenu,
                            {
                                backgroundColor: colors.card,
                                borderColor: colors.border,
                                top: insets.top + (settings.peopleTabMode === 'discovery' && !isDashboardActive ? 172 : 132)
                            }
                        ]}
                    >
                        <ThemedText type="tiny" style={{ padding: 8, opacity: 0.5, fontFamily: Typography.fontFamily.bold }}>Sort by</ThemedText>
                        {[
                            { label: 'Name (A-Z)', value: 'name' },
                            { label: 'Newest First', value: 'newest' },
                            { label: 'Oldest First', value: 'oldest' },
                        ].map((option) => (
                            <ScalePressable
                                key={option.value}
                                style={[styles.sortOption, sortBy === option.value && { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}
                                innerStyle={{ borderRadius: 10 }}
                                scaleTo={0.97}
                                onPress={() => {
                                    setSortBy(option.value as any);
                                    setShowSortMenu(false);
                                }}
                            >
                                <ThemedText style={{ fontFamily: sortBy === option.value ? Typography.fontFamily.bold : Typography.fontFamily.regular, color: sortBy === option.value ? colors.tint : colors.text }}>
                                    {option.label}
                                </ThemedText>
                            </ScalePressable>
                        ))}
                    </Animated.View>
                </View>
            )}

            <PersonPickerModal
                visible={showPersonPicker}
                people={pickerMode === 'note' ? activitySortedPeople : allPeople}
                onSelect={handlePersonSelected}
                onClose={() => setShowPersonPicker(false)}
                title={pickerMode === 'contact' ? "Whose contact is this?" : "Who is this note for?"}
            />

            <QuickNoteModal
                visible={showQuickNoteModal}
                person={selectedPersonForNote}
                onClose={handleCloseQuickNote}
                onSave={handleSaveQuickNote}
            />

            <AddReminderModal
                visible={showAddReminderModal}
                onClose={() => setShowAddReminderModal(false)}
                date={new Date()}
                onSuccess={() => { 
                    const { showToast } = require('../../components/ui/Toast');
                    showToast('Reminder set');
                    DeviceEventEmitter.emit('refreshCalendar');
                }}
            />

            <DeleteModal
                visible={groupToDelete !== null}
                title="Delete Group"
                description="Are you sure you want to delete this group? The people in it will remain in your database."
                onCancel={() => setGroupToDelete(null)}
                onDelete={confirmDeleteGroup}
            />

            {/* Person Manage Bottom Sheet */}
            <Modal
                visible={personManagePresence.mounted}
                animationType="none"
                transparent={true}
                onRequestClose={() => setShowPersonManageModal(false)}
                statusBarTranslucent
            >
                {personManagePresence.showContent && (
                <View style={styles.modalOverlay}>
                    <Animated.View
                        entering={FadeIn.duration(250).easing(Easing.bezier(0.05, 0.7, 0.1, 1.0))}
                        exiting={FadeOut.duration(220)}
                        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
                    />
                    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowPersonManageModal(false)} />
                        <Animated.View
                            entering={SlideInDown.duration(320).springify().damping(24).stiffness(240).mass(0.9)}
                            exiting={FadeOutDown.duration(260).easing(Easing.bezier(0.4, 0, 0.5, 1))}
                            style={[
                                styles.bottomSheet,
                                {
                                    backgroundColor: colors.card,
                                    paddingBottom: insets.bottom + 160,
                                    marginBottom: -120
                                }
                            ]}
                        >
                            <View style={styles.sheetHeader}>
                                <View style={[styles.handleIndicator, { backgroundColor: colors.border }]} />
                            </View>

                            <ThemedText type="subtitle" style={{ marginBottom: 20, textAlign: 'center', fontSize: 22, fontFamily: Typography.fontFamily.medium }}>
                                {personToManage?.name}
                            </ThemedText>

                            <ScalePressable
                                onPress={handleTogglePin}
                                style={[
                                    styles.pinButton,
                                    { backgroundColor: personToManage?.isPinned ? colors.surface : colors.tint }
                                ]}
                                scaleTo={0.96}
                            >
                                <PushPin
                                    size={22}
                                    color={personToManage?.isPinned ? colors.secondary : (theme === 'dark' ? '#000' : '#fff')}
                                    weight={personToManage?.isPinned ? 'regular' : 'fill'}
                                />
                                <ThemedText style={{ fontSize: 16, fontFamily: Typography.fontFamily.bold, color: personToManage?.isPinned ? colors.text : (theme === 'dark' ? '#000' : '#fff') }}>
                                    {personToManage?.isPinned ? 'Unpin from Top' : 'Pin to Top'}
                                </ThemedText>
                            </ScalePressable>
                        </Animated.View>
                    </View>
                </View>
                )}
            </Modal>
            <QuickScrollButton
                isScrolling={isScrolling}
                direction={scrollDirection}
                scrollY={scrollY}
                contentHeight={listContentHeight}
                layoutHeight={listLayoutHeight}
                onPress={handleQuickScroll}
            />
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: DesignSystem.spacing.lg,
        marginTop: DesignSystem.spacing.md,
        marginBottom: 8,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {},
    headerAction: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        ...DesignSystem.shadows.sm,
    },
    searchSection: {
        marginBottom: 6,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    filterButton: {
        width: 52,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: DesignSystem.radius.xl,
    },
    sortMenu: {
        position: 'absolute',
        top: 60,
        right: DesignSystem.spacing.lg,
        width: 160,
        borderRadius: DesignSystem.radius.lg,
        padding: 4,
        zIndex: 1000,
        elevation: 11,
    },
    sortOption: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    list: {
        paddingHorizontal: DesignSystem.spacing.lg,
        paddingTop: DesignSystem.spacing.xs,
    },
    itemContainer: {
        marginBottom: 4,
    },
    personCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: DesignSystem.spacing.md,
    },
    personInfo: {
        flex: 1,
        marginLeft: DesignSystem.spacing.lg,
        justifyContent: 'center',
    },
    personName: {
        fontSize: Typography.size.lg,
        fontFamily: Typography.fontFamily.semibold,
        marginBottom: -1,
        letterSpacing: -0.2,
    },
    personPitch: {
        opacity: 0.7,
        fontSize: 12,
        lineHeight: 20,
        fontFamily: Typography.fontFamily.regular,
    },
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
        fontFamily: Typography.fontFamily.regular,
    },
    emptyButton: {
        alignSelf: 'center',
        paddingHorizontal: 28,
        borderRadius: 24,
        marginTop: 8,
    },
    fullScreenPage: {
        flex: 1,
    },
    handleIndicator: {
        width: 36,
        height: 5,
        borderRadius: 2.5,
        opacity: 0.5,
    },
    fullScreenHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
    },
    headerTitle: {
        fontSize: 22,
        letterSpacing: -0.5,
    },
    modalHeaderAction: {
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullScreenAvatarSection: {
        alignItems: 'center',
        paddingVertical: 32,
    },
    fullScreenAvatarWrapper: {
        position: 'relative',
    },
    fullScreenCameraBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
    },
    fullScreenForm: {
        paddingHorizontal: 24,
    },
    fullScreenRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    dashboardContainer: {
        marginBottom: 8,
    },
    section: {
        marginBottom: 16,
    },
    horizontalScroll: {
        gap: 12,
        paddingRight: 16,
    },
    highlightCard: {
        width: 240,
        height: 120,
        borderRadius: 20,
        padding: 16,
        ...DesignSystem.shadows.sm,
    },
    highlightHeader: {
        flex: 1,
    },
    highlightTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reconnectCard: {
        width: 200,
        borderRadius: 20,
        padding: 14,
        ...DesignSystem.shadows.sm,
    },
    modalOverlay: {
        flex: 1,
    },
    bottomSheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 32,
        ...DesignSystem.shadows.xl,
        width: '100%',
    },
    sheetHeader: {
        alignItems: 'center',
        marginBottom: 20,
    },
    pinButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 16,
        gap: 12,
        marginTop: 10,
    },
    addMenuOverlay: {
        ...StyleSheet.absoluteFill,
        zIndex: 999,
    },
});
