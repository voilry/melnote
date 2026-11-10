/**
 * Shared @mention pattern helpers.
 *
 * A mention is literal `@Full Name` text matched against known connection
 * names, longest-name-first, with a word-boundary lookahead so partial names
 * (`@Annaless`) and emails never match. Used by the journal screen (tag
 * reconciliation), MarkdownText (reader highlighting) and RichEditor
 * (editor highlighting via injected patterns).
 *
 * Whitespace inside a name is matched flexibly (`\s+`): a stored name like
 * "Andrea  Justin" (double space, nbsp, …) still highlights/tags the text the
 * editor actually produced, and vice versa.
 */

/** Collapses runs of whitespace and trims — used for canonical comparisons. */
export function normalizeMentionName(name: string): string {
    return (name || '').replace(/\s+/g, ' ').trim();
}

export function escapedMentionPatterns(names: string[]): string[] {
    return Array.from(new Set(names.map(n => normalizeMentionName(n)).filter(Boolean)))
        .sort((a, b) => b.length - a.length)
        .map(n => n
            .split(' ')
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+'));
}

/** Returns the mentioned names (without '@', canonical casing), deduplicated, in order of appearance. */
export function extractMentionedNames(text: string, names: string[]): string[] {
    const patterns = escapedMentionPatterns(names);
    if (!patterns.length || !text || !text.includes('@')) return [];
    // normalized -> canonical, so '@adin' resolves to the stored 'Adin'
    const canonical = new Map<string, string>();
    for (const n of names) {
        const key = normalizeMentionName(n).toLowerCase();
        if (key) canonical.set(key, normalizeMentionName(n));
    }
    const re = new RegExp(`(@(?:${patterns.join('|')}))(?=$|[^\\w'\u2019-])`, 'gi');
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const typed = normalizeMentionName(m[1].slice(1));
        found.add(canonical.get(typed.toLowerCase()) ?? typed);
        if (m[0].length === 0) re.lastIndex++;
    }
    return Array.from(found);
}

/** Person ids whose names appear as @mentions in the text. */
export function extractMentionedIds<T extends { id: number; name: string }>(text: string, persons: T[]): number[] {
    const mentioned = new Set(
        extractMentionedNames(text, persons.map(p => p.name)).map(n => n.toLowerCase())
    );
    return persons
        .filter(p => mentioned.has(normalizeMentionName(p.name).toLowerCase()))
        .map(p => p.id);
}
