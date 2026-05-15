'use client'

import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMenuName, getMenuDesc, getCategoryName, localeNames } from '@/lib/i18n/config'
import type { MenuItem, MenuCategory, Locale } from '@/lib/types'
import { Globe, Minus, Plus, X, ArrowLeft, ShoppingCart, ChevronRight, Loader2 } from 'lucide-react'

type OptionGroupItem = {
  id: string
  name_th: string
  name_en: string | null
  name_zh: string | null
  name_ja: string | null
  name_ko: string | null
  price_delta: number
  image_url: string | null
}

type OptionGroup = {
  id: string
  name_th: string
  name_en: string | null
  name_zh: string | null
  name_ja: string | null
  name_ko: string | null
  selection_type: 'single' | 'multi'
  is_required: boolean
  option_group_items: OptionGroupItem[]
}

type SelectedOption = {
  group_id: string
  group_name: string
  option_id: string
  option_name: string
  price_delta: number
  quantity: number
}

type CartItem = {
  cartId: string
  menuItem: MenuItem
  quantity: number
  selectedOptions: SelectedOption[]
  note?: string
  unitPrice: number
}

type Step = 'categories' | 'items' | 'option_picker' | 'payment' | 'success'

function unwrapOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  if (Array.isArray(v)) return v[0] ?? null
  return v
}

