import { invoke } from '@tauri-apps/api/core'
import BackgroundClient from 'app/BackgroundClient'

jest.mock('@tauri-apps/api/core', () => ({ invoke: jest.fn() }))

test('RAW display loads binary RGB without JSON conversion or a second orientation transform', async () => {
    const buffer = new ArrayBuffer(8 + 2 * 3 * 3)
    const header = new DataView(buffer)
    header.setUint32(0, 2, true)
    header.setUint32(4, 3, true)
    new Uint8Array(buffer, 8).fill(127)
    ;(invoke as jest.Mock).mockResolvedValueOnce(buffer)
    const image = await BackgroundClient.loadRawFile('D:/photos/portrait.NEF')
    expect(invoke).toHaveBeenLastCalledWith('load_raw_file', { path: 'D:/photos/portrait.NEF' })
    expect([image.width, image.height]).toEqual([2, 3])
    expect(image.data.buffer).toBe(buffer)
    expect(Array.from(image.data)).toEqual(Array(18).fill(127))
})

test('RAW display rejects malformed pixel lengths before uploading a texture', async () => {
    const buffer = new ArrayBuffer(9)
    const header = new DataView(buffer)
    header.setUint32(0, 2, true)
    header.setUint32(4, 3, true)
    ;(invoke as jest.Mock).mockResolvedValueOnce(buffer)
    await expect(BackgroundClient.loadRawFile('bad.nef')).rejects.toThrow('Invalid RAW image response')
})
