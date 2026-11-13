import React from 'react';
import { View, StyleSheet, Text, Platform, Image, Pressable } from 'react-native';
import { ThemedText } from './ThemedText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Typography';
import { escapedMentionPatterns } from '../../utils/mentions';
import { mediaUri } from '../../utils/media';
import { ImageViewer, type ViewerImage } from './ImageViewer';
import { parseMarkdownImage, collectMarkdownImages, type ImageAlign, type MarkdownImageInfo } from '../../utils/markdownConverter';

interface MarkdownTextProps {
    content: string;
    style?: any;
    /**
     * Horizontal padding applied to the container. Must exactly match the
     * RichEditor's `horizontalPadding` so words wrap at the same position
     * in Read and Edit modes (journal passes 0 + outer padding; editor.tsx
     * passes 20).
     */
    paddingHorizontal?: number;
    /**
     * Connection names to highlight as @mentions. When provided, any
     * "@Full Name" whose name matches one of these entries renders in the
     * tint color (journal reader). Omitted elsewhere — plain text stays.
     */
    mentionNames?: string[];
}

/**
 * A note image inside the reader. Width is a percentage of the content column
 * and alignment mirrors the editor (left / center / right). Dimensions are
 * read asynchronously so the layout doesn't jump from a wrong default once the
 * bitmap arrives. Captions render underneath and are also shown in the viewer.
 */
const ALIGN_SELF: Record<ImageAlign, 'flex-start' | 'center' | 'flex-end'> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
};

const MarkdownImage: React.FC<{ info: MarkdownImageInfo; onPress: () => void }> = ({ info, onPress }) => {
    const { colors } = useAppTheme();
    const uri = mediaUri(info.src);
    const [ratio, setRatio] = React.useState(4 / 3);

    React.useEffect(() => {
        let alive = true;
        Image.getSize(
            uri,
            (width, height) => {
                if (alive && width > 0 && height > 0) setRatio(width / height);
            },
            () => { }
        );
        return () => { alive = false; };
    }, [uri]);

    const width = Math.max(20, Math.min(100, info.width || 100));
    const captionAlign = info.align === 'left' ? 'left' : info.align === 'right' ? 'right' : 'center';

    return (
        <View
            style={[
                styles.imageBlock,
                { width: `${width}%`, alignSelf: ALIGN_SELF[info.align] || 'center' },
            ]}
        >
            <Pressable
                onPress={onPress}
                accessibilityRole="imagebutton"
                accessibilityLabel={info.caption || info.alt || 'Note image'}
            >
                <Image
                    source={{ uri }}
                    style={[styles.image, { aspectRatio: ratio }]}
                    resizeMode="cover"
                />
            </Pressable>
            {info.caption ? (
                <ThemedText
                    style={[styles.imageCaption, { color: colors.secondary, textAlign: captionAlign }]}
                >
                    {info.caption}
                </ThemedText>
            ) : null}
        </View>
    );
};

