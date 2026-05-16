'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Pencil, Trash2, Eye, EyeOff, Loader2, ChevronDown, ChevronUp, Sparkles, X, Upload } from 'lucide-react'
import type { MenuItem, MenuCategory, Locale } from '@/lib/types'
import MenuItemForm from '@/components/admin/MenuItemForm'

const LOCALES: { key: Locale; label: string }[] = [
  { key: 'th', label: '🇹🇭 ไทย' },
  { key: 'en', label: '🇬🇧 EN' },
  { key: 'zh', label: '🇨🇳 中文' },
  { key: 'ja', label: '🇯🇵 日本語' },
  { key: 'ko', label: '🇰🇷 한국어' },
]

type CategoryWithImage = MenuCategory & { image_url?: string | null }

export default function MenuPage() {
  const supabase = createClient()
  const [categories, setCategories] = useState<CategoryWithImage[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restaurantId, setRestaurantId] = useState<string>('')

  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [presetCategoryId, setPresetCategoryId] = useState<string | null>(null)

  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CategoryWithImage | null>(null)

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: ru } = await supabase
      .from('restaurant_users')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .single()

    if (!ru) return
    setRestaurantId(ru.restaurant_id)

    const [{ data: cats }, { data: menuItems }] = await Promise.all([
      supabase.from('menu_categories').select('*').eq('restaurant_id', ru.restaurant_id).order('sort_order'),
      supabase.from('menu_items').select('*').eq('restaurant_id', ru.restaurant_id).order('sort_order'),
    ])

    setCategories((cats as CategoryWithImage[]) || [])
    setItems(menuItems || [])
    setExpandedCategories(new Set((cats || []).map(c => c.id)))
    setLoading(false)
  }

  async function toggleAvailable(item: MenuItem) {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available: !i.is_available } : i))
  }

  async function deleteItem(id: string) {
    if (!confirm('ลบเมนูนี้?')) return
    await supabase.from('menu_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function deleteCategory(id: string) {
    const itemCount = items.filter(i => i.category_id === id).length
    if (!confirm(`ลบหมวดหมู่นี้? ${itemCount > 0 ? `(มีเมนู ${itemCount} รายการที่จะถูกลบด้วย)` : ''}`)) return
    await supabase.from('menu_categories').delete().eq('id', id)
    setCategories(prev => prev.filter(c => c.id !== id))
    setItems(prev => prev.filter(i => i.category_id !== id))
  }

  function toggleCategory(id: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAddCategory() {
    setEditingCategory(null)
    setShowCategoryModal(true)
  }

  function openEditCategory(cat: CategoryWithImage) {
    setEditingCategory(cat)
    setShowCategoryModal(true)
  }

  function openAddItem(categoryId?: string) {
    setEditingItem(null)
    setPresetCategoryId(categoryId ?? null)
    setShowForm(true)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-orange-500" size={32} />
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">จัดการเมนู</h1>
          <p className="text-sm text-gray-500 mt-0.5">รวม {items.length} รายการ</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openAddCategory}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            <Plus size={16} /> เพิ่มหมวดหมู่
          </button>
          <button
            onClick={() => openAddItem()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> เพิ่มเมนู
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {categories.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">ยังไม่มีหมวดหมู่</p>
            <p className="text-sm">เริ่มต้นด้วยการเพิ่มหมวดหมู่ก่อนครับ</p>
          </div>
        )}
        {categories.map(cat => {
          const catItems = items.filter(i => i.category_id === cat.id)
          const expanded = expandedCategories.has(cat.id)
          return (
            <div key={cat.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                <button
                  className="flex items-center gap-3 text-left flex-1"
                  onClick={() => toggleCategory(cat.id)}
                >
                  {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                    {cat.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cat.image_url} alt={cat.name_th} className="w-full h-full object-cover object-center" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg">📂</div>
                    )}
                  </div>
                  <span className="font-medium text-gray-900">{cat.name_th}</span>
                  {cat.name_en && <span className="text-xs text-gray-400 hidden sm:inline">{cat.name_en}</span>}
                  <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">{catItems.length}</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openAddItem(cat.id)}
                    className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                    title="เพิ่มเมนูในหมวดนี้"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    onClick={() => openEditCategory(cat)}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    title="แก้ไขหมวดหมู่"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => deleteCategory(cat.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {expanded && (
                <div>
                  {catItems.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">ยังไม่มีเมนูในหมวดนี้</p>
                  )}
                  {catItems.map(item => (
                    <div key={item.id} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                        {item.image_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover object-center" />
                          : <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
                        }
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 text-sm truncate">{item.name_th}</p>
                          {item.name_en && <span className="text-xs text-gray-400 truncate hidden sm:block">{item.name_en}</span>}
                          {item.spicy_level > 0 && (
                            <span className="text-xs">{'🌶️'.repeat(item.spicy_level)}</span>
                          )}
                        </div>
                        <p className="text-orange-600 font-semibold text-sm mt-0.5">฿{item.price.toLocaleString()}</p>
                        {item.allergens?.length > 0 && (
                          <p className="text-xs text-gray-400 mt-0.5">⚠️ {item.allergens.join(', ')}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleAvailable(item)}
                          className={`p-1.5 rounded-lg transition-colors ${item.is_available ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-100'}`}
                          title={item.is_available ? 'มีจำหน่าย' : 'หมด/ปิด'}
                        >
                          {item.is_available ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <button
                          onClick={() => { setEditingItem(item); setShowForm(true) }}
                          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showForm && (
        <MenuItemForm
          restaurantId={restaurantId}
          categories={categories}
          item={editingItem}
          presetCategoryId={presetCategoryId}
          onClose={() => { setShowForm(false); setPresetCategoryId(null) }}
          onSaved={() => { setShowForm(false); setPresetCategoryId(null); loadData() }}
        />
      )}

      {showCategoryModal && (
        <CategoryFormModal
          restaurantId={restaurantId}
          category={editingCategory}
          sortOrder={categories.length}
          onClose={() => setShowCategoryModal(false)}
          onSaved={() => { setShowCategoryModal(false); loadData() }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// Category Form Modal
// ═══════════════════════════════════════════════════
function CategoryFormModal({
  restaurantId,
  category,
  sortOrder,
  onClose,
  onSaved,
}: {
  restaurantId: string
  category: CategoryWithImage | null
  sortOrder: number
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [activeLocale, setActiveLocale] = useState<Locale>('th')
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [names, setNames] = useState<Record<Locale, string>>({
    th: category?.name_th || '',
    en: category?.name_en || '',
    zh: category?.name_zh || '',
    ja: category?.name_ja || '',
    ko: category?.name_ko || '',
  })
  const [imageUrl, setImageUrl] = useState<string>(category?.image_url || '')

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `categories/${restaurantId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('menu-images').upload(path, file)
    if (!error) {
      const { data } = supabase.storage.from('menu-images').getPublicUrl(path)
      setImageUrl(data.publicUrl)
    } else {
      alert('อัพโหลดรูปไม่สำเร็จ: ' + error.message)
    }
    setUploading(false)
  }

  async function handleTranslate() {
    if (!names.th.trim()) {
      alert('กรุณากรอกชื่อภาษาไทยก่อน')
      return
    }
    setTranslating(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name_th: names.th, desc_th: '' }),
      })
      const data = await res.json()
      if (data.names) {
        setNames(prev => ({
          ...prev,
          en: data.names.en || prev.en,
          zh: data.names.zh || prev.zh,
          ja: data.names.ja || prev.ja,
          ko: data.names.ko || prev.ko,
        }))
      } else if (data.error) {
        alert(`แปลไม่สำเร็จ: ${data.error}`)
      }
    } catch (err) {
      console.error(err)
      alert('แปลไม่สำเร็จ กรุณาลองใหม่')
    }
    setTranslating(false)
  }

  async function handleSave() {
    if (!names.th.trim()) {
      alert('กรุณากรอกชื่อภาษาไทย')
      return
    }
    setSaving(true)
    const payload = {
      name_th: names.th.trim(),
      name_en: names.en.trim() || null,
      name_zh: names.zh.trim() || null,
      name_ja: names.ja.trim() || null,
      name_ko: names.ko.trim() || null,
      image_url: imageUrl || null,
    }

    if (category) {
      await supabase.from('menu_categories').update(payload).eq('id', category.id)
    } else {
      await supabase.from('menu_categories').insert({
        ...payload,
        restaurant_id: restaurantId,
        sort_order: sortOrder,
      })
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {category ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">รูปภาพหมวดหมู่</label>
            <div className="flex items-start gap-3">
              <div className="w-24 h-24 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="w-full h-full object-cover object-center" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl">📂</div>
                )}
              </div>
              <div className="flex-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <><Loader2 size={14} className="animate-spin" /> กำลังอัพโหลด...</>
                  ) : (
                    <><Upload size={14} /> {imageUrl ? 'เปลี่ยนรูป' : 'อัพโหลดรูป'}</>
                  )}
                </button>
                {imageUrl && (
                  <button
                    onClick={() => setImageUrl('')}
                    className="ml-2 px-3 py-2 text-red-600 text-sm hover:bg-red-50 rounded-lg"
                  >
                    ลบรูป
                  </button>
                )}
                <p className="text-xs text-gray-500 mt-1">แนะนำ 800×800 px (JPG/PNG, ไม่เกิน 2MB)</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-gray-200">
            <div className="flex gap-1 flex-wrap">
              {LOCALES.map(({ key, label }) => {
                const hasValue = names[key].trim().length > 0
                return (
                  <button
                    key={key}
                    onClick={() => setActiveLocale(key)}
                    className={`px-3 py-2 text-xs font-medium transition-colors flex items-center gap-1 ${
                      activeLocale === key
                        ? 'border-b-2 border-orange-500 text-orange-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                    {hasValue && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                  </button>
                )
              })}
            </div>
            <button
              onClick={handleTranslate}
              disabled={translating || !names.th.trim()}
              className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-200 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              {translating
                ? <Loader2 size={14} className="animate-spin" />
                : <Sparkles size={14} />}
              {translating ? 'กำลังแปล...' : 'แปลอัตโนมัติ (AI)'}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ชื่อหมวดหมู่ ({LOCALES.find(l => l.key === activeLocale)?.label})
              {activeLocale === 'th' && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              type="text"
              value={names[activeLocale]}
              onChange={(e) => setNames(prev => ({ ...prev, [activeLocale]: e.target.value }))}
              placeholder={
                activeLocale === 'th'
                  ? 'เช่น อาหารจานเดียว, ขนมหวาน, เครื่องดื่ม'
                  : activeLocale === 'en' ? 'e.g. Main Dishes, Desserts, Drinks'
                  : activeLocale === 'zh' ? '例: 主菜, 甜点, 饮料'
                  : activeLocale === 'ja' ? '例: メイン, デザート, ドリンク'
                  : '예: 메인 요리, 디저트, 음료'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <p className="text-xs text-gray-500">
            💡 ใส่ชื่อภาษาไทยให้ครบ แล้วกด &quot;แปลอัตโนมัติ (AI)&quot; ได้ภาษาอื่นทันที
          </p>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !names.th.trim()}
            className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก...' : (category ? 'บันทึก' : 'เพิ่มหมวดหมู่')}
          </button>
        </div>
      </div>
    </div>
  )
}
