/** Max encoded data-URL length for a profile photo (same ballpark as org logos). */
export const MAX_AVATAR_DATA_URL_LENGTH = 180_000

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/**
 * Read a local image file, crop to a centered square, and return a JPEG data URL.
 */
/** Same compression as profile photos — suitable for fault report attachments. */
export async function readFaultPhoto(file: File): Promise<string> {
  return readAvatarFile(file)
}

export async function readAvatarFile(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    throw new Error('התמונה צריכה להיות PNG, JPG או WEBP')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה'))
      el.src = url
    })
    const side = Math.min(image.width, image.height)
    if (side < 1) throw new Error('לא ניתן לקרוא את התמונה')
    const sx = Math.floor((image.width - side) / 2)
    const sy = Math.floor((image.height - side) / 2)
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('לא ניתן לעבד את התמונה')
    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size)
    const data = canvas.toDataURL('image/jpeg', 0.85)
    if (data.length > MAX_AVATAR_DATA_URL_LENGTH) {
      throw new Error('התמונה גדולה מדי. בחרו תמונה קטנה יותר')
    }
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}
