/**
 * Bidirectional conversion between standard Markdown (for SQLite storage & MarkdownText viewer)
 * and HTML (for TenTap / TipTap Rich Editor).
 */

/**
 * Expands a relative `media/<file>` image reference into a URI the editor
 * WebView can load. Wired up once by `utils/media.ts`; this module stays free
 * of Expo/native imports so it can be tested in isolation.
 */
let resolveEditorImage: ((ref: string) => string) | null = null;

export function setMarkdownImageResolver(resolver: ((ref: string) => string) | null): void {
    resolveEditorImage = resolver;
}

function isMediaReference(src: string): boolean {
    return /^media\/[^/?#]+$/.test(src || '');
}

/** Absolute/stored src → relative `media/<file>` reference, or null. */
function toMediaReference(src: string): string | null {
    const clean = (src || '').split('?')[0].split('#')[0];
    if (isMediaReference(clean)) return clean;
    const marker = '/media/';
    const index = clean.lastIndexOf(marker);
    if (index === -1) return null;
    const name = clean.slice(index + marker.length);
    if (!name || name.includes('/')) return null;
    return `media/${name}`;
}

function escapeAttribute(value: string): string {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function decodeAttributeValue(value: string): string {
    return (value || '')
        .replace(/&quot;/gi, '"')
        .replace(/&#0*39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function readAttribute(attributes: string, name: string): string | null {
    const matcher = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = attributes.match(matcher);
    if (!match) return null;
    return decodeAttributeValue(match[1] ?? match[2] ?? match[3] ?? '');
}

/**
 * `![alt](media/x.jpg "Optional caption"){width=75 align=left}` — an image on
 * its own line. Images are block-level in the editor, so a standalone line is
 * the only shape we produce or accept.
 *
 * `width` is a percentage of the editor/reader content width and `align` is
 * `left | center | right`. Both are optional; the defaults (100 / center)
 * produce the plain markdown every earlier note already uses.
 */
export type ImageAlign = 'left' | 'center' | 'right';

export interface MarkdownImageInfo {
    alt: string;
    /** Reference exactly as stored: `media/<file>` or a remote URL. */
    src: string;
    /** Caption (markdown title). Empty when the image has no caption. */
    caption: string;
    /** Percentage of content width, 20-100. */
    width: number;
    align: ImageAlign;
}

const MARKDOWN_IMAGE_RE = /^!\[([^\]]*)\]\(\s*([^)\s]+?)(?:\s+"((?:\\.|[^"\\])*)")?\s*\)(?:\s*\{([^}]*)\})?$/;

const MIN_IMAGE_WIDTH = 20;
const MAX_IMAGE_WIDTH = 100;

/**
 * The editor's image schema has exactly `src/alt/title/width/height`, and
 * those attributes are the only place a block image can persist extra
 * metadata. Width carries the percentage; `height` is unused, so it carries
 * the alignment code. This is invisible in the UI and is translated back to
 * markdown immediately on save.
 */
const ALIGN_CODE: Record<ImageAlign, number> = { left: 1, center: 2, right: 3 };

function alignFromCode(value: string | number | null | undefined): ImageAlign {
    const code = Number(value);
    if (code === 1) return 'left';
    if (code === 3) return 'right';
    return 'center';
}

function clampImageWidth(value: number): number {
    if (!Number.isFinite(value)) return 100;
    return Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, Math.round(value)));
}

