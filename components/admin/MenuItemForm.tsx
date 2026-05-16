'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Sparkles, Loader2, Upload, SlidersHorizontal } from 'lucide-react'
import type { MenuItem, MenuCategory, Locale } from '@/lib/types'

const LOCALES: { key: Locale; label: string }[] = [
  { key: 'th', label: '🇹🇭 ไทย' },
  { key: 'en', label: '🇬🇧 EN' },
  { key: 'zh', label: '🇨🇳 中文' },
  { key: 'ja', label: '🇯🇵 日本語' },
  { key: 'ko', label: '🇰🇷 한국어' },
]

const ALLERGENS = ['nuts', 'gluten', 'seafood', 'dairy', 'eggs', 'pork']
const ALLERGEN_LABELS: Record<string, string> = {
  nuts: 'ถั่ว', gluten: 'กลูเตน', seafood: 'อาหารทะเล',
  dairy: 'นม', eggs: 'ไข่', pork: 'หมู',
}

interface Props {
  restaurantId: string
  categories: MenuCategory[]
  item: MenuItem | null
  presetCategoryId?: string | null
  onClose: () => void
  onSaved: () => void
}

type FormData = {
  category_id: string
  price: string
  spicy_level: number
  is_available: boolean
  allergens: string[]
  image_url: string
  names: Record<Locale, string>
  descs: Record<Locale, string>
}

type OptionGroupLite = {
  id: string
  name_th: string
  selection_type: 'single' | 'multi'
  is_required: boolean
  option_group_items: Array<{ name_th: string; price_delta: number }>
}

