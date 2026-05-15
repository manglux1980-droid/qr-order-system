'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Pencil, Trash2, Eye, EyeOff, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import type { MenuItem, MenuCategory } from '@/lib/types'
import MenuItemForm from '@/components/admin/MenuItemForm'

export default function MenuPage() {
  const supabase = createClient()
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restaurantId, setRestaurantId] = useState<string>('')

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
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

    setCategories(cats || [])
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

  async function addCategory() {
    if (!newCategoryName.trim()) return
    const { data } = await supabase.from('menu_categories').insert({
      restaurant_id: restaurantId,
      name_th: newCategoryName.trim(),
      sort_order: categories.length,
    }).select().single()
    if (data) {
      setCategories(prev => [...prev, data])
      setExpandedCategories(prev => new Set([...prev, data.id]))
    }
    setNewCategoryName('')
    setShowCategoryForm(false)
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
            onClick={() => setShowCategoryForm(true)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            <Plus size={16} /> เพิ่มหมวดหมู่
          </button>
          <button
            onClick={() => { setEditingItem(null); setShowForm(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} /> เพิ่มเมนู
          </button>
        </div>
      </div>

      {/* Add category form */}
      {showCategoryForm && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4 flex gap-3">
          <input
            autoFocus
            value={newCategoryName}
            onChange={e => setNewCategoryName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
            placeholder="ชื่อหมวดหมู่ เช่น อาหารจานเดียว"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button onClick={addCategory} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">บันทึก</button>
          <button onClick={() => setShowCategoryForm(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">ยกเลิก</button>
        </div>
      )}

      {/* Categories + Items */}
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
              {/* Category header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                <button
                  className="flex items-center gap-2 text-left flex-1"
                  onClick={() => toggleCategory(cat.id)}
                >
                  {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  <span className="font-medium text-gray-900">{cat.name_th}</span>
                  <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">{catItems.length}</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditingItem(null); setShowForm(true) }}
                    className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors"
                    title="เพิ่มเมนูในหมวดนี้"
                  >
                    <Plus size={15} />
                  </button>
                  <button
                    onClick={() => deleteCategory(cat.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Items */}
              {expanded && (
                <div>
                  {catItems.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">ยังไม่มีเมนูในหมวดนี้</p>
                  )}
                  {catItems.map(item => (
                    <div key={item.id} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                      {/* Image */}
                      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
                        }
                      </div>

                      {/* Info */}
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

                      {/* Actions */}
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

      {/* Menu item form modal */}
      {showForm && (
        <MenuItemForm
          restaurantId={restaurantId}
          categories={categories}
          item={editingItem}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData() }}
        />
      )}
    </div>
  )
}