export default function PreorderPage({
  params,
}: {
  params: Promise<{ slug: string; qrToken: string }>
}) {
  const { slug, qrToken } = use(params)
  const supabase = createClient()

  const [locale, setLocale] = useState<Locale>('th')
  const [showLangPicker, setShowLangPicker] = useState(false)

  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [optionGroupsByItem, setOptionGroupsByItem] = useState<Record<string, OptionGroup[]>>({})
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState('')
  const [invalidQr, setInvalidQr] = useState(false)

  const [step, setStep] = useState<Step>('categories')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [pickingItem, setPickingItem] = useState<MenuItem | null>(null)

  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)

  const [qrPaymentImg, setQrPaymentImg] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [pickupCode, setPickupCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [paid, setPaid] = useState(false)
  const [totalPaid, setTotalPaid] = useState(0)

  useEffect(() => {
    const lang = navigator.language.toLowerCase()
    if (lang.startsWith('zh')) setLocale('zh')
    else if (lang.startsWith('ja')) setLocale('ja')
    else if (lang.startsWith('ko')) setLocale('ko')
    else if (lang.startsWith('th')) setLocale('th')
    else setLocale('en')
  }, [])

  useEffect(() => { init() }, [slug, qrToken])

  async function init() {
    setLoading(true)
    const { data: qr } = await supabase
      .from('preorder_qr')
      .select('id, restaurant_id, is_active')
      .eq('qr_token', qrToken)
      .single()

    if (!qr || !qr.is_active) {
      setInvalidQr(true)
      setLoading(false)
      return
    }

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name_th, name_en')
      .eq('id', qr.restaurant_id)
      .single()

    if (restaurant) {
      setRestaurantName(locale === 'th' ? restaurant.name_th : (restaurant.name_en || restaurant.name_th))

      const [{ data: cats }, { data: menuItems }, { data: links }] = await Promise.all([
        supabase.from('menu_categories').select('*').eq('restaurant_id', restaurant.id).eq('is_active', true).order('sort_order'),
        supabase.from('menu_items').select('*').eq('restaurant_id', restaurant.id).eq('is_available', true).order('sort_order'),
        supabase
          .from('menu_item_option_groups')
          .select(`
            menu_item_id, sort_order,
            option_groups!inner (
              id, name_th, name_en, name_zh, name_ja, name_ko,
              selection_type, is_required,
              option_group_items (
                id, name_th, name_en, name_zh, name_ja, name_ko,
                price_delta, image_url, sort_order
              )
            )
          `)
          .eq('option_groups.is_active', true),
      ])

      setCategories(cats || [])
      setItems(menuItems || [])

      type LinkRow = {
        menu_item_id: string
        option_groups: OptionGroup | OptionGroup[]
      }
      const groupMap: Record<string, OptionGroup[]> = {}
      for (const link of (((links as unknown) as LinkRow[]) ?? [])) {
        const mid = link.menu_item_id
        const og = unwrapOne(link.option_groups)
        if (!og) continue
        if (!groupMap[mid]) groupMap[mid] = []
        groupMap[mid].push(og)
      }
      setOptionGroupsByItem(groupMap)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!paymentId) return
    const channel = supabase
      .channel(`preorder-payment-${paymentId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'payments', filter: `id=eq.${paymentId}`,
      }, (payload) => {
        const row = payload.new as { status: string }
        if (row.status === 'paid') {
          setPaid(true)
          setTimeout(() => setStep('success'), 1500)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [paymentId, supabase])

  const t = (th: string, en: string, zh: string, ja: string, ko: string) => {
    const map: Record<Locale, string> = { th, en, zh, ja, ko }
    return map[locale] || th
  }

  function quickAddItem(item: MenuItem) {
    const groups = optionGroupsByItem[item.id] ?? []
    if (groups.length > 0) {
      setPickingItem(item)
      setStep('option_picker')
    } else {
      addToCart(item, [], '')
    }
  }

  function addToCart(menuItem: MenuItem, selectedOptions: SelectedOption[], note: string) {
    const optDelta = selectedOptions.reduce((s, o) => s + o.price_delta * o.quantity, 0)
    setCart(prev => [...prev, {
      cartId: crypto.randomUUID(),
      menuItem,
      quantity: 1,
      selectedOptions,
      note,
      unitPrice: menuItem.price + optDelta,
    }])
    setPickingItem(null)
    setStep('items')
  }

  function updateCartQty(cartId: string, delta: number) {
    setCart(prev => prev
      .map(c => c.cartId === cartId ? { ...c, quantity: c.quantity + delta } : c)
      .filter(c => c.quantity > 0)
    )
  }

  function removeCart(cartId: string) {
    setCart(prev => prev.filter(c => c.cartId !== cartId))
  }

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const cartTotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0)

  // ─── Submit directly to payment (no customer info needed) ───
  async function submitOrder() {
    if (cart.length === 0) return
    setSubmitting(true)
    const res = await fetch('/api/preorder/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preorder_qr_token: qrToken,
        items: cart.map(c => ({
          menu_item_id: c.menuItem.id,
          quantity: c.quantity,
          price_snapshot: c.menuItem.price,
          note: c.note || null,
          options_snapshot: c.selectedOptions.map(o => ({
            group_id: o.group_id,
            group_name: o.group_name,
            option_id: o.option_id,
            option_name: o.option_name,
            price_delta: o.price_delta,
            quantity: o.quantity,
          })),
        })),
      }),
    })
    setSubmitting(false)
    const data = await res.json()
    if (!res.ok) {
      alert(data.error || 'ส่งออเดอร์ไม่สำเร็จ')
      return
    }
    setQrPaymentImg(data.qr_code)
    setPaymentId(data.payment_id)
    setPickupCode(data.pickup_code)
    setTotalPaid(data.total)
    setShowCart(false)
    setStep('payment')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🍽️</div>
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    </div>
  )

  if (invalidQr) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl p-8 max-w-md text-center">
        <div className="text-5xl mb-3">❌</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">QR ไม่ถูกต้อง</h1>
        <p className="text-sm text-gray-600">QR นี้อาจถูกปิดใช้งานแล้ว กรุณาติดต่อร้าน</p>
      </div>
    </div>
  )

  // ─── Success screen ───
  if (step === 'success' && pickupCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 text-center border-2 border-green-200">
          <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-5">
            <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-green-700 mb-2">
            {t('สั่งล่วงหน้าสำเร็จ', 'Pre-order Successful', '预订成功', '事前注文完了', '예약 완료')}
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            {t('แจ้งเลขนี้ที่ร้านเพื่อรับอาหาร', 'Show this code to pick up your food', '请向店员出示此号码取餐', 'この番号をお伝えください', '이 번호를 알려주세요')}
          </p>
          <div className="my-6 py-6 bg-orange-50 rounded-2xl border-2 border-orange-300">
            <p className="text-xs text-gray-600 mb-2">{t('เลขออเดอร์ของคุณ', 'Your Order Code', '订单号', 'ご注文番号', '주문 번호')}</p>
            <p className="text-5xl font-bold text-orange-600 tracking-wider">{pickupCode}</p>
          </div>
          <div className="flex justify-between text-sm bg-gray-50 rounded-xl p-3 mb-4">
            <span className="text-gray-600">{t('ยอดชำระ', 'Total Paid', '已付', 'お支払い', '결제 완료')}</span>
            <span className="font-bold text-green-700">฿{totalPaid.toLocaleString()}</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            {t('ระบบจะแจ้งร้านอัตโนมัติ มารับได้เลย', 'Restaurant has been notified', '餐厅已收到', '店舗に通知済', '식당에 알림 전송')}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-orange-500 text-white rounded-xl font-semibold"
          >
            {t('สั่งใหม่', 'Order Again', '再次订餐', 'もう一度注文', '다시 주문')}
          </button>
        </div>
      </div>
    )
  }

  // ─── Payment screen ───
  if (step === 'payment') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-lg max-w-md w-full p-6 text-center">
          {paid ? (
            <>
              <div className="text-6xl mb-3">✅</div>
              <h1 className="text-xl font-bold text-green-700 mb-2">
                {t('ชำระเงินสำเร็จ', 'Payment Confirmed', '付款成功', 'お支払い完了', '결제 완료')}
              </h1>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900 mb-3">
                {t('สแกนเพื่อชำระเงิน', 'Scan to Pay', '扫码支付', 'スキャンしてお支払い', '스캔하여 결제')}
              </h1>
              {qrPaymentImg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrPaymentImg} alt="Payment QR" className="mx-auto w-64 h-64 mb-4" />
              )}
              <p className="text-3xl font-bold text-orange-600 mb-2">฿{totalPaid.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mb-4">
                {t('ระบบจะอัปเดตอัตโนมัติเมื่อชำระเงินสำเร็จ', 'Updates automatically when paid', '付款后自动更新', 'お支払い後自動更新', '결제 후 자동 업데이트')}
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                <Loader2 size={14} className="animate-spin" />
                {t('รอชำระเงิน...', 'Waiting for payment...', '等待付款...', 'お支払い待ち...', '결제 대기 중...')}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── Option picker ───
  if (step === 'option_picker' && pickingItem) {
    return (
      <OptionPicker
        menuItem={pickingItem}
        groups={optionGroupsByItem[pickingItem.id] ?? []}
        locale={locale}
        t={t}
        onCancel={() => { setPickingItem(null); setStep('items') }}
        onConfirm={(selected, note) => addToCart(pickingItem, selected, note)}
      />
    )
  }

  const activeCategory = categories.find(c => c.id === activeCategoryId)
  const categoryItems = items.filter(it => it.category_id === activeCategoryId)

  const Header = (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'items' && (
              <button onClick={() => { setStep('categories'); setActiveCategoryId(null) }} className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100">
                <ArrowLeft size={20} className="text-green-700" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="font-bold text-green-700 text-lg truncate">{restaurantName || 'Pre-order'}</h1>
              <p className="text-[10px] text-orange-600 font-bold">🥡 {t('สั่งล่วงหน้า', 'PRE-ORDER', '预订', '事前注文', '예약')}</p>
            </div>
          </div>
          <div className="relative">
            <button onClick={() => setShowLangPicker(!showLangPicker)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-600 text-green-700 text-xs font-medium">
              <Globe size={14} />
              {localeNames[locale].split(' ')[1]}
            </button>
            {showLangPicker && (
              <div className="absolute right-0 top-10 bg-white rounded-xl shadow-lg border border-gray-200 p-2 z-50 min-w-[140px]">
                {(Object.entries(localeNames) as [Locale, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => { setLocale(key); setShowLangPicker(false) }} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${locale === key ? 'bg-green-50 text-green-700 font-medium' : 'hover:bg-gray-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // ─── Categories ───
  if (step === 'categories') {
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        {Header}
        <div className="px-4 py-4 grid grid-cols-2 gap-3">
          {categories.map(cat => {
            const catItemsCount = items.filter(it => it.category_id === cat.id).length
            const firstItem = items.find(it => it.category_id === cat.id && it.image_url)
            return (
              <button key={cat.id} onClick={() => { setActiveCategoryId(cat.id); setStep('items') }} className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden hover:border-green-400 active:scale-95 transition-all text-left">
                <div className="aspect-[4/3] bg-gradient-to-br from-green-50 to-green-100">
                  {firstItem?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={firstItem.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl">🍽️</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-bold text-gray-900 leading-tight">{getCategoryName(cat as unknown as Record<string, unknown>, locale)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{catItemsCount} {t('รายการ', 'items', '项', '品', '개')}</p>
                </div>
              </button>
            )
          })}
        </div>

        {cartCount > 0 && (
          <div className="fixed bottom-4 left-4 right-4 z-40">
            <button onClick={() => setShowCart(true)} className="w-full bg-green-700 text-white rounded-full py-3.5 px-5 flex items-center justify-between shadow-lg">
              <span className="flex items-center gap-2">
                <ShoppingCart size={20} />
                <span className="bg-white text-green-700 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">{cartCount}</span>
              </span>
              <span className="font-bold">{t('ดูตะกร้า', 'View Cart', '查看', 'カート', '장바구니')}</span>
              <span className="font-bold">฿{cartTotal.toLocaleString()}</span>
            </button>
          </div>
        )}

        {showCart && <CartDrawer cart={cart} cartTotal={cartTotal} locale={locale} t={t} submitting={submitting} onClose={() => setShowCart(false)} onUpdateQty={updateCartQty} onRemove={removeCart} onContinue={() => { setShowCart(false); setStep('categories') }} onSubmit={submitOrder} />}
      </div>
    )
  }

  // ─── Items ───
  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {Header}
      <div className="px-4 py-4 mb-2">
        <p className="font-bold text-gray-900">{activeCategory ? getCategoryName(activeCategory as unknown as Record<string, unknown>, locale) : ''}</p>
      </div>
      <div className="px-4 space-y-3">
        {categoryItems.map(item => {
          const hasOptions = (optionGroupsByItem[item.id] ?? []).length > 0
          const inCart = cart.filter(c => c.menuItem.id === item.id).reduce((s, c) => s + c.quantity, 0)
          return (
            <button key={item.id} onClick={() => quickAddItem(item)} className="w-full bg-white rounded-2xl border-2 border-gray-200 overflow-hidden hover:border-green-400 active:scale-[0.99] transition-all text-left">
              <div className="flex">
                <div className="w-32 h-32 bg-gradient-to-br from-green-50 to-green-100 flex-shrink-0">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">🍽️</div>
                  )}
                </div>
                <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                  <div>
                    <p className="font-bold text-gray-900 leading-tight">{getMenuName(item as unknown as Record<string, unknown>, locale)}</p>
                    {item.spicy_level > 0 && <p className="text-xs mt-0.5">{'🌶️'.repeat(item.spicy_level)}</p>}
                    {getMenuDesc(item as unknown as Record<string, unknown>, locale) && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{getMenuDesc(item as unknown as Record<string, unknown>, locale)}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-end mt-2">
                    <div className="bg-green-700 text-white font-bold px-4 py-2 rounded-full text-sm flex items-center gap-2">
                      ฿{item.price.toLocaleString()}
                      {hasOptions ? <ChevronRight size={16} /> : <Plus size={16} />}
                      {inCart > 0 && <span className="bg-white text-green-700 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{inCart}</span>}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40">
          <button onClick={() => setShowCart(true)} className="w-full bg-green-700 text-white rounded-full py-3.5 px-5 flex items-center justify-between shadow-lg">
            <span className="flex items-center gap-2">
              <ShoppingCart size={20} />
              <span className="bg-white text-green-700 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">{cartCount}</span>
            </span>
            <span className="font-bold">{t('ดูตะกร้า', 'View Cart', '查看', 'カート', '장바구니')}</span>
            <span className="font-bold">฿{cartTotal.toLocaleString()}</span>
          </button>
        </div>
      )}

      {showCart && <CartDrawer cart={cart} cartTotal={cartTotal} locale={locale} t={t} submitting={submitting} onClose={() => setShowCart(false)} onUpdateQty={updateCartQty} onRemove={removeCart} onContinue={() => { setShowCart(false); setStep('categories') }} onSubmit={submitOrder} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════

function OptionPicker({
  menuItem, groups, locale, t, onCancel, onConfirm,
}: {
  menuItem: MenuItem
  groups: OptionGroup[]
  locale: Locale
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
  onCancel: () => void
  onConfirm: (opts: SelectedOption[], note: string) => void
}) {
  const [selections, setSelections] = useState<Record<string, Record<string, number>>>({})
  const [note, setNote] = useState('')

  function getName(obj: Record<string, unknown> | null | undefined): string {
    if (!obj) return ''
    return getMenuName(obj, locale)
  }
  function getOptQty(groupId: string, optionId: string): number {
    return selections[groupId]?.[optionId] ?? 0
  }
  function setSingleSelect(group: OptionGroup, optionId: string) {
    setSelections(prev => ({ ...prev, [group.id]: { [optionId]: 1 } }))
  }
  function changeMultiQty(groupId: string, optionId: string, delta: number) {
    setSelections(prev => {
      const cur = prev[groupId] ?? {}
      const next = (cur[optionId] ?? 0) + delta
      if (next <= 0) {
        const { [optionId]: _, ...rest } = cur
        void _
        return { ...prev, [groupId]: rest }
      }
      return { ...prev, [groupId]: { ...cur, [optionId]: next } }
    })
  }
  function canConfirm(): boolean {
    for (const g of groups) {
      if (g.is_required) {
        const sel = selections[g.id]
        if (!sel || Object.keys(sel).length === 0) return false
      }
    }
    return true
  }
  let optDelta = 0
  for (const g of groups) {
    const sel = selections[g.id] ?? {}
    for (const [optId, qty] of Object.entries(sel)) {
      const opt = g.option_group_items.find(i => i.id === optId)
      if (opt) optDelta += Number(opt.price_delta) * qty
    }
  }
  const totalPrice = menuItem.price + optDelta

  function confirm() {
    const out: SelectedOption[] = []
    for (const g of groups) {
      const sel = selections[g.id] ?? {}
      for (const [optId, qty] of Object.entries(sel)) {
        const opt = g.option_group_items.find(i => i.id === optId)
        if (!opt) continue
        out.push({
          group_id: g.id,
          group_name: getName(g as unknown as Record<string, unknown>),
          option_id: optId,
          option_name: getName(opt as unknown as Record<string, unknown>),
          price_delta: Number(opt.price_delta),
          quantity: qty,
        })
      }
    }
    onConfirm(out, note)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button onClick={onCancel} className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100">
          <ArrowLeft size={20} className="text-green-700" />
        </button>
        <h1 className="font-bold text-gray-900 flex-1 truncate">{getMenuName(menuItem as unknown as Record<string, unknown>, locale)}</h1>
        <span className="font-bold text-green-700">฿{menuItem.price.toLocaleString()}</span>
      </div>
      {menuItem.image_url && (
        <div className="px-4 pt-4">
          <div className="w-32 h-32 mx-auto rounded-2xl overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={menuItem.image_url} alt="" className="w-full h-full object-cover" />
          </div>
        </div>
      )}
      <div className="px-4 py-4 space-y-5">
        {groups.map(group => {
          const groupName = getName(group as unknown as Record<string, unknown>)
          return (
            <div key={group.id}>
              <div className="mb-3">
                <h2 className="font-bold text-gray-900">
                  {groupName}
                  {group.is_required && <span className="text-red-500 ml-1">*</span>}
                </h2>
                {group.selection_type === 'multi' && (
                  <p className="text-xs text-gray-500">{t('เลือกได้หลายอย่าง', 'Choose multiple', '可多选', '複数選択可', '여러 선택 가능')}</p>
                )}
              </div>
              <div className="space-y-2">
                {group.option_group_items.map(opt => {
                  const optName = getName(opt as unknown as Record<string, unknown>)
                  const qty = getOptQty(group.id, opt.id)
                  const selected = qty > 0
                  return (
                    <div key={opt.id} className={`flex items-center gap-3 p-2 bg-white rounded-xl border-2 transition-colors ${selected ? 'border-green-500' : 'border-gray-200'}`}>
                      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                        {opt.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opt.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{optName}</p>
                        {Number(opt.price_delta) !== 0 && (
                          <p className="text-xs text-green-700 font-semibold">{Number(opt.price_delta) > 0 ? '+' : ''}฿{opt.price_delta}</p>
                        )}
                      </div>
                      {group.selection_type === 'single' ? (
                        <button onClick={() => setSingleSelect(group, opt.id)} className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${selected ? 'border-green-600 bg-green-600' : 'border-gray-300'}`}>
                          {selected && <div className="w-3 h-3 rounded-full bg-white" />}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button onClick={() => changeMultiQty(group.id, opt.id, -1)} disabled={qty === 0} className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center disabled:opacity-40">
                            <Minus size={14} />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{qty}</span>
                          <button onClick={() => changeMultiQty(group.id, opt.id, 1)} className="w-8 h-8 rounded-full bg-green-700 text-white flex items-center justify-center">
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div>
          <h2 className="font-bold text-gray-900 mb-2">{t('ความต้องการพิเศษเพิ่มเติม', 'Special requests', '特殊要求', '特別なご要望', '특별 요청')}</h2>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 resize-none" />
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-2">
        <button onClick={onCancel} className="px-5 py-3 rounded-full border-2 border-green-700 text-green-700 font-semibold">
          {t('ยกเลิก', 'Cancel', '取消', 'キャンセル', '취소')}
        </button>
        <button onClick={confirm} disabled={!canConfirm()} className="flex-1 py-3 rounded-full bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-bold">
          {t('เพิ่มเข้าตะกร้า', 'Add to Cart', '加入购物车', 'カートに追加', '장바구니')} · ฿{totalPrice.toLocaleString()}
        </button>
      </div>
    </div>
  )
}