export default function MenuItemForm({ restaurantId, categories, item, presetCategoryId, onClose, onSaved }: Props) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [activeLocale, setActiveLocale] = useState<Locale>('th')
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [form, setForm] = useState<FormData>({
    category_id: presetCategoryId || categories[0]?.id || '',
    price: '',
    spicy_level: 0,
    is_available: true,
    allergens: [],
    image_url: '',
    names: { th: '', en: '', zh: '', ja: '', ko: '' },
    descs: { th: '', en: '', zh: '', ja: '', ko: '' },
  })

  // ─── Option groups ───
  const [allGroups, setAllGroups] = useState<OptionGroupLite[]>([])
  const [linkedGroupIds, setLinkedGroupIds] = useState<Set<string>>(new Set())
  const [loadingGroups, setLoadingGroups] = useState(true)

  useEffect(() => {
    if (item) {
      setForm({
        category_id: item.category_id,
        price: String(item.price),
        spicy_level: item.spicy_level,
        is_available: item.is_available,
        allergens: item.allergens || [],
        image_url: item.image_url || '',
        names: {
          th: item.name_th || '', en: item.name_en || '',
          zh: item.name_zh || '', ja: item.name_ja || '', ko: item.name_ko || '',
        },
        descs: {
          th: item.desc_th || '', en: item.desc_en || '',
          zh: item.desc_zh || '', ja: item.desc_ja || '', ko: item.desc_ko || '',
        },
      })
    }
  }, [item])

  // Load option groups + existing links
  useEffect(() => {
    (async () => {
      setLoadingGroups(true)
      // All groups for this restaurant
      const { data: groups } = await supabase
        .from('option_groups')
        .select('id, name_th, selection_type, is_required, option_group_items(name_th, price_delta)')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('sort_order')

      setAllGroups((groups ?? []) as OptionGroupLite[])

      // Existing links for this menu item
      if (item) {
        const { data: links } = await supabase
          .from('menu_item_option_groups')
          .select('option_group_id')
          .eq('menu_item_id', item.id)
        setLinkedGroupIds(new Set((links ?? []).map(l => l.option_group_id)))
      } else {
        setLinkedGroupIds(new Set())
      }

      setLoadingGroups(false)
    })()
  }, [item, restaurantId, supabase])

  async function handleTranslate() {
    if (!form.names.th) return alert('กรุณากรอกชื่อภาษาไทยก่อน')
    setTranslating(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_th: form.names.th, desc_th: form.descs.th }),
      })
      const data = await res.json()
      if (data.names && data.descs) {
        setForm(prev => ({
          ...prev,
          names: { ...prev.names, ...data.names },
          descs: { ...prev.descs, ...data.descs },
        }))
      }
    } catch {
      alert('แปลไม่สำเร็จ กรุณาลองใหม่')
    }
    setTranslating(false)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `menu/${restaurantId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('menu-images').upload(path, file)
    if (!error) {
      const { data } = supabase.storage.from('menu-images').getPublicUrl(path)
      setForm(prev => ({ ...prev, image_url: data.publicUrl }))
    }
    setUploading(false)
  }

  function toggleGroupLink(groupId: string) {
    setLinkedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  async function handleSave() {
    if (!form.names.th || !form.price || !form.category_id) {
      return alert('กรุณากรอกชื่อไทย, ราคา และหมวดหมู่')
    }
    setSaving(true)
    const payload = {
      restaurant_id: restaurantId,
      category_id: form.category_id,
      price: parseFloat(form.price),
      spicy_level: form.spicy_level,
      is_available: form.is_available,
      allergens: form.allergens,
      image_url: form.image_url || null,
      name_th: form.names.th, name_en: form.names.en || null,
      name_zh: form.names.zh || null, name_ja: form.names.ja || null, name_ko: form.names.ko || null,
      desc_th: form.descs.th || null, desc_en: form.descs.en || null,
      desc_zh: form.descs.zh || null, desc_ja: form.descs.ja || null, desc_ko: form.descs.ko || null,
    }

    let menuItemId = item?.id
    if (item) {
      await supabase.from('menu_items').update(payload).eq('id', item.id)
    } else {
      const { data } = await supabase.from('menu_items').insert(payload).select('id').single()
      menuItemId = data?.id
    }

    // ─── Sync option group links ───
    if (menuItemId) {
      // Delete existing links
      await supabase
        .from('menu_item_option_groups')
        .delete()
        .eq('menu_item_id', menuItemId)

      // Insert new links
      const linkedIds = Array.from(linkedGroupIds)
      if (linkedIds.length > 0) {
        await supabase
          .from('menu_item_option_groups')
          .insert(
            linkedIds.map((groupId, idx) => ({
              menu_item_id: menuItemId,
              option_group_id: groupId,
              sort_order: idx,
            }))
          )
      }
    }

    setSaving(false)
    onSaved()
  }

  function toggleAllergen(a: string) {
    setForm(prev => ({
      ...prev,
      allergens: prev.allergens.includes(a)
        ? prev.allergens.filter(x => x !== a)
        : [...prev.allergens, a],
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{item ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมวดหมู่ *</label>
              <select
                value={form.category_id}
                onChange={e => setForm(prev => ({ ...prev, category_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {categories.map(c => <option key={c.id} value={c.id}>{c.name_th}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคา (฿) *</label>
              <input
                type="number"
                value={form.price}
                onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="0"
              />
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รูปภาพ</label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                {form.image_url
                  ? <img src={form.image_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>
                }
              </div>
              <div className="flex-1">
                <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploading ? 'กำลังอัพโหลด...' : 'อัพโหลดรูป'}
                </button>
                <p className="text-xs text-gray-400 mt-1">แนะนำ 800×800 px (JPG/PNG, ไม่เกิน 2MB)</p>
              </div>
            </div>
          </div>

          {/* Multilingual tabs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">ชื่อและคำอธิบาย</label>
              <button
                onClick={handleTranslate}
                disabled={translating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-medium transition-colors"
              >
                {translating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {translating ? 'กำลังแปล...' : 'แปลอัตโนมัติ (AI)'}
              </button>
            </div>

            <div className="flex gap-1 mb-3 border-b border-gray-200">
              {LOCALES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveLocale(key)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                    activeLocale === key
                      ? 'border-orange-500 text-orange-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  {form.names[key] && <span className="ml-1 w-1.5 h-1.5 bg-green-400 rounded-full inline-block" />}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <input
                value={form.names[activeLocale]}
                onChange={e => setForm(prev => ({ ...prev, names: { ...prev.names, [activeLocale]: e.target.value } }))}
                placeholder={`ชื่อเมนู ${activeLocale === 'th' ? '(บังคับ)' : '(ไม่บังคับ)'}`}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <textarea
                value={form.descs[activeLocale]}
                onChange={e => setForm(prev => ({ ...prev, descs: { ...prev.descs, [activeLocale]: e.target.value } }))}
                placeholder="คำอธิบาย (ไม่บังคับ)"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
            </div>
          </div>

          {/* ─── NEW: Option Groups Link ─── */}
          <div className="border-t border-gray-200 pt-5">
            <div className="flex items-center gap-2 mb-2">
              <SlidersHorizontal size={16} className="text-gray-500" />
              <label className="text-sm font-medium text-gray-700">ตัวเลือกพิเศษ</label>
              <span className="text-xs text-gray-400">(เลือกได้หลายกลุ่ม)</span>
            </div>

            {loadingGroups ? (
              <p className="text-xs text-gray-400 py-2">กำลังโหลด...</p>
            ) : allGroups.length === 0 ? (
              <div className="text-center py-4 bg-gray-50 border border-dashed border-gray-300 rounded-lg">
                <p className="text-xs text-gray-500">ยังไม่มีกลุ่มตัวเลือก</p>
                <a
                  href="/admin/options"
                  target="_blank"
                  className="text-xs text-orange-600 hover:underline mt-1 inline-block"
                >
                  → ไปสร้างกลุ่มตัวเลือก
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                {allGroups.map(g => {
                  const linked = linkedGroupIds.has(g.id)
                  return (
                    <label
                      key={g.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        linked
                          ? 'border-orange-300 bg-orange-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={linked}
                        onChange={() => toggleGroupLink(g.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-900">{g.name_th}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${g.selection_type === 'single' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {g.selection_type === 'single' ? 'เลือก 1' : 'เลือกหลาย'}
                          </span>
                          {g.is_required && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                              บังคับ
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 truncate">
                          {g.option_group_items.slice(0, 5).map(it => (
                            `${it.name_th}${Number(it.price_delta) !== 0 ? ` (${Number(it.price_delta) > 0 ? '+' : ''}${it.price_delta}฿)` : ''}`
                          )).join(', ')}
                          {g.option_group_items.length > 5 && '...'}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Spicy level */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ระดับความเผ็ด</label>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(level => (
                <button
                  key={level}
                  onClick={() => setForm(prev => ({ ...prev, spicy_level: level }))}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    form.spicy_level === level
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {level === 0 ? 'ไม่เผ็ด' : '🌶️'.repeat(level)}
                </button>
              ))}
            </div>
          </div>

          {/* Allergens */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">สารก่อภูมิแพ้</label>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map(a => (
                <button
                  key={a}
                  onClick={() => toggleAllergen(a)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    form.allergens.includes(a)
                      ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {ALLERGEN_LABELS[a]}
                </button>
              ))}
            </div>
          </div>

          {/* Available toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">สถานะ</p>
              <p className="text-xs text-gray-400">ปิดเมื่อเมนูหมดชั่วคราว</p>
            </div>
            <button
              onClick={() => setForm(prev => ({ ...prev, is_available: !prev.is_available }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${form.is_available ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_available ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors">
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-medium transition-colors disabled:bg-gray-300 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? 'กำลังบันทึก...' : (item ? 'บันทึกการแก้ไข' : 'เพิ่มเมนู')}
          </button>
        </div>
      </div>
    </div>
  )
}
