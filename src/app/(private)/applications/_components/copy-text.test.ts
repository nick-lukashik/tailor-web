import { describe, expect, it, vi } from 'vitest'
import { copyText, type TextClipboard } from './copy-text'

const clipboard = (writeText: TextClipboard['writeText']): TextClipboard => ({
    writeText,
})

describe('copyText', () => {
    it('writes the text and says it worked', async () => {
        const writeText = vi.fn(async () => {})
        await expect(copyText('Hello\nworld', clipboard(writeText))).resolves.toBe(true)
        expect(writeText).toHaveBeenCalledWith('Hello\nworld')
    })

    it('says it failed when the browser refuses', async () => {
        await expect(
            copyText(
                'Hello',
                clipboard(async () => {
                    throw new DOMException('Denied', 'NotAllowedError')
                }),
            ),
        ).resolves.toBe(false)
    })

    it('copies nothing without a text or a clipboard', async () => {
        const writeText = vi.fn(async () => {})
        await expect(copyText('', clipboard(writeText))).resolves.toBe(false)
        expect(writeText).not.toHaveBeenCalled()
        await expect(copyText('Hello', undefined)).resolves.toBe(false)
    })
})
