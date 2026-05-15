import type { Locale } from '@/lib/types'

export const locales: Locale[] = ['th', 'en', 'zh', 'ja', 'ko']
export const defaultLocale: Locale = 'th'

export const localeNames: Record<Locale, string> = {
  th: '🇹🇭 ไทย',
  en: '🇬🇧 English',
  zh: '🇨🇳 中文',
  ja: '🇯🇵 日本語',
  ko: '🇰🇷 한국어',
}

export function getMenuName(item: Record<string, unknown>, locale: Locale): string {
  return (item[`name_${locale}`] as string) || (item['name_th'] as string) || ''
}

export function getMenuDesc(item: Record<string, unknown>, locale: Locale): string {
  return (item[`desc_${locale}`] as string) || (item['desc_th'] as string) || ''
}

export function getCategoryName(item: Record<string, unknown>, locale: Locale): string {
  return (item[`name_${locale}`] as string) || (item['name_th'] as string) || ''
}

// Load translations
const cache: Partial<Record<Locale, Record<string, unknown>>> = {}

export async function getTranslations(locale: Locale) {
  if (cache[locale]) return cache[locale]!
  try {
    const msgs = await import(`./locales/${locale}.json`)
    cache[locale] = msgs.default
    return msgs.default as Record<string, unknown>
  } catch {
    const msgs = await import('./locales/th.json')
    return msgs.default as Record<string, unknown>
  }
}

// Simple t() helper — supports dot notation e.g. t('cart.title')
export function createT(messages: Record<string, unknown>) {
  return function t(key: string, vars?: Record<string, string | number>): string {
    const parts = key.split('.')
    let val: unknown = messages
    for (const p of parts) {
      val = (val as Record<string, unknown>)?.[p]
    }
    let result = typeof val === 'string' ? val : key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{{${k}}}`, String(v))
      }
    }
    return result
  }
}
