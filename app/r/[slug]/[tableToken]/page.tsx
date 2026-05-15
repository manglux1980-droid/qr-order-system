'use client'

import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMenuName, getMenuDesc, getCategoryName, localeNames } from '@/lib/i18n/config'
import type { MenuItem, MenuCategory, Locale, CartItem } from '@/lib/types'
import { Globe, Minus, Plus, X } from 'lucide-react'
import PaymentModal from '@/components/customer/PaymentModal'

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('device_id', id)
  }
  return id
}

export default function CustomerMenuPage({
  params,
}: {
  params: Promise<{ slug: string; tableToken: string }>
}) {
  const { slug, tableToken } = use(params)
  const supabase = createClient()

  const [locale, setLocale] = useState<Locale>('th')
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<{ id: string } | null>(null)
  const [order, setOrder] = useState<{ id: string } | null>(null)
  const [table, setTable] = useState<{ table_number: number; label: string | null } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState(0)

  useEffect(() => {
    const lang = navigator.language.toLowerCase()
    if (lang.startsWith('zh')) setLocale('zh')
    else if (lang.startsWith('ja')) setLocale('ja')
    else if (lang.startsWith('ko')) setLocale('ko')
    else if (lang.startsWith('th')) setLocale('th')
    else setLocale('en')
  }, [])

  useEffect(() => { init() }, [slug, tableToken])

  async function init() {
    setLoading(true)
    const deviceId = getOrCreateDeviceId()
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_token: tableToken, device_id: deviceId }),
    })
    const data = await res.json()
    if (data.session) setSession(data.session)
    if (data.order) setOrder(data.order)
    if (data.table) setTable(data.table)

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', slug)
      .single()

    if (restaurant) {
      const [{ data: cats }, { data: menuItems }] = await Promise.all([
        supabase.from('menu_categories').select('*').eq('restaurant_id', restaurant.id).eq('is_active', true).order('sort_order'),
        supabase.from('menu_items').select('*').eq('restaurant_id', restaurant.id).eq('is_available', true).order('sort_order'),
      ])
      setCategories(cats || [])
      setItems(menuItems || [])
      if (cats?.length) setActiveCategory(cats[0].id)
    }
    setLoading(false)
  }

  function addToCart(item: MenuItem) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === item.id)
      if (existing) return prev.map(c => c.menuItem.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { menuItem: item, quantity: 1 }]
    })
  }

  function removeFromCart(itemId: string) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItem.id === itemId)
      if (!existing) return prev
      if (existing.quantity <= 1) return prev.filter(c => c.menuItem.id !== itemId)
      return prev.map(c => c.menuItem.id === itemId ? { ...c, quantity: c.quantity - 1 } : c)
    })
  }

  const cartTotal = cart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0)
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0)

  async function submitOrderAndPay() {
    if (!order || !cart.length) return
    setSubmitting(true)
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.id,
        items: cart.map(c => ({
          menu_item_id: c.menuItem.id,
          quantity: c.quantity,
          price_snapshot: c.menuItem.price,
          note: c.note,
        })),
      }),
    })
    const data = await res.json()
    if (data.success) {
      setPaymentAmount(cartTotal)
      setShowCart(false)
      setShowPayment(true)
    }
    setSubmitting(false)
  }

  function onPaymentSuccess() {
    setCart([])
    setShowPayment(false)
  }

  const t = (th: string, en: string, zh: string, ja: string, ko: string) => {
    const map: Record<Locale, string> = { th, en, zh, ja, ko }
    return map[locale] || th
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🍽️</div>
        <p className="text-gray-500 text-sm">{t('กำลังโหลด...', 'Loading...', '加载中...', '読み込み中...', '로딩 중...')}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-semibold text-gray-900 text-sm">
            {table?.label || `${t('โต๊ะ', 'Table', '桌', 'テーブル', '테이블')} ${table?.table_number}`}
          </p>
          <div className="relative">
            <button
              onClick={() => setShowLangPicker(!showLangPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
            >
              <Globe size={14} />
              {localeNames[locale].split(' ')[1]}
            </button>
            {showLangPicker && (
              <div className="absolute right-0 top-10 bg-white rounded-xl shadow-lg border border-gray-200 p-2 z-50 min-w-[140px]">
                {(Object.entries(localeNames) as [Locale, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setLocale(key); setShowLangPicker(false) }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${locale === key ? 'bg-orange-50 text-orange-600 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-1 px-4 pb-3 overflow-x-auto">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${activeCategory === cat.id ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {getCategoryName(cat as unknown as Record<string, unknown>, locale)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {items
          .filter(item => item.category_id === activeCategory)
          .map(item => {
            const qty = cart.find(c => c.menuItem.id === item.id)?.quantity || 0
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="flex gap-3 p-3">
                  <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                    {item.image_url
                      ? <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-tight">
                      {getMenuName(item as unknown as Record<string, unknown>, locale)}
                    </p>
                    {item.spicy_level > 0 && (
                      <span className="text-xs text-red-500">{'🌶️'.repeat(item.spicy_level)}</span>
                    )}
                    {item.allergens?.length > 0 && (
                      <p className="text-xs text-amber-600 mt-0.5">⚠️ {item.allergens.join(', ')}</p>
                    )}
                    {getMenuDesc(item as unknown as Record<string, unknown>, locale) && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                        {getMenuDesc(item as unknown as Record<string, unknown>, locale)}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <p className="font-bold text-orange-500">฿{item.price.toLocaleString()}</p>
                      {qty === 0 ? (
                        <button
                          onClick={() => addToCart(item)}
                          className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-4 py-1.5 rounded-full transition-colors"
                        >
                          {t('เพิ่ม', 'Add', '添加', '追加', '추가')}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                            <Minus size={14} />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{qty}</span>
                          <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white">
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-6 left-4 right-4 z-40">
          <button
            onClick={() => setShowCart(true)}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-2xl py-4 px-5 flex items-center justify-between shadow-lg transition-colors"
          >
            <span className="bg-orange-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">{cartCount}</span>
            <span className="font-semibold">{t('ดูตะกร้า', 'View Cart', '查看购物车', 'カートを見る', '장바구니 보기')}</span>
            <span className="font-bold">฿{cartTotal.toLocaleString()}</span>
          </button>
        </div>
      )}

      {showCart && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCart(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{t('ตะกร้าของฉัน', 'My Cart', '我的购物车', 'マイカート', '내 장바구니')}</h2>
              <button onClick={() => setShowCart(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
              {cart.map(c => (
                <div key={c.menuItem.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-gray-900">{getMenuName(c.menuItem as unknown as Record<string, unknown>, locale)}</p>
                    <p className="text-xs text-orange-500 font-semibold">฿{(c.menuItem.price * c.quantity).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => removeFromCart(c.menuItem.id)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                      <Minus size={13} />
                    </button>
                    <span className="font-semibold text-sm w-4 text-center">{c.quantity}</span>
                    <button onClick={() => addToCart(c.menuItem)} className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100">
              <div className="flex justify-between mb-4">
                <span className="text-gray-500">{t('ยอดรวม', 'Total', '总计', '合計', '합계')}</span>
                <span className="font-bold text-lg text-gray-900">฿{cartTotal.toLocaleString()}</span>
              </div>
              <button
                onClick={submitOrderAndPay}
                disabled={submitting}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl transition-colors"
              >
                {submitting
                  ? t('กำลังส่ง...', 'Sending...', '发送中...', '送信中...', '전송 중...')
                  : t('สั่งและชำระเงิน', 'Order & Pay', '下单付款', '注文と支払い', '주문 및 결제')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPayment && session && order && (
        <PaymentModal
          sessionId={session.id}
          orderId={order.id}
          amount={paymentAmount}
          locale={locale}
          onClose={() => setShowPayment(false)}
          onSuccess={onPaymentSuccess}
        />
      )}
    </div>
  )
}
