/** The part of `navigator.clipboard` used here. */
export type TextClipboard = Pick<Clipboard, 'writeText'>

/**
 * Puts the text on the clipboard; false when there is nothing to copy, no
 * clipboard (an insecure page) or the browser refuses.
 */
export async function copyText(
    text: string,
    clipboard: TextClipboard | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
    if (!text || !clipboard) return false
    try {
        await clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