function CartDrawer({
  cart, cartTotal, locale, t, submitting,
  onClose, onUpdateQty, onRemove, onContinue, onSubmit,
}: {
  cart: CartItem[]; cartTotal: number; locale: Locale; submitting: boolean
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
  onClose: () => void
  onUpdateQty: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onContinue: () => void
  onSubmit: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{t('ตะกร้าของฉัน', 'My Cart', '我的购物车', 'マイカート', '내 장바구니')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">{t('ตะกร้าว่างเปล่า', 'Empty', '空', '空', '비어 있음')}</p>
          ) : cart.map(c => (
            <div key={c.cartId} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <span className="font-bold text-green-700 text-sm">{c.quantity}x</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{getMenuName(c.menuItem as unknown as Record<string, unknown>, locale)}</p>
                  {c.selectedOptions.map((o, i) => (
                    <p key={i} className="text-xs text-gray-600 mt-1">
                      - {o.quantity > 1 ? `${o.quantity}x ` : ''}{o.option_name}
                      {o.price_delta !== 0 && ` (${o.price_delta > 0 ? '+' : ''}฿${o.price_delta * o.quantity})`}
                    </p>
                  ))}
                  {c.note && <p className="text-xs text-orange-600 mt-1">📝 {c.note}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-700 text-sm">฿{(c.unitPrice * c.quantity).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 mt-2">
                <button onClick={() => onRemove(c.cartId)} className="text-xs text-red-600">{t('ลบ', 'Remove', '删除', '削除', '삭제')}</button>
                <div className="flex items-center gap-2">
                  <button onClick={() => onUpdateQty(c.cartId, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center"><Minus size={14} /></button>
                  <span className="font-semibold text-sm w-4 text-center">{c.quantity}</span>
                  <button onClick={() => onUpdateQty(c.cartId, 1)} className="w-7 h-7 rounded-full bg-green-700 text-white flex items-center justify-center"><Plus size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-gray-100">
          <div className="flex justify-between mb-3">
            <span className="text-gray-700 font-medium">Total</span>
            <span className="font-bold text-xl text-green-700">฿{cartTotal.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onContinue} className="flex-1 py-3 rounded-full border-2 border-green-700 text-green-700 font-semibold text-sm">
              {t('สั่งเพิ่ม', 'Add more', '继续点餐', '追加', '추가')}
            </button>
            <button onClick={onSubmit} disabled={submitting || cart.length === 0} className="flex-1 py-3 rounded-full bg-green-700 disabled:bg-gray-300 text-white font-bold text-sm">
              {submitting
                ? t('กำลังส่ง...', 'Sending...', '提交中...', '送信中...', '전송 중...')
                : t('ชำระเงิน', 'Pay Now', '付款', 'お支払い', '결제')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
