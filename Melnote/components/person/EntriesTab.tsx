
import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, Animated as RNAnimated } from 'react-native';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { ScalePressable } from '../ui/ScalePressable';
import { Swipeable } from 'react-native-gesture-handler';
import { ThemedText } from '../ui/ThemedText';
import { Card } from '../ui/Card';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { Plus, FileText, MagnifyingGlass as Search, Sparkle as Sparkles, Coffee, House as Home, Briefcase, Airplane as Plane, Gift, Target, Tag, Trash, X } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useKeyboardState } from 'react-native-keyboard-controller';
import type { AcrylicPalette } from '../../utils/acrylic';

interface EntriesTabProps {
    entries: any[];
    onAdd: () => void;
    onDelete: (id: number) => void;
    theme: 'light' | 'dark';
    isAcrylic?: boolean;
    acrylic: AcrylicPalette;
}

/** Splits a note body into a title line and a one-line summary. */
function getNoteTitleAndBody(rawContent: string) {
    if (!rawContent) return { title: 'Untitled note', body: '' };

    const lines = rawContent
        .split('\n')
        // Hide markdown images (`![alt](url){...}`) and blank-line spacers (`&nbsp;`)
        // in the note preview card so only readable text is shown.
        .map(l => l
            .replace(/!\[[^\]]*\]\([^)]*\)(?:\s*\{[^}]*\})?/g, '')
            .replace(/&nbsp;|&#160;|\u00a0/g, ' ')
            .trim()
        )
        .filter(l => l.length > 0 && !/^(-{3,}|\*{3,}|_{3,})$/.test(l));

    if (lines.length === 0) return { title: 'Untitled note', body: '' };

    const cleanLine = (line: string) =>
        line
            .replace(/^#{1,6}\s+/, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/~~(.+?)~~/g, '$1')
            .replace(/^[-*]\s+/, '')
            .replace(/^\[[ xX]\]\s+/, '')
            .trim();

    const title = cleanLine(lines[0]);
    const body = lines.slice(1).map(cleanLine).filter(Boolean).join(' ');

    return { title, body };
}