function unescapeCaption(value: string): string {
    return (value || '').replace(/\\(["\\])/g, '$1');
}

function parseImageAttributes(raw: string | undefined): { width: number; align: ImageAlign } {
    let width = 100;
    let align: ImageAlign = 'center';
    if (!raw) return { width, align };

    for (const part of raw.split(/[\s,]+/)) {
        if (!part) continue;
        const [key, rawValue] = part.split('=');
        if (!rawValue) continue;
        if (key === 'width') {
            width = clampImageWidth(parseFloat(rawValue.replace('%', '')));
        } else if (key === 'align') {
            const value = rawValue.toLowerCase();
            if (value === 'left' || value === 'center' || value === 'right') align = value;
        }
    }
    return { width, align };
}

/** Parses one line; returns null when it is not an image block. */
export function parseMarkdownImage(line: string): MarkdownImageInfo | null {
    const match = (line || '').trim().match(MARKDOWN_IMAGE_RE);
    if (!match) return null;
    const { width, align } = parseImageAttributes(match[4]);
    return {
        alt: match[1],
        src: match[2],
        caption: unescapeCaption(match[3] || ''),
        width,
        align,
    };
}

/** Serializes an image back to its one-line markdown form. */
export function serializeMarkdownImage(image: MarkdownImageInfo): string {
    const alt = image.alt || '';
    const caption = image.caption || '';
    const title = caption
        ? ` "${caption.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : '';
    const width = clampImageWidth(image.width);
    const align = image.align || 'center';
    const attrs: string[] = [];
    if (width !== 100) attrs.push(`width=${width}`);
    if (align !== 'center') attrs.push(`align=${align}`);
    const suffix = attrs.length ? `{${attrs.join(' ')}}` : '';
    return `![${alt}](${image.src}${title})${suffix}`;
}

/** All block images in a document, in reading order (viewer paging). */
export function collectMarkdownImages(markdown: string): MarkdownImageInfo[] {
    const images: MarkdownImageInfo[] = [];
    for (const line of (markdown || '').split(/\r?\n/)) {
        const image = parseMarkdownImage(line);
        if (image) images.push(image);
    }
    return images;
}


export function markdownToHtml(markdown: string): string {
    if (!markdown || typeof markdown !== 'string' || !markdown.trim()) return '<p></p>';

    // If input is already valid formatted HTML block from editor, return as-is
    const trimmedInput = markdown.trim();
    if (/^<(p|h[1-6]|ul|ol|blockquote|div|table|pre)[\s>]/i.test(trimmedInput) && /<\/(p|h[1-6]|ul|ol|blockquote|div|table|pre)>$/i.test(trimmedInput)) {
        return markdown;
    }

    try {
        const lines = markdown.split(/\r?\n/);
        const htmlLines: string[] = [];
        let inBulletList = false;
        let inOrderedList = false;
        let inTaskList = false;
        let inBlockquote = false;

        const closeLists = () => {
            if (inBulletList) {
                htmlLines.push('</ul>');
                inBulletList = false;
            }
            if (inOrderedList) {
                htmlLines.push('</ol>');
                inOrderedList = false;
            }
            if (inTaskList) {
                htmlLines.push('</ul>');
                inTaskList = false;
            }
            if (inBlockquote) {
                htmlLines.push('</blockquote>');
                inBlockquote = false;
            }
        };

        const convertInline = (text: string): string => {
            let res = text;
            res = res.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            res = res.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
            res = res.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            res = res.replace(/\*(.+?)\*/g, '<em>$1</em>');
            res = res.replace(/~~(.+?)~~/g, '<s>$1</s>');
            res = res.replace(/`(.+?)`/g, '<code>$1</code>');
            return res;
        };

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();

            if (!trimmed) {
                closeLists();
                // Blank markdown lines are PARAGRAPH SEPARATORS, not content.
                // Emitting <p></p> here used to resurrect a phantom empty
                // paragraph after every save→reload cycle (editor showed a
                // double gap, reader an extra blank line). Paragraph spacing
                // comes from <p> margins alone.
                continue;
            }

            // Image — always its own block, never inline. Stored references are
            // relative (`media/<file>`); the WebView needs an absolute URI, so
            // the resolver expands them here only. Width/alignment ride in the
            // image node's own width/height attributes (see ALIGN_CODE).
            const image = parseMarkdownImage(trimmed);
            if (image) {
                closeLists();
                const src = isMediaReference(image.src) && resolveEditorImage
                    ? resolveEditorImage(image.src)
                    : image.src;
                const attributes = [
                    `src="${escapeAttribute(src)}"`,
                    `alt="${escapeAttribute(image.alt)}"`,
                ];
                if (image.caption) {
                    attributes.push(`title="${escapeAttribute(image.caption)}"`);
                }
                if (image.width !== 100) {
                    attributes.push(`width="${image.width}"`);
                }
                if (image.align !== 'center') {
                    attributes.push(`height="${ALIGN_CODE[image.align]}"`);
                }
                htmlLines.push(`<img ${attributes.join(' ')}>`);
                continue;
            }

            // Explicit empty line / paragraph skip
            if (trimmed === '&nbsp;' || trimmed === '&#160;') {
                closeLists();
                htmlLines.push('<p></p>');
                continue;
            }

            // Horizontal Rule — a ^---$ multiline match becomes a paragraph whose text is
            // exactly '---'. A real <hr> cannot be used: the editor's schema has no
            // hr node and would strip it on load, so the divider must live inside
            // editable content. RichEditor renders it as a 1px line, and
            // htmlToMarkdown maps it back to a canonical \n\n---\n\n on save.
            if (trimmed === '---' || trimmed === '___' || /^[-*_]{3,}$/.test(trimmed)) {
                closeLists();
                htmlLines.push('<p>---</p>');
                continue;
            }

            // Headings
            if (trimmed.startsWith('# ')) {
                closeLists();
                htmlLines.push(`<h1>${convertInline(trimmed.substring(2))}</h1>`);
                continue;
            }
            if (trimmed.startsWith('## ')) {
                closeLists();
                htmlLines.push(`<h2>${convertInline(trimmed.substring(3))}</h2>`);
                continue;
            }
            if (trimmed.startsWith('### ')) {
                closeLists();
                htmlLines.push(`<h3>${convertInline(trimmed.substring(4))}</h3>`);
                continue;
            }

            // Blockquote
            if (trimmed.startsWith('> ')) {
                if (!inBlockquote) {
                    closeLists();
                    htmlLines.push('<blockquote>');
                    inBlockquote = true;
                }
                htmlLines.push(`<p>${convertInline(trimmed.substring(2))}</p>`);
                continue;
            } else if (inBlockquote) {
                htmlLines.push('</blockquote>');
                inBlockquote = false;
            }

            // Task List
            if (trimmed.startsWith('[ ] ') || trimmed.startsWith('[x] ') || trimmed.startsWith('[X] ')) {
                const isChecked = trimmed.startsWith('[x] ') || trimmed.startsWith('[X] ');
                const taskText = trimmed.substring(4);
                if (!inTaskList) {
                    closeLists();
                    htmlLines.push('<ul data-type="taskList">');
                    inTaskList = true;
                }
                htmlLines.push(`<li data-type="taskItem" data-checked="${isChecked}"><p>${convertInline(taskText)}</p></li>`);
                continue;
            }

            // Bullet list
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                if (!inBulletList) {
                    closeLists();
                    htmlLines.push('<ul>');
                    inBulletList = true;
                }
                htmlLines.push(`<li><p>${convertInline(trimmed.substring(2))}</p></li>`);
                continue;
            }

            // Ordered list
            const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
            if (orderedMatch) {
                if (!inOrderedList) {
                    closeLists();
                    htmlLines.push('<ol>');
                    inOrderedList = true;
                }
                htmlLines.push(`<li><p>${convertInline(orderedMatch[2])}</p></li>`);
                continue;
            }

            // Regular paragraph
            closeLists();
            htmlLines.push(`<p>${convertInline(rawLine)}</p>`);
        }

        closeLists();
        return htmlLines.join('') || '<p></p>';
    } catch (error) {
        console.error('[markdownToHtml] Conversion error, using safe fallback:', error);
        return `<p>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
    }
}

/**
 * One-line-ish preview text for list cards. Images become a neutral
 * `[Image]` marker instead of leaking `![alt](media/…)` into a card.
 */
export function markdownPreviewText(markdown: string): string {
    return (markdown || '')
        .replace(/\r\n?/g, '\n')
        .replace(/!\[[^\]]*\]\([^)]*\)(?:\s*\{[^}]*\})?/g, '[Image]')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function htmlToMarkdown(html: string): string {
    if (!html || !html.trim()) return '';

    let md = html;

    // Remove scripts and styles
    md = md.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Empty headings are ABANDONED heading lines (e.g. H1 pressed and then
    // nothing typed). Left alone they serialize to a bare '#' line, which the
    // reader then renders as literal text. Drop the block entirely.
    //
    // "Empty" means no visible text: markup, <br>, whitespace, &nbsp; and
    // zero-width entities don't count. Any textual content (characters,
    // entities like &amp;) keeps the heading. A user's own '#' characters live
    // in a <p>, never in an <hN>, so they are never at risk.
    //
    // An image-only heading counts as empty too: this converter does not
    // serialize <img> inside headings, so keeping it would emit a bare '#'.
    md = md.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (block, _level, _attrs, inner) => {
        const visible = inner
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;|&#160;|&ZeroWidthSpace;|&#8203;|&#x200B;/gi, ' ')
            .replace(/[\s\u200B\uFEFF]/g, '');
        return visible ? block : '';
    });

    // Images → relative markdown references. Runs before the generic tag
    // strip, which would otherwise delete the <img> entirely. Absolute paths
    // are collapsed back to `media/<file>` so stored notes never depend on the
    // sandbox path (it can change across app updates/restores).
    md = md.replace(/<img\b([^>]*?)\/?>/gi, (_match, attributes: string) => {
        const src = readAttribute(attributes, 'src');
        if (!src) return '';
        const alt = readAttribute(attributes, 'alt') || '';
        const caption = readAttribute(attributes, 'title') || '';
        const reference = toMediaReference(src) ?? src;
        // Width is a percentage; height is the alignment code written by
        // markdownToHtml. Any other height (e.g. a legacy pixel value) is
        // ignored and the image stays centered at its width.
        const width = clampImageWidth(parseFloat(readAttribute(attributes, 'width') || '100'));
        const align = alignFromCode(readAttribute(attributes, 'height'));
        return `\n\n${serializeMarkdownImage({ alt, src: reference, caption, width, align })}\n\n`;
    });

    // Headings
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');

    // Horizontal Rule — explicit: <hr>, <hr />, <hr/> all become a markdown
    // thematic break surrounded by blank lines.
    md = md.replace(/<\s*hr\b[^>]*>/gi, '\n\n---\n\n');

    // Task list items
    md = md.replace(/<li[^>]*data-type="taskItem"[^>]*data-checked="true"[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
        const clean = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1').trim();
        return `[x] ${clean}\n`;
    });
    md = md.replace(/<li[^>]*data-type="taskItem"[^>]*data-checked="false"[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
        const clean = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1').trim();
        return `[ ] ${clean}\n`;
    });

    // Lists
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
        return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__: any, c: string) => {
            const clean = c.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1').trim();
            if (clean.startsWith('[ ]') || clean.startsWith('[x]')) return `${clean}\n`;
            return `- ${clean}\n`;
        }) + '\n';
    });

    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
        let idx = 1;
        return items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (__: any, c: string) => {
            const clean = c.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1').trim();
            return `${idx++}. ${clean}\n`;
        }) + '\n';
    });

    // Blockquotes
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
        const clean = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n').trim();
        return `> ${clean}\n\n`;
    });

    // Paragraphs & Line Breaks
    // Divider paragraphs (<p>---</p>, <p>___</p>, <p>***</p>) → canonical thematic break
    md = md.replace(/<p[^>]*>\s*(---|___|\*\*\*)\s*<\/p>/gi, '\n\n---\n\n');
    // Empty paragraphs (<p></p>, <p><br></p>, <p>&nbsp;</p>, <p> </p>) → explicit empty line spacer (&nbsp;)
    md = md.replace(/<p[^>]*>(\s*(&nbsp;|&#160;)?\s*(<br\s*\/?>)?\s*(&nbsp;|&#160;)?\s*)<\/p>/gi, '\n&nbsp;\n');
    // Regular paragraphs → content + double newline
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // Inline marks
    md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
    md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');
    md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

    // Strip any remaining HTML tags
    md = md.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    md = md.replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    // Normalize multiple consecutive blank lines
    md = md.replace(/\n{3,}/g, '\n\n');

    return md.trim();
}