export const MarkdownText: React.FC<MarkdownTextProps> = ({ content, style, paddingHorizontal = 0, mentionNames }) => {
    const { colors } = useAppTheme();

    // Reader image paging: one shared viewer for every image in the entry.
    // `imageLineIndex` maps a split line number to its position in the image
    // list so tapping any image opens the viewer on that image.
    const images = React.useMemo(() => collectMarkdownImages(content), [content]);
    const imageLineIndex = React.useMemo(() => {
        const map = new Map<number, number>();
        let next = 0;
        content.split(/\r\n|\r|\n/).forEach((line, lineIndex) => {
            if (parseMarkdownImage(line.trim())) {
                map.set(lineIndex, next);
                next += 1;
            }
        });
        return map;
    }, [content]);
    const viewerImages = React.useMemo<ViewerImage[]>(
        () => images.map(image => ({ uri: mediaUri(image.src), caption: image.caption })),
        [images]
    );
    const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);

    // Mention matcher: longest-name-first alternation of the provided
    // connection names. Rebuilt only when the name list identity changes.
    const mentionRegex = React.useMemo(() => {
        const escaped = escapedMentionPatterns(mentionNames || []);
        if (escaped.length === 0) return null;
        try {
            return new RegExp(`(@(?:${escaped.join('|')}))(?=$|[^\\w'’-])`, 'gi');
        } catch {
            return null;
        }
    }, [mentionNames]);

    const parseLine = (rawLine: string, index: number) => {
        const cleaned = rawLine.replace(/\r/g, '');
        const line = cleaned.trim();
        // Blank markdown lines are paragraph separators — paragraph margins
        // already provide the rhythm; rendering them adds phantom gaps.
        if (!line) {
            // But if the user intentionally had whitespace (spaces/tabs) on this line to skip a line:
            if (cleaned.length > 0) {
                const spacerHeight = (style && typeof style.lineHeight === 'number') ? Math.round(style.lineHeight * 0.75) : 18;
                return <View key={index} style={{ height: spacerHeight }} />;
            }
            return null;
        }

        // Handle explicit empty line / space spacer (&nbsp;, <br>)
        if (line === '&nbsp;' || line === '&#160;' || line === '\u00a0' || line === '<br>' || line === '<br/>' || line === '<br />') {
            const spacerHeight = (style && typeof style.lineHeight === 'number') ? Math.round(style.lineHeight * 0.75) : 18;
            return <View key={index} style={{ height: spacerHeight }} />;
        }
        // Handle images — block-level, own line (matches the converter).
        const image = parseMarkdownImage(line);
        if (image) {
            const position = imageLineIndex.get(index) ?? 0;
            return <MarkdownImage key={index} info={image} onPress={() => setViewerIndex(position)} />;
        }

        // Handle Horizontal Rule — explicit check first, then regex fallback
        if (line === '---' || line === '___' || /^[-*_]{3,}$/.test(line)) {
            return (
                <View key={index} style={[styles.divider, { backgroundColor: colors.border }]} />
            );
        }
        // Handle Headings
        if (line.startsWith('# ')) {
            return (
                <ThemedText key={index} style={[styles.h1, { color: colors.text }]}>
                    {renderInline(line.substring(2), [styles.h1, { color: colors.text }])}
                </ThemedText>
            );
        }
        if (line.startsWith('## ')) {
            return (
                <ThemedText key={index} style={[styles.h2, { color: colors.text }]}>
                    {renderInline(line.substring(3), [styles.h2, { color: colors.text }])}
                </ThemedText>
            );
        }

        // Handle Blockquotes
        if (line.startsWith('> ')) {
            return (
                <View key={index} style={[styles.blockquote, { borderLeftColor: colors.tint + '60', backgroundColor: colors.tint + '10' }]}>
                    <ThemedText style={[styles.paragraph, { color: colors.secondary }, style]}>
                        {renderInline(line.substring(2), [styles.paragraph, { color: colors.secondary }, style])}
                    </ThemedText>
                </View>
            );
        }


        // Handle Bullets
        if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
                <View key={index} style={styles.listItem}>
                    <ThemedText style={{ color: colors.tint, marginRight: 8 }}>•</ThemedText>
                    <ThemedText style={[styles.paragraph, { color: colors.text }, style]}>
                        {renderInline(line.substring(2), [styles.paragraph, { color: colors.text }, style])}
                    </ThemedText>
                </View>
            );
        }

        // Handle Ordered Lists — mirrors markdownConverter's /^(\d+)\.\s+/ rule
        // so numbered entries render as lists in both the editor and reader.
        const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (orderedMatch) {
            return (
                <View key={index} style={styles.listItem}>
                    <ThemedText style={{ color: colors.tint, marginRight: 8 }}>{orderedMatch[1]}.</ThemedText>
                    <ThemedText style={[styles.paragraph, { color: colors.text }, style]}>
                        {renderInline(orderedMatch[2], [styles.paragraph, { color: colors.text }, style])}
                    </ThemedText>
                </View>
            );
        }

        // Handle Checkboxes
        if (line.startsWith('[ ] ')) {
            return (
                <View key={index} style={styles.listItem}>
                    <View style={[styles.checkbox, { borderColor: colors.secondary }]} />
                    <ThemedText style={[styles.paragraph, { color: colors.text }, style]}>
                        {renderInline(line.substring(4), [styles.paragraph, { color: colors.text }, style])}
                    </ThemedText>
                </View>
            );
        }
        if (line.startsWith('[x] ') || line.startsWith('[X] ')) {
            return (
                <View key={index} style={styles.listItem}>
                    <View style={[styles.checkbox, styles.checkboxChecked, { backgroundColor: colors.tint, borderColor: colors.tint }]} />
                    <ThemedText style={[styles.paragraph, { color: colors.text, opacity: 0.6, textDecorationLine: 'line-through' }, style]}>
                        {renderInline(line.substring(4), [styles.paragraph, { color: colors.text, opacity: 0.6, textDecorationLine: 'line-through' }, style])}
                    </ThemedText>
                </View>
            );
        }

        return (
            <ThemedText key={index} style={[styles.paragraph, { color: colors.text }, style]}>
                {renderInline(line, [styles.paragraph, { color: colors.text }, style])}
            </ThemedText>
        );
    };

    const renderInlineMd = (text: string, baseStyle?: any): React.ReactNode => {
        const parts: React.ReactNode[] = [];
        let lastIdx = 0;

        // Regex for Bold+Italic (***), Bold (**), Italic (*), Strikethrough (~~), Inline Code (`)
        // Order matters: *** must match before ** and *
        const regex = /(\*\*\*.*?\*\*\*|\*\*.*?\*\*|\*.*?\*|~~.*?~~|`.*?`)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Text before match
            if (match.index > lastIdx) {
                parts.push(text.substring(lastIdx, match.index));
            }
            const matchStr = match[0];
            const mIdx = match.index;

            if (matchStr.startsWith('***') && matchStr.endsWith('***') && matchStr.length >= 6) {
                const inner = matchStr.substring(3, matchStr.length - 3);
                parts.push(
                    <Text
                        key={`bi-${mIdx}`}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}
                        style={[
                            baseStyle,
                            {
                                fontFamily: Typography.fontFamily.boldItalic,
                                fontWeight: '700',
                                fontStyle: 'italic',
                            },
                        ]}
                    >
                        {renderInlineMd(inner, baseStyle)}
                    </Text>
                );
            } else if (matchStr.startsWith('**') && matchStr.endsWith('**') && matchStr.length >= 4) {
                const inner = matchStr.substring(2, matchStr.length - 2);
                parts.push(
                    <Text
                        key={`b-${mIdx}`}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}
                        style={[
                            baseStyle,
                            {
                                fontFamily: Typography.fontFamily.bold,
                                fontWeight: '700',
                            },
                        ]}
                    >
                        {renderInlineMd(inner, baseStyle)}
                    </Text>
                );
            } else if (matchStr.startsWith('*') && matchStr.endsWith('*') && matchStr.length >= 2) {
                const inner = matchStr.substring(1, matchStr.length - 1);
                parts.push(
                    <Text
                        key={`i-${mIdx}`}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}
                        style={[
                            baseStyle,
                            {
                                fontFamily: Typography.fontFamily.italic,
                                fontStyle: 'italic',
                            },
                        ]}
                    >
                        {renderInlineMd(inner, baseStyle)}
                    </Text>
                );
            } else if (matchStr.startsWith('~~') && matchStr.endsWith('~~') && matchStr.length >= 4) {
                const inner = matchStr.substring(2, matchStr.length - 2);
                parts.push(
                    <Text
                        key={`s-${mIdx}`}
                        allowFontScaling={false}
                        maxFontSizeMultiplier={1}
                        style={[
                            baseStyle,
                            {
                                textDecorationLine: 'line-through',
                                opacity: 0.7,
                            },
                        ]}
                    >
                        {renderInlineMd(inner, baseStyle)}
                    </Text>
                );
            } else if (matchStr.startsWith('`') && matchStr.endsWith('`') && matchStr.length >= 2) {
                parts.push(
                    <View key={`c-${mIdx}`} style={[styles.inlineCodeContainer, { backgroundColor: colors.surface }]}>
                        <Text allowFontScaling={false} maxFontSizeMultiplier={1} style={[baseStyle, styles.inlineCode, { color: colors.tint }]}>
                            {matchStr.substring(1, matchStr.length - 1)}
                        </Text>
                    </View>
                );
            }
            lastIdx = regex.lastIndex;
        }

        if (lastIdx < text.length) {
            parts.push(text.substring(lastIdx));
        }

        return parts.length > 0 ? parts : text;
    };

    // Outer inline pass: highlights @Name mentions (when a name list is
    // provided) and renders markdown styling inside the remaining segments.
    const renderInline = (text: string, baseStyle?: any) => {
        if (!mentionRegex) return renderInlineMd(text, baseStyle);
        const out: any[] = [];
        let lastIdx = 0;
        const re = new RegExp(mentionRegex.source, 'gi');
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > lastIdx) {
                out.push(renderInlineMd(text.substring(lastIdx, m.index), baseStyle));
            }
            out.push(
                <Text key={`mention-${m.index}`} allowFontScaling={false} maxFontSizeMultiplier={1} style={[baseStyle, { color: colors.tint, fontFamily: Typography.fontFamily.semibold, fontStyle: 'normal', textDecorationLine: 'none' }]}>
                    {/* Reader shows just the colored name — the '@' is an
                        editing affordance and stays editor-only. */}
                    {m[0].slice(1)}
                </Text>
            );
            lastIdx = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++;
        }
        if (lastIdx < text.length) {
            out.push(renderInlineMd(text.substring(lastIdx), baseStyle));
        }
        return out.length > 0 ? out : text;
    };

    return (
        <View style={[styles.container, { paddingHorizontal: paddingHorizontal ?? 0 }]}>
            {content.split(/\r\n|\r|\n/).map((line, i) => parseLine(line, i))}
            <ImageViewer
                visible={viewerIndex !== null}
                images={viewerImages}
                initialIndex={viewerIndex ?? 0}
                onClose={() => setViewerIndex(null)}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    h1: {
        fontSize: 24,
        lineHeight: 32,
        fontFamily: Typography.fontFamily.black,
        fontWeight: '900',
        marginTop: 16,
        marginBottom: 8,
        letterSpacing: -0.5,
        paddingBottom: 2,
    },
    h2: {
        fontSize: 20,
        lineHeight: 28,
        fontFamily: Typography.fontFamily.extrabold,
        fontWeight: '800',
        marginTop: 12,
        marginBottom: 6,
        paddingBottom: 2,
    },
    paragraph: {
        fontSize: 16,
        lineHeight: 26,
        marginBottom: 4,
    },
    listItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 4,
        paddingLeft: 4,
    },
    checkbox: {
        width: 18,
        height: 18,
        borderWidth: 2,
        borderRadius: 4,
        marginRight: 10,
        marginTop: 4,
    },
    checkboxChecked: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    divider: {
        height: 1,
        width: '100%',
        marginVertical: 14,
        opacity: 0.6,
    },
    imageBlock: {
        marginVertical: 8,
    },
    imageCaption: {
        fontSize: 13,
        lineHeight: 18,
        marginTop: 6,
        opacity: 0.75,
    },
    image: {
        width: '100%',
        borderRadius: 12,
        backgroundColor: 'rgba(128, 128, 128, 0.12)',
    },
    blockquote: {
        borderLeftWidth: 4,
        paddingLeft: 16,
        paddingVertical: 8,
        paddingRight: 8,
        marginVertical: 8,
        borderRadius: 4,
    },
    inlineCodeContainer: {
        paddingHorizontal: 6,
        paddingTop: 3,
        paddingBottom: 1,
        borderRadius: 6,
        marginHorizontal: 2,
        alignSelf: 'flex-start',
    },
    inlineCode: {
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 14,
    },
});