export function EntriesTab({ entries, onAdd, onDelete, theme, isAcrylic, acrylic }: EntriesTabProps) {
    const router = useRouter();
    const { colors } = useAppTheme();
    const keyboardVisible = useKeyboardState((state) => state.isVisible);
    const [search, setSearch] = useState('');

    const filteredEntries = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return entries;

        return entries.filter(e => {
            const contentMatch = (e.content && e.content.toLowerCase().includes(q)) || (e.type && e.type.toLowerCase().includes(q));

            // Comprehensive Date Match
            let dateMatch = false;
            if (e.createdAt) {
                const d = new Date(e.createdAt);
                if (!isNaN(d.getTime())) {
                    const formats = [
                        d.toLocaleDateString('default', { month: 'long', day: 'numeric' }).toLowerCase(),
                        d.toLocaleDateString('default', { month: 'short', day: 'numeric' }).toLowerCase(),
                        d.toLocaleDateString('default', { month: 'long', year: 'numeric' }).toLowerCase(),
                        d.toLocaleDateString('default', { month: 'short', year: 'numeric' }).toLowerCase()
                    ];
                    dateMatch = formats.some(f => f.includes(q));
                    if (!dateMatch && q.includes(' ')) {
                        const qParts = q.split(/\s+/);
                        dateMatch = qParts.every(part => formats.some(f => f.includes(part)));
                    }
                }
            }
            return contentMatch || dateMatch;
        });
    }, [entries, search]);

    // Parsing a note body and formatting its date is not free, and both were
    // being redone for every row on every render (including every keystroke
    // in the search box). The results are cached per entry.
    const entryMeta = useMemo(() => {
        const map = new Map<number, { title: string; body: string; dateLabel: string }>();
        entries.forEach(entry => {
            const parsed = getNoteTitleAndBody(entry.content || '');
            const created = entry.createdAt ? new Date(entry.createdAt) : null;
            map.set(entry.id, {
                title: parsed.title,
                body: parsed.body,
                dateLabel: created && !isNaN(created.getTime())
                    ? created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '',
            });
        });
        return map;
    }, [entries]);

    const getCategoryIcon = (type: string) => {
        const size = 15;
        const color = colors.tint;
        switch (type) {
            case 'Memory': return <Sparkles size={size} color={color} weight="fill" />;
            case 'Food & Drink': return <Coffee size={size} color={color} weight="fill" />;
            case 'Family': return <Home size={size} color={color} weight="fill" />;
            case 'Work': return <Briefcase size={size} color={color} weight="fill" />;
            case 'Travel': return <Plane size={size} color={color} weight="fill" />;
            case 'Gift Idea': return <Gift size={size} color={color} weight="fill" />;
            case 'Goal': return <Target size={size} color={color} weight="fill" />;
            case 'Note': return <FileText size={size} color={color} weight="fill" />;
            default: return <Tag size={size} color={color} weight="fill" />;
        }
    };

    const renderRightActions = (id: number, dragX: RNAnimated.AnimatedInterpolation<number>) => {
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
                    width: 72,
                    borderRadius: 16,
                    marginBottom: 12,
                    marginLeft: 10,
                }}
                innerStyle={{ borderRadius: 16 }}
                scale={true}
                overlayColor="rgba(0,0,0,0.15)"
                onPress={() => onDelete(id)}
            >
                <RNAnimated.View style={{ transform: [{ scale: trans }] }}>
                    <Trash size={22} color="#FFF" weight="fill" />
                </RNAnimated.View>
            </ScalePressable>
        );
    };

    return (
        <View style={styles.entriesSection}>
            <Animated.View
                entering={FadeInDown.duration(260).springify().damping(26).stiffness(280).mass(0.7)}
                style={styles.searchRow}
            >
                <View style={[styles.searchContainer, { backgroundColor: isAcrylic ? acrylic.panelMuted : colors.card, borderColor: isAcrylic ? 'transparent' : colors.border }]}>
                    <Search size={16} color={colors.icon} style={{ marginRight: 8 }} />
                    <TextInput
                        placeholder="Search notes..."
                        placeholderTextColor={colors.textTertiary}
                        value={search}
                        onChangeText={setSearch}
                        style={[styles.searchInput, { color: colors.text }]}
                    />
                    {search.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setSearch('')}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            style={{ padding: 4 }}
                        >
                            <X size={16} color={colors.icon} />
                        </TouchableOpacity>
                    )}
                </View>
                <ScalePressable
                    onPress={onAdd}
                    overlayColor="rgba(0,0,0,0.15)"
                    style={[styles.addButton, { backgroundColor: colors.tint, ...DesignSystem.shadows.sm }]}
                    innerStyle={{ borderRadius: 14 }}
                >
                    <Plus size={22} color={theme === 'light' ? '#FFFFFF' : '#000000'} weight="fill" />
                </ScalePressable>
            </Animated.View>

            {filteredEntries.length === 0 ? (
                <Animated.View
                    entering={FadeInDown.duration(260).springify().damping(26).stiffness(280).mass(0.7)}
                    style={styles.emptyState}
                >
                    <FileText size={48} color={colors.tint} weight="fill" />
                    <ThemedText style={{ marginTop: 16, fontSize: 18, fontFamily: Typography.fontFamily.bold }}>
                        {search ? 'No notes found' : 'No notes yet'}
                    </ThemedText>
                    <ThemedText style={{ color: colors.secondary, marginTop: 4, fontSize: 13, textAlign: 'center' }}>
                        {search ? 'Try a different search term.' : 'Keep track of specific details here.'}
                    </ThemedText>
                    {search.trim().length > 0 && keyboardVisible && <View style={styles.keyboardScrollSpacer} />}
                </Animated.View>
            ) : (
                filteredEntries.map((entry, index) => {
                    const meta = entryMeta.get(entry.id);
                    const title = meta?.title ?? 'Untitled note';
                    const body = meta?.body ?? '';
                    return (
                        <Animated.View
                            key={entry.id}
                            layout={Layout.springify().damping(26).stiffness(280)}
                        >
                            <Animated.View
                                entering={FadeInDown.delay(Math.min(index, 5) * 20).duration(260).springify().damping(26).stiffness(280).mass(0.7)}
                            >
                                <Swipeable
                                    renderRightActions={(_progress, dragX) => renderRightActions(entry.id, dragX)}
                                    overshootRight={false}
                                    friction={3}
                                    overshootFriction={8}
                                    rightThreshold={60}
                                >
                                    <ScalePressable
                                        onPress={() => router.push({
                                            pathname: '/editor',
                                            params: { id: entry.id, type: 'entry' }
                                        })}
                                        style={{ marginBottom: 12 }}
                                        innerStyle={{ borderRadius: 16 }}
                                    >
                                        <Card style={[{ backgroundColor: isAcrylic ? acrylic.panel : colors.surface, borderRadius: 16, borderWidth: 0 }]} padding="md">
                                            <View style={styles.entryMeta}>
                                                {getCategoryIcon(entry.type)}
                                                <ThemedText style={[styles.entryMetaType, { color: colors.secondary }]}>
                                                    {entry.type}
                                                </ThemedText>
                                                <ThemedText style={[styles.entryMetaDot, { color: colors.secondary }]}>·</ThemedText>
                                                <ThemedText style={[styles.entryMetaDate, { color: colors.secondary }]}>
                                                    {meta?.dateLabel || ''}
                                                </ThemedText>
                                            </View>

                                            <ThemedText
                                                numberOfLines={2}
                                                style={[styles.entryTitle, { color: colors.text, fontFamily: Typography.fontFamily.medium }]}
                                            >
                                                {title}
                                            </ThemedText>

                                            {body ? (
                                                <ThemedText
                                                    numberOfLines={2}
                                                    style={[styles.entryBody, { color: colors.secondary }]}
                                                >
                                                    {body}
                                                </ThemedText>
                                            ) : null}
                                        </Card>
                                    </ScalePressable>
                                </Swipeable>
                            </Animated.View>
                        </Animated.View>
                    );
                })
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    entriesSection: {
        paddingTop: 0,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    searchContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        height: 48,
        borderRadius: 14,
        borderWidth: 0,
        marginRight: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        fontFamily: Typography.fontFamily.medium,
    },
    addButton: {
        width: 48,
        height: 48,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
        opacity: 0.8,
    },
    keyboardScrollSpacer: {
        width: '100%',
        height: 220,
    },
    entryMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 5,
    },
    entryMetaType: {
        fontSize: 12,
        fontFamily: Typography.fontFamily.semibold,
        opacity: 0.65,
    },
    entryMetaDot: {
        fontSize: 12,
        opacity: 0.35,
    },
    entryMetaDate: {
        fontSize: 12,
        opacity: 0.5,
    },
    entryTitle: {
        fontSize: 15,
        lineHeight: 21,
        marginBottom: 3,
    },
    entryBody: {
        fontSize: 13,
        lineHeight: 18,
        opacity: 0.55,
    },
});




