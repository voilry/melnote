import React from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, Keyboard, Platform } from 'react-native';
import { ThemedText } from './ThemedText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Typography';
import { X, Quotes as Quote, Code, Undo, Redo } from '@/components/ui/Icon';
import type { EditorBridge } from '@10play/tentap-editor';
import { useBridgeState } from '@10play/tentap-editor';
import * as Haptics from 'expo-haptics';

interface EditorToolbarProps {
    editor: EditorBridge;
    /**
     * Journal edit mode hides H1/H2 — converting the leading title <h1> into
     * another node type would break the protected title field.
     */
    showHeadingControls?: boolean;
}

export function EditorToolbar({
    editor,
    showHeadingControls = true,
}: EditorToolbarProps) {
    const { colors, hapticsEnabled } = useAppTheme();
    // Hook is called unconditionally (rules of hooks); editor is required.
    const bridgeState = useBridgeState(editor);

    const triggerHaptic = () => {
        if (hapticsEnabled && Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    };

    const isBoldActive = bridgeState?.isBoldActive;
    const isItalicActive = bridgeState?.isItalicActive;
    const isStrikeActive = bridgeState?.isStrikeActive;
    const headingLevel = bridgeState?.headingLevel;
    const isBulletActive = bridgeState?.isBulletListActive;
    const isTaskActive = bridgeState?.isTaskListActive;
    const isBlockquoteActive = bridgeState?.isBlockquoteActive;
    const isCodeActive = bridgeState?.isCodeActive;

    const canUndo = bridgeState?.canUndo ?? false;
    const canRedo = bridgeState?.canRedo ?? false;

    const handleAction = (action: () => void) => {
        triggerHaptic();
        action();
    };

    /**
     * H1/H2 behave like a *future-text* switch instead of rewriting the line
     * the caret is sitting in.
     *
     * Headings are block nodes, so "make the whole current paragraph a
     * heading" was the only thing `toggleHeading` could do — pressing it
     * mid-sentence grew the existing line and pushed the layout around.
     *
     * New behaviour:
     *  - caret in a paragraph that already has text → keep that line exactly
     *    as it is, open a fresh empty heading line after it and put the caret
     *    there; everything typed next is the heading.
     *  - empty line, selection, or heading line → the original toggle (so
     *    turning a heading back off still works).
     *
     * Runs in the WebView because the bridge only exposes the raw
     * `toggleHeading(level)` command.
     */
    const handleHeading = (level: 1 | 2) => {
        triggerHaptic();
        if (!editor) return;
        const webview = editor.webviewRef.current;
        if (!webview) {
            editor.toggleHeading(level);
            return;
        }
        webview.injectJavaScript(`
            (function () {
                try {
                    var pm = document.querySelector('.ProseMirror');
                    var ed = pm && pm.editor;
                    if (!ed || !ed.state) return;
                    var state = ed.state;
                    var sel = state.selection;
                    var $from = sel && sel.$from;
                    var parent = $from && $from.parent;
                    if (!parent) return;
                    var isTopLevelParagraph = $from.depth === 1 && parent.type && parent.type.name === 'paragraph';
                    var hasText = String(parent.textContent || '').trim().length > 0;
                    if (sel.empty && isTopLevelParagraph && hasText) {
                        // Leave the current line untouched; start a new empty
                        // block after it and convert THAT block to a heading.
                        ed.chain().focus().setTextSelection($from.end()).splitBlock().toggleHeading({ level: ${level} }).run();
                    } else {
                        ed.chain().focus().toggleHeading({ level: ${level} }).run();
                    }
                } catch (_e) {}
            })();
            true;
        `);
    };

    return (
        <View style={[styles.toolbar, { borderTopColor: colors.border + '30', backgroundColor: colors.background }]}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.toolbarScroll}
                keyboardShouldPersistTaps="always"
            >
                <TouchableOpacity 
                    onPress={() => {
                        triggerHaptic();
                        if (editor) editor.undo();
                    }} 
                    disabled={!canUndo} 
                    style={[styles.toolbarButton, { opacity: canUndo ? 1 : 0.3 }]}
                >
                    <Undo size={18} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity 
                    onPress={() => {
                        triggerHaptic();
                        if (editor) editor.redo();
                    }} 
                    disabled={!canRedo} 
                    style={[styles.toolbarButton, { opacity: canRedo ? 1 : 0.3 }]}
                >
                    <Redo size={18} color={colors.text} />
                </TouchableOpacity>

                <View style={[styles.toolbarDivider, { backgroundColor: colors.border + '40' }]} />

                {/* Bold */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleBold())} 
                    style={[styles.toolbarButton, isBoldActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <ThemedText style={[styles.toolbarTextBold, { color: isBoldActive ? colors.tint : colors.text }]}>B</ThemedText>
                </TouchableOpacity>

                {/* Italic */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleItalic())} 
                    style={[styles.toolbarButton, isItalicActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <ThemedText style={[styles.toolbarTextItalic, { color: isItalicActive ? colors.tint : colors.text }]}>I</ThemedText>
                </TouchableOpacity>

                {/* Strike */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleStrike())} 
                    style={[styles.toolbarButton, isStrikeActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <ThemedText style={[styles.toolbarText, { textDecorationLine: 'line-through', color: isStrikeActive ? colors.tint : colors.text }]}>S</ThemedText>
                </TouchableOpacity>

                {!showHeadingControls ? null : (
                    <>
                        <View style={[styles.toolbarDivider, { backgroundColor: colors.border + '40' }]} />

                        {/* H1 */}
                        <TouchableOpacity
                            onPress={() => handleHeading(1)}
                            style={[styles.toolbarButton, headingLevel === 1 && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                        >
                            <ThemedText style={[styles.toolbarText, { color: headingLevel === 1 ? colors.tint : colors.text, fontFamily: Typography.fontFamily.bold }]}>H1</ThemedText>
                        </TouchableOpacity>

                        {/* H2 */}
                        <TouchableOpacity
                            onPress={() => handleHeading(2)}
                            style={[styles.toolbarButton, headingLevel === 2 && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                        >
                            <ThemedText style={[styles.toolbarText, { color: headingLevel === 2 ? colors.tint : colors.text, fontFamily: Typography.fontFamily.bold }]}>H2</ThemedText>
                        </TouchableOpacity>
                    </>
                )}

                <View style={[styles.toolbarDivider, { backgroundColor: colors.border + '40' }]} />

                {/* Quote */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleBlockquote())} 
                    style={[styles.toolbarButton, isBlockquoteActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <Quote size={18} color={isBlockquoteActive ? colors.tint : colors.text} />
                </TouchableOpacity>

                {/* Bullet List */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleBulletList())} 
                    style={[styles.toolbarButton, isBulletActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <View style={[styles.bulletIcon, { borderColor: isBulletActive ? colors.tint : colors.text }]} />
                </TouchableOpacity>

                {/* Task List / Checklist */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleTaskList())} 
                    style={[styles.toolbarButton, isTaskActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <View style={[styles.checkboxIcon, { borderColor: isTaskActive ? colors.tint : colors.text }]} />
                </TouchableOpacity>

                <View style={[styles.toolbarDivider, { backgroundColor: colors.border + '40' }]} />

                {/* Code */}
                <TouchableOpacity 
                    onPress={() => handleAction(() => editor?.toggleCode())} 
                    style={[styles.toolbarButton, isCodeActive && { backgroundColor: colors.tint + '20', borderRadius: 8 }]}
                >
                    <Code size={18} color={isCodeActive ? colors.tint : colors.text} />
                </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity 
                onPress={() => {
                    triggerHaptic();
                    if (editor) editor.blur();
                    Keyboard.dismiss();
                }} 
                style={[styles.toolbarButton, { paddingLeft: 8 }]}
            >
                <X size={18} color={colors.secondary} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        height: 38,
        borderTopWidth: StyleSheet.hairlineWidth,
        marginBottom: Platform.OS === 'android' ? 2 : 0,
    },
    toolbarScroll: {
        alignItems: 'center',
        paddingRight: 20,
    },
    toolbarButton: {
        width: 36,
        height: 34,
        justifyContent: 'center',
        alignItems: 'center',
        marginHorizontal: 1,
    },
    toolbarText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.medium,
    },
    toolbarTextBold: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.bold,
    },
    toolbarTextItalic: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.italic,
    },
    toolbarDivider: {
        width: 1,
        height: 20,
        marginHorizontal: 6,
    },
    bulletIcon: {
        width: 14,
        height: 14,
        borderLeftWidth: 2,
        borderBottomWidth: 2,
        opacity: 0.85,
    },
    checkboxIcon: {
        width: 15,
        height: 15,
        borderWidth: 1.8,
        borderRadius: 3,
        opacity: 0.85,
    },
});
