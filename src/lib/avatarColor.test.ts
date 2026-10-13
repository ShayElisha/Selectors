import { describe, expect, it } from 'vitest'
import { avatarColor } from './avatarColor'

describe('avatarColor', () => {
  it('assigns a deterministic palette color based on the full name', () => {
    expect(avatarColor('דנה לוי')).toBe(avatarColor('דנה לוי'))
    expect(avatarColor('דנה לוי')).not.toBe(avatarColor('דנה כהן'))
    expect(avatarColor('דנה לוי')).toMatch(/^avatar-tone-[0-7]$/)
  })
})
