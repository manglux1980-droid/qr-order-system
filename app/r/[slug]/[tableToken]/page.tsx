'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getMenuName, getMenuDesc, getCategoryName, localeNames } from '@/lib/i18n/config'
import type { MenuItem, MenuCategory, Locale } from '@/lib/types'
import { Globe, Minus, Plus, X, ArrowLeft, ShoppingCart, ChevronRight, Sparkles } from 'lucide-react'
import PaymentModal from '@/components/customer/PaymentModal'

type CategoryWithImage = MenuCategory & { image_url?: string | null }

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('device_id', id)
  }
  return id
}

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

type SubmittedItem = {
  name: string
  qty: number
  subtotal: number
  options: string[]
  createdAt: string
}

type Suggested = {
  id: string
  name_th: string
  name_en: string | null
  price: number
  image_url: string | null
  reason: string
}

type Step = 'categories' | 'items' | 'option_picker'

export default function CustomerMenuPage({
  params,
}: {
  params: Promise<{ slug: string; tableToken: string }>
}) {
  const { slug, tableToken } = use(params)
  const supabase = createClient()

  const [locale, setLocale] = useState<Locale>('th')
  const [showLangPicker, setShowLangPicker] = useState(false)

  const [categories, setCategories] = useState<CategoryWithImage[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [optionGroupsByItem, setOptionGroupsByItem] = useState<Record<string, OptionGroup[]>>({})
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState('')
  const [restaurantId, setRestaurantId] = useState<string>('')

  const [session, setSession] = useState<{ id: string; status?: string } | null>(null)
  const [order, setOrder] = useState<{ id: string } | null>(null)
  const [table, setTable] = useState<{ table_number: number; label: string | null } | null>(null)

  const [step, setStep] = useState<Step>('categories')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [pickingItem, setPickingItem] = useState<MenuItem | null>(null)

  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const [submittedItems, setSubmittedItems] = useState<SubmittedItem[]>([])
  const [billTotal, setBillTotal] = useState(0)
  const [sessionStatus, setSessionStatus] = useState<string>('open')
  const [sessionClosed, setSessionClosed] = useState(false)
  const [paidAmount, setPaidAmount] = useState(0)
  const [requestingBill, setRequestingBill] = useState(false)

  const [showPayment, setShowPayment] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ─── Suggestion state ───
  const [suggested, setSuggested] = useState<Suggested | null>(null)
  const [cartBounce, setCartBounce] = useState(false)
  const dismissedAtRef = useRef<number>(0)
  const seenSuggestionsRef = useRef<Set<string>>(new Set())
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (data.session) {
      setSession(data.session)
      setSessionStatus(data.session.status || 'open')
    }
    if (data.order) setOrder(data.order)
    if (data.table) setTable(data.table)

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name_th, name_en')
      .eq('slug', slug)
      .single()

    if (restaurant) {
      setRestaurantId(restaurant.id)
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

      setCategories((cats as CategoryWithImage[]) || [])
      setItems(menuItems || [])

      const groupMap: Record<string, OptionGroup[]> = {}
      type LinkRow = {
        menu_item_id: string
        sort_order: number
        option_groups: OptionGroup
      }
      for (const link of ((links as unknown) as LinkRow[] ?? [])) {
        const mid = link.menu_item_id
        if (!groupMap[mid]) groupMap[mid] = []
        const g = link.option_groups
        g.option_group_items = (g.option_group_items ?? []).sort((a, b) =>
          // @ts-expect-error sort_order is defined on option_group_items but not in type
          (a.sort_order ?? 0) - (b.sort_order ?? 0)
        )
        groupMap[mid].push(g)
      }
      setOptionGroupsByItem(groupMap)
    }
    setLoading(false)
  }

  // Fetch AI suggestion based on cart
  const fetchSuggestion = useCallback(async (currentCart: CartItem[]) => {
    if (!restaurantId || currentCart.length === 0) {
      setSuggested(null)
      return
    }

    // Skip if dismissed recently (within 30s)
    if (Date.now() - dismissedAtRef.current < 30000) return

    // Categories in cart (deduped)
    const cartCategories = Array.from(
      new Set(currentCart.map(c => c.menuItem.category_id))
    )

    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_id: restaurantId,
          cart_categories: cartCategories,
          exclude_item_ids: Array.from(seenSuggestionsRef.current),
        }),
      })
      const data = await res.json()
      if (data.suggested_item) {
        setSuggested(data.suggested_item)
        seenSuggestionsRef.current.add(data.suggested_item.id)

        // Auto-dismiss after 5 seconds
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = setTimeout(() => {
          setSuggested(null)
        }, 10000)
      }
    } catch (err) {
      console.warn('Suggestion fetch failed:', err)
    }
  }, [restaurantId])

  function dismissSuggestion() {
    dismissedAtRef.current = Date.now()
    setSuggested(null)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }

  function addSuggestedToCart() {
    if (!suggested) return
    const menuItem = items.find(it => it.id === suggested.id)
    if (!menuItem) {
      dismissSuggestion()
      return
    }
    // Trigger bounce animation
    setCartBounce(true)
    setTimeout(() => setCartBounce(false), 600)
    // Check if has options
    const groups = optionGroupsByItem[menuItem.id] ?? []
    if (groups.length > 0) {
      setPickingItem(menuItem)
      setStep('option_picker')
      dismissSuggestion()
    } else {
      addToCart(menuItem, [], '')
      dismissSuggestion()
    }
  }

  const refreshBill = useCallback(async () => {
    if (!session?.id) return
    const { data: sess } = await supabase
      .from('table_sessions')
      .select(`
        status,
        orders (
          status, created_at,
          order_items (
            quantity, price_snapshot, options_snapshot,
            menu_items ( name_th, name_en, name_zh, name_ja, name_ko )
          )
        )
      `)
      .eq('id', session.id)
      .single()

    if (!sess) return

    setSessionStatus(sess.status)

    type Row = {
      status: string
      orders: Array<{
        status: string
        created_at: string
        order_items: Array<{
          quantity: number
          price_snapshot: number
          options_snapshot: Array<{ group_name: string; option_name: string; price_delta: number; quantity?: number }> | null
          menu_items: Record<string, string> | null
        }>
      }>
    }
    const s = sess as unknown as Row

    const list: SubmittedItem[] = []
    let total = 0
    for (const o of s.orders ?? []) {
      if (o.status === 'cancelled') continue
      for (const it of o.order_items ?? []) {
        const name = getMenuName(it.menu_items as unknown as Record<string, unknown>, locale)
        const optDelta = (it.options_snapshot ?? []).reduce(
          (s2, op) => s2 + Number(op.price_delta) * (op.quantity ?? 1),
          0
        )
        const unitPrice = Number(it.price_snapshot) + optDelta
        const subtotal = unitPrice * it.quantity
        total += subtotal

        list.push({
          name,
          qty: it.quantity,
          subtotal,
          options: (it.options_snapshot ?? []).map(op => {
            const qty = op.quantity ?? 1
            const priceText = op.price_delta !== 0
              ? ` (${op.price_delta > 0 ? '+' : ''}฿${(Number(op.price_delta) * qty).toFixed(0)})`
              : ''
            return qty > 1
              ? `${qty}x ${op.option_name}${priceText}`
              : `${op.option_name}${priceText}`
          }),
          createdAt: o.created_at,
        })
      }
    }

    setSubmittedItems(list)
    setBillTotal(total)

    if (s.status === 'closed') {
      setPaidAmount(total)
      setSessionClosed(true)
      setShowCart(false)
      setShowBill(false)
      setShowPayment(false)
      setShowSuccess(false)
      setCart([])
    }
  }, [session?.id, supabase, locale])

  useEffect(() => {
    if (!session?.id) return
    refreshBill()
    const channel = supabase
      .channel(`customer-session-${session.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_sessions', filter: `id=eq.${session.id}` }, () => refreshBill())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => refreshBill())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => refreshBill())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session?.id, refreshBill, supabase])

  const t = (th: string, en: string, zh: string, ja: string, ko: string) => {
    const map: Record<Locale, string> = { th, en, zh, ja, ko }
    return map[locale] || th
  }

  function addToCart(menuItem: MenuItem, selectedOptions: SelectedOption[], note: string) {
    const optDelta = selectedOptions.reduce((s, o) => s + o.price_delta * o.quantity, 0)
    const unitPrice = menuItem.price + optDelta
    const newCart = [...cart, {
      cartId: crypto.randomUUID(),
      menuItem,
      quantity: 1,
      selectedOptions,
      note,
      unitPrice,
    }]
    setCart(newCart)
    setPickingItem(null)
    setStep('items')

    // Trigger AI suggestion after add
    fetchSuggestion(newCart)
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

  function quickAddItem(item: MenuItem) {
    const groups = optionGroupsByItem[item.id] ?? []
    if (groups.length > 0) {
      setPickingItem(item)
      setStep('option_picker')
    } else {
      addToCart(item, [], '')
    }
  }

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const cartTotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0)

  async function submitToKitchen() {
    if (!order || !cart.length) return
    setSubmitting(true)
    const items = cart.map(c => ({
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
    }))

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.id, items }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (data.success) {
      setCart([])
      setShowCart(false)
      setShowSuccess(true)
      seenSuggestionsRef.current.clear()  // reset suggestion history
      dismissSuggestion()
      refreshBill()
    } else {
      alert(t('ส่งครัวไม่สำเร็จ', 'Failed to send', '发送失败', '送信失敗', '전송 실패'))
    }
  }

  async function requestBill() {
    if (!session?.id) return
    setRequestingBill(true)
    const res = await fetch('/api/cashier/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.id }),
    })
    setRequestingBill(false)
    if (!res.ok) {
      const json = await res.json()
      alert(json.error)
      return
    }
    setShowBill(false)
    refreshBill()
  }

  async function cancelBillRequest() {
    if (!session?.id) return
    setRequestingBill(true)
    await fetch(`/api/cashier/request?session_id=${session.id}`, { method: 'DELETE' })
    setRequestingBill(false)
    refreshBill()
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🍽️</div>
        <p className="text-gray-500 text-sm">{t('กำลังโหลด...', 'Loading...', '加载中...', '読み込み中...', '로딩 중...')}</p>
      </div>
    </div>
  )

  if (sessionClosed) {
    return <ThankYouScreen paidAmount={paidAmount} table={table} t={t} />
  }

  const isPaying = sessionStatus === 'paying'
  const activeCategory = categories.find(c => c.id === activeCategoryId)
  const categoryItems = items.filter(it => it.category_id === activeCategoryId)

  if (step === 'option_picker' && pickingItem) {
    return (
      <OptionPicker
        menuItem={pickingItem}
        groups={optionGroupsByItem[pickingItem.id] ?? []}
        locale={locale}
        t={t}
        onCancel={() => { setPickingItem(null); setStep('items') }}
        onConfirm={(selectedOptions, note) => addToCart(pickingItem, selectedOptions, note)}
      />
    )
  }

  const Header = (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'items' && (
              <button
                onClick={() => { setStep('categories'); setActiveCategoryId(null) }}
                className="p-1.5 -ml-1.5 rounded-full hover:bg-gray-100"
              >
                <ArrowLeft size={20} className="text-green-700" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="font-bold text-green-700 text-lg truncate">
                {restaurantName || 'QR Order'}
              </h1>
            </div>
          </div>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowLangPicker(!showLangPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-green-600 text-green-700 text-xs font-medium hover:bg-green-50"
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
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${locale === key ? 'bg-green-50 text-green-700 font-medium' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="text-gray-500">{step === 'items' && activeCategory ? getCategoryName(activeCategory as unknown as Record<string, unknown>, locale) : t('หมวดหมู่', 'Categories', '分类', 'カテゴリー', '카테고리')}</span>
          </div>
          <div className="text-right">
            <p className="font-semibold text-gray-900">
              {t('โต๊ะที่', 'Table', '桌台', 'テーブル', '테이블')} : {table?.table_number ?? '?'}
            </p>
            {table?.label && <p className="text-gray-500 text-[10px]">{table.label}</p>}
          </div>
        </div>
      </div>

      {isPaying && (
        <div className="mx-4 mb-3 p-3 bg-orange-50 border-2 border-orange-300 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="flex-1 text-xs font-bold text-orange-700">
              {t('เรียกแคชเชียร์แล้ว · กรุณาแจ้งเลขโต๊ะ', 'Cashier called · Tell table number', '已通知收银 · 请告知桌号', '会計係に通知済', '계산원 호출됨')}
            </p>
            <button onClick={cancelBillRequest} disabled={requestingBill} className="text-xs text-gray-600 underline">
              {t('ยกเลิก', 'Cancel', '取消', 'キャンセル', '취소')}
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const SuggestionBanner = suggested && (
    <div className="fixed left-4 right-4 z-40 animate-slide-up" style={{ bottom: cartCount > 0 || billTotal > 0 ? '88px' : '16px' }}>
      <div className="bg-white border-2 border-purple-300 rounded-2xl shadow-xl p-3 flex items-center gap-3">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-50 to-pink-50 overflow-hidden flex-shrink-0">
          {suggested.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={suggested.image_url} alt="" className="w-full h-full object-cover object-center" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-purple-600 font-bold flex items-center gap-1">
            <Sparkles size={10} /> {t('แนะนำ', 'Suggested', '推荐', 'おすすめ', '추천')}
          </p>
          <p className="font-bold text-gray-900 text-sm truncate">{suggested.name_th}</p>
          <p className="text-xs text-gray-600 truncate">{suggested.reason}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button onClick={dismissSuggestion} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
          <button
            onClick={addSuggestedToCart}
            className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap flex items-center gap-1"
          >
            ฿{suggested.price} <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  )

  if (step === 'categories') {
    return (
      <div className="min-h-screen bg-gray-50 pb-28">
        {Header}

        <div className="px-4 py-4 grid grid-cols-2 gap-3">
          {categories.map(cat => {
            const catItemsCount = items.filter(it => it.category_id === cat.id).length
            const firstItem = items.find(it => it.category_id === cat.id && it.image_url)
            const previewImg = cat.image_url || firstItem?.image_url
            return (
              <button
                key={cat.id}
                onClick={() => { setActiveCategoryId(cat.id); setStep('items') }}
                className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden hover:border-green-400 active:scale-95 transition-all text-left"
              >
                <div className="aspect-[4/3] bg-gradient-to-br from-green-50 to-green-100 relative">
                  {previewImg ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewImg} alt="" className="w-full h-full object-cover object-center" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl">🍽️</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-bold text-gray-900 leading-tight">
                    {getCategoryName(cat as unknown as Record<string, unknown>, locale)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {catItemsCount} {t('รายการ', 'items', '项', '品', '개')}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {categories.length === 0 && (
          <p className="text-center text-gray-400 py-12 text-sm">
            {t('ยังไม่มีเมนู', 'No menu yet', '暂无菜单', 'メニューがありません', '메뉴 없음')}
          </p>
        )}

        {SuggestionBanner}

        <FloatingButtons
          cartCount={cartCount}
          cartTotal={cartTotal}
          billTotal={billTotal}
          bounce={cartBounce}
          onShowCart={() => setShowCart(true)}
          onShowBill={() => setShowBill(true)}
          t={t}
        />

        {showCart && <CartDrawer cart={cart} cartTotal={cartTotal} locale={locale} t={t} onClose={() => setShowCart(false)} onUpdateQty={updateCartQty} onRemove={removeCart} onContinue={() => { setShowCart(false); setStep('categories') }} onSubmit={submitToKitchen} submitting={submitting} />}
        {showBill && <BillDrawer table={table} submittedItems={submittedItems} billTotal={billTotal} isPaying={isPaying} requestingBill={requestingBill} t={t} onClose={() => setShowBill(false)} onRequestBill={requestBill} onCancelRequest={cancelBillRequest} onPayQr={() => { setShowBill(false); setShowPayment(true) }} />}
        {showSuccess && <SuccessOverlay t={t} onShowBill={() => { setShowSuccess(false); setShowBill(true) }} onContinue={() => setShowSuccess(false)} />}
        {showPayment && session && (
          <PaymentModal sessionId={session.id} amount={billTotal} onClose={() => setShowPayment(false)} onPaid={() => { setShowPayment(false); refreshBill() }} />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      {Header}

      <div className="px-4 py-4 mb-2">
        <p className="font-bold text-gray-900">
          {activeCategory ? getCategoryName(activeCategory as unknown as Record<string, unknown>, locale) : ''}
        </p>
      </div>

      <div className="px-4 space-y-3">
        {categoryItems.map(item => {
          const hasOptions = (optionGroupsByItem[item.id] ?? []).length > 0
          const inCart = cart.filter(c => c.menuItem.id === item.id).reduce((s, c) => s + c.quantity, 0)
          return (
            <button
              key={item.id}
              onClick={() => quickAddItem(item)}
              className="w-full bg-white rounded-2xl border-2 border-gray-200 overflow-hidden hover:border-green-400 active:scale-[0.99] transition-all text-left"
            >
              <div className="flex">
                <div className="w-32 h-32 bg-gradient-to-br from-green-50 to-green-100 flex-shrink-0">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover object-center" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">🍽️</div>
                  )}
                </div>
                <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                  <div>
                    <p className="font-bold text-gray-900 leading-tight">
                      {getMenuName(item as unknown as Record<string, unknown>, locale)}
                    </p>
                    {item.spicy_level > 0 && (
                      <p className="text-xs mt-0.5">{'🌶️'.repeat(item.spicy_level)}</p>
                    )}
                    {getMenuDesc(item as unknown as Record<string, unknown>, locale) && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {getMenuDesc(item as unknown as Record<string, unknown>, locale)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-end mt-2">
                    <div className="bg-green-700 hover:bg-green-800 text-white font-bold px-4 py-2 rounded-full text-sm flex items-center gap-2">
                      ฿{item.price.toLocaleString()}
                      {hasOptions ? <ChevronRight size={16} /> : <Plus size={16} />}
                      {inCart > 0 && (
                        <span className="bg-white text-green-700 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                          {inCart}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}

        {categoryItems.length === 0 && (
          <p className="text-center text-gray-400 py-12 text-sm">
            {t('ยังไม่มีเมนูในหมวดนี้', 'No items', '暂无项目', '商品なし', '항목 없음')}
          </p>
        )}
      </div>

      {SuggestionBanner}

      <FloatingButtons cartCount={cartCount} cartTotal={cartTotal} billTotal={billTotal} onShowCart={() => setShowCart(true)} onShowBill={() => setShowBill(true)} t={t} />

      {showCart && <CartDrawer cart={cart} cartTotal={cartTotal} locale={locale} t={t} onClose={() => setShowCart(false)} onUpdateQty={updateCartQty} onRemove={removeCart} onContinue={() => { setShowCart(false); setStep('categories') }} onSubmit={submitToKitchen} submitting={submitting} />}
      {showBill && <BillDrawer table={table} submittedItems={submittedItems} billTotal={billTotal} isPaying={isPaying} requestingBill={requestingBill} t={t} onClose={() => setShowBill(false)} onRequestBill={requestBill} onCancelRequest={cancelBillRequest} onPayQr={() => { setShowBill(false); setShowPayment(true) }} />}
      {showSuccess && <SuccessOverlay t={t} onShowBill={() => { setShowSuccess(false); setShowBill(true) }} onContinue={() => setShowSuccess(false)} />}
      {showPayment && session && (
        <PaymentModal sessionId={session.id} amount={billTotal} onClose={() => setShowPayment(false)} onPaid={() => { setShowPayment(false); refreshBill() }} />
      )}

      <style jsx>{`
        @keyframes slide-up {
          from { transform: translateY(120%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
               
        
        
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS (unchanged)
// ═══════════════════════════════════════════════════

function FloatingButtons({ cartCount, cartTotal, billTotal, bounce, onShowCart, onShowBill, t }: {
  cartCount: number; cartTotal: number; billTotal: number
  bounce?: boolean
  onShowCart: () => void; onShowBill: () => void
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
}) {
  if (cartCount === 0 && billTotal === 0) return null
  return (
    <div className="fixed bottom-4 left-4 right-4 z-40">
      {cartCount > 0 ? (
        <button
          onClick={onShowCart}
          className={`w-full text-white rounded-full py-3.5 px-5 flex items-center justify-between shadow-lg transition-all duration-300 ${bounce ? 'bg-green-400 scale-110 ring-4 ring-green-300' : 'bg-green-700 hover:bg-green-800'}`}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart size={20} className={`transition-transform duration-300 ${bounce ? 'scale-150 -rotate-12' : ''}`} />
            <span className="bg-white text-green-700 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
              {cartCount}
            </span>
          </span>
          <span className="font-bold">{t('ดูตะกร้า', 'View Cart', '查看购物车', 'カート', '장바구니')}</span>
          <span className="font-bold">฿{cartTotal.toLocaleString()}</span>
        </button>
      ) : (
        <button
          onClick={onShowBill}
          className="w-full bg-white border-2 border-green-700 text-green-700 rounded-full py-3 px-5 flex items-center justify-between shadow-md hover:bg-green-50"
        >
          <span className="text-sm font-medium">{t('บิลทั้งโต๊ะ', 'Table Bill', '本桌账单', 'テーブル合計', '테이블 청구')}</span>
          <span className="font-bold">฿{billTotal.toLocaleString()}</span>
        </button>
      )}
    </div>
  )
}

function OptionPicker({
  menuItem,
  groups,
  locale,
  t,
  onCancel,
  onConfirm,
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
        <h1 className="font-bold text-gray-900 flex-1 truncate">
          {getMenuName(menuItem as unknown as Record<string, unknown>, locale)}
        </h1>
        <span className="font-bold text-green-700">฿{menuItem.price.toLocaleString()}</span>
      </div>

      {menuItem.image_url && (
        <div className="px-4 pt-4">
          <div className="w-32 h-32 mx-auto rounded-2xl overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={menuItem.image_url} alt="" className="w-full h-full object-cover object-center" />
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
                  <p className="text-xs text-gray-500">
                    {t('เลือกได้หลายอย่าง', 'Choose multiple', '可多选', '複数選択可', '여러 선택 가능')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {group.option_group_items.map(opt => {
                  const optName = getName(opt as unknown as Record<string, unknown>)
                  const qty = getOptQty(group.id, opt.id)
                  const selected = qty > 0

                  return (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-3 p-2 bg-white rounded-xl border-2 transition-colors ${selected ? 'border-green-500' : 'border-gray-200'}`}
                    >
                      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                        {opt.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opt.image_url} alt="" className="w-full h-full object-cover object-center" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-2xl">🍽️</div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{optName}</p>
                        {Number(opt.price_delta) !== 0 && (
                          <p className="text-xs text-green-700 font-semibold">
                            {Number(opt.price_delta) > 0 ? '+' : ''}฿{opt.price_delta}
                          </p>
                        )}
                      </div>

                      {group.selection_type === 'single' ? (
                        <button
                          onClick={() => setSingleSelect(group, opt.id)}
                          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center ${selected ? 'border-green-600 bg-green-600' : 'border-gray-300'}`}
                        >
                          {selected && <div className="w-3 h-3 rounded-full bg-white" />}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => changeMultiQty(group.id, opt.id, -1)}
                            disabled={qty === 0}
                            className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center disabled:opacity-40"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="font-semibold text-sm w-4 text-center">{qty}</span>
                          <button
                            onClick={() => changeMultiQty(group.id, opt.id, 1)}
                            className="w-8 h-8 rounded-full bg-green-700 text-white flex items-center justify-center"
                          >
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
          <h2 className="font-bold text-gray-900 mb-2">
            {t('ความต้องการพิเศษเพิ่มเติม', 'Special requests', '特殊要求', '特別なご要望', '특별 요청')}
          </h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('เช่น ไม่ใส่ผัก, เผ็ดน้อย', 'e.g. no veggies, mild', '例:不要蔬菜', '例: 野菜なし', '예: 채소 빼고')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 resize-none"
          />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-2">
        <button
          onClick={onCancel}
          className="px-5 py-3 rounded-full border-2 border-green-700 text-green-700 font-semibold"
        >
          {t('ยกเลิก', 'Cancel', '取消', 'キャンセル', '취소')}
        </button>
        <button
          onClick={confirm}
          disabled={!canConfirm()}
          className="flex-1 py-3 rounded-full bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-bold"
        >
          {t('เพิ่มเข้าตะกร้า', 'Add to Cart', '加入购物车', 'カートに追加', '장바구니에 추가')} · ฿{totalPrice.toLocaleString()}
        </button>
      </div>
    </div>
  )
}

function CartDrawer({
  cart, cartTotal, locale, t,
  onClose, onUpdateQty, onRemove, onContinue, onSubmit, submitting,
}: {
  cart: CartItem[]; cartTotal: number; locale: Locale
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
  onClose: () => void
  onUpdateQty: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onContinue: () => void
  onSubmit: () => void
  submitting: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">{t('รายการอาหารในตะกร้าของฉัน', 'My Cart', '我的购物车', 'マイカート', '내 장바구니')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">{t('ตะกร้าว่างเปล่า', 'Cart is empty', '购物车为空', 'カートは空', '장바구니 비어 있음')}</p>
          ) : cart.map(c => (
            <div key={c.cartId} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <span className="font-bold text-green-700 text-sm">{c.quantity}x</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">
                    {getMenuName(c.menuItem as unknown as Record<string, unknown>, locale)}
                  </p>
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
                  <button onClick={() => onUpdateQty(c.cartId, -1)} className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                    <Minus size={14} />
                  </button>
                  <span className="font-semibold text-sm w-4 text-center">{c.quantity}</span>
                  <button onClick={() => onUpdateQty(c.cartId, 1)} className="w-7 h-7 rounded-full bg-green-700 text-white flex items-center justify-center">
                    <Plus size={14} />
                  </button>
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
              {t('สั่งอาหารเพิ่ม', 'Add more', '继续点餐', '追加注文', '추가 주문')}
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting || cart.length === 0}
              className="flex-1 py-3 rounded-full bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-bold text-sm"
            >
              {submitting
                ? t('กำลังส่ง...', 'Sending...', '发送中...', '送信中...', '전송 중...')
                : t('ส่งรายการอาหาร', 'Send Order', '提交订单', '注文送信', '주문 전송')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function BillDrawer({
  table, submittedItems, billTotal, isPaying, requestingBill, t,
  onClose, onRequestBill, onCancelRequest, onPayQr,
}: {
  table: { table_number: number; label: string | null } | null
  submittedItems: SubmittedItem[]
  billTotal: number
  isPaying: boolean
  requestingBill: boolean
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
  onClose: () => void
  onRequestBill: () => void
  onCancelRequest: () => void
  onPayQr: () => void
}) {
  function timeStr(iso: string) {
    const d = new Date(iso)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">
            {t('รายการอาหารที่สั่งจากเว็บ', 'Items Ordered', '已订菜品', '注文済', '주문 내역')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
          {submittedItems.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">{t('ยังไม่มีรายการ', 'No items yet', '暂无项目', 'まだ注文がありません', '아직 없음')}</p>
          ) : submittedItems.map((it, idx) => (
            <div key={idx} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <span className="font-bold text-green-700 text-sm">{it.qty}x</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{it.name}</p>
                  {it.options.map((opt, i) => (
                    <p key={i} className="text-xs text-gray-600 mt-0.5">- {opt}</p>
                  ))}
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-700 text-sm">฿ {it.subtotal.toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-0.5">🕒 {timeStr(it.createdAt)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-700 font-medium">Total</span>
            <span className="font-bold text-xl text-green-700">฿{billTotal.toLocaleString()}</span>
          </div>

          {!isPaying && billTotal > 0 && (
            <>
              <button
                onClick={onRequestBill}
                disabled={requestingBill}
                className="w-full py-3 rounded-full bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white font-bold"
              >
                {requestingBill
                  ? t('กำลังเรียก...', 'Calling...', '呼叫中...', '呼出中...', '호출 중...')
                  : t('💰 ขอจ่ายเงิน (ที่แคชเชียร์)', '💰 Request Bill (Cashier)', '💰 请求账单（收银台）', '💰 会計をお願い', '💰 계산 요청')}
              </button>
              <button
                onClick={onPayQr}
                className="w-full py-2.5 rounded-full border border-gray-300 text-gray-700 font-medium text-sm"
              >
                {t('📱 จ่ายด้วย QR ที่โต๊ะ', '📱 Pay by QR at table', '📱 桌台扫码支付', '📱 QR決済', '📱 QR 결제')}
              </button>
            </>
          )}

          {isPaying && (
            <button
              onClick={onCancelRequest}
              disabled={requestingBill}
              className="w-full py-3 rounded-full border border-gray-300 text-gray-700 font-medium"
            >
              {t('ยกเลิกการขอจ่าย (สั่งเพิ่ม)', 'Cancel Request (Order More)', '取消请求（继续点餐）', 'キャンセル（追加注文）', '취소 (추가 주문)')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SuccessOverlay({ t, onShowBill, onContinue }: {
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
  onShowBill: () => void
  onContinue: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(() => onContinue(), 8000)
    return () => clearTimeout(timer)
  }, [onContinue])

  return (
    <div className="fixed inset-0 z-[55] bg-white flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-32 h-32 mx-auto rounded-full border-8 border-green-600 flex items-center justify-center mb-6">
          <svg className="w-20 h-20 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {t('สั่งอาหารสำเร็จ', 'Order Sent!', '点餐成功', '注文送信完了', '주문 완료')}
        </h1>
        <p className="text-gray-600 mb-8">
          {t('ขอเวลาสักครู่ เรากำลังเตรียมอาหารสำหรับคุณ', 'Please wait, we are preparing your food', '请稍等，正在准备您的食物', 'お料理をご用意しております', '음식을 준비하고 있습니다')}
        </p>
        <div className="space-y-3">
          <button onClick={onShowBill} className="w-full py-3 rounded-full border-2 border-green-700 text-green-700 font-semibold">
            {t('รายการอาหารที่สั่งจากเว็บ', 'View Order List', '查看订单', '注文一覧', '주문 내역')}
          </button>
          <button onClick={onContinue} className="w-full py-3 rounded-full border-2 border-green-700 text-green-700 font-semibold">
            {t('สั่งอาหารเพิ่ม', 'Order More', '继续点餐', '追加注文', '추가 주문')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ThankYouScreen({ paidAmount, table, t }: {
  paidAmount: number
  table: { table_number: number; label: string | null } | null
  t: (th: string, en: string, zh: string, ja: string, ko: string) => string
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-gradient-to-br from-green-50 via-white to-orange-50 flex items-center justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center border-2 border-green-200">
        <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5 animate-bounce">
          <div className="text-5xl">✅</div>
        </div>
        <h1 className="text-2xl font-bold text-green-700 mb-2">
          {t('ชำระเงินสำเร็จ', 'Payment Successful', '付款成功', 'お支払い完了', '결제 완료')}
        </h1>
        {paidAmount > 0 && (
          <div className="my-5 py-4 bg-green-50 rounded-2xl border border-green-200">
            <p className="text-xs text-gray-600 mb-1">{t('ยอดที่ชำระ', 'Amount Paid', '已付金额', 'お支払い金額', '결제 금액')}</p>
            <p className="text-3xl font-bold text-green-700">฿{paidAmount.toLocaleString()}</p>
          </div>
        )}
        <div className="my-6 space-y-2">
          <p className="text-xl font-semibold text-gray-900">{t('ขอบคุณที่ใช้บริการ', 'Thank You!', '感谢光临', 'ありがとうございました', '감사합니다')}</p>
          <p className="text-sm text-gray-600">{t('หวังว่าจะได้พบกันใหม่ 🙏', 'Hope to see you again 🙏', '期待再次光临 🙏', 'またのご来店をお待ちしております 🙏', '다시 만나기를 기대합니다 🙏')}</p>
        </div>
        {table?.table_number && (
          <p className="text-xs text-gray-400 mb-6">{t('โต๊ะ', 'Table', '桌', 'テーブル', '테이블')} #{table.table_number}</p>
        )}
        <button onClick={() => window.location.reload()} className="w-full px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold">
          {t('สั่งใหม่', 'Order Again', '再次点餐', 'もう一度注문', '다시 주문')}
        </button>
      </div>
    </div>
  )
}
