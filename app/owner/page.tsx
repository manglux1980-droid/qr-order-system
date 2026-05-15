'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, DollarSign, UtensilsCrossed, CheckCircle, ChefHat, Loader2, Volume2, VolumeX } from 'lucide-react'

interface OrderItem {
  id: string
  menu_item_id: string
  quantity: number
  price_snapshot: number
  note: string | null
  status: string
  menu_items: { name_th: string }
}

interface Order {
  id: string
  status: string
  created_at: string
  nickname: string | null
  session_id: string
  order_items: OrderItem[]
  table_sessions: {
    id: string
    session_code: string
    tables: { table_number: number; label: string | null }
  }
}

interface MenuItem {
  id: string
  name_th: string
  price: number
  is_available: boolean
  image_url: string | null
}

type Tab = 'orders' | 'cashier' | 'menu'

function speak(text: string) {
  if (typeof window === 'undefined') return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'th-TH'
  u.rate = 0.95
  u.pitch = 1.1
  window.speechSynthesis.speak(u)
}

function playBeep(type: 'order' | 'payment') {
  try {
    const ctx = new AudioContext()
    const frequencies = type === 'order' ? [880, 1100] : [660, 880, 1100]
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.2)
      osc.start(ctx.currentTime + i * 0.15)
      osc.stop(ctx.currentTime + i * 0.15 + 0.3)
    })
  } catch {}
}

export default function OwnerPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [restaurantId, setRestaurantId] = useState('')
  const [loading, setLoading] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [newOrderAlert, setNewOrderAlert] = useState<Order | null>(null)
  const soundOnRef = useRef(true)

  useEffect(() => { soundOnRef.current = soundOn }, [soundOn])

  useEffect(() => {
    initOwner()
  }, [])

  async function initOwner() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: ru } = await supabase
      .from('restaurant_users')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .single()
    if (!ru) return

    setRestaurantId(ru.restaurant_id)

    // Subscribe FIRST so we don't miss any events
    subscribeRealtime(ru.restaurant_id)
    await Promise.all([
      loadOrders(ru.restaurant_id),
      loadMenu(ru.restaurant_id),
    ])
    setLoading(false)
  }

  async function loadOrders(rid: string) {
    const { data } = await supabase
      .from('orders')
      .select(`
        id, status, created_at, nickname, session_id,
        order_items (id, menu_item_id, quantity, price_snapshot, note, status,
          menu_items (name_th)
        ),
        table_sessions!inner (id, session_code, status,
          tables (table_number, label)
        )
      `)
      .eq('restaurant_id', rid)
      .in('status', ['confirmed', 'cooking', 'served'])
      .order('created_at', { ascending: false })
      .limit(50)

    // Filter out orders from closed sessions
    const filtered = ((data as unknown as Order[]) || []).filter(
      o => (o.table_sessions as unknown as { status: string })?.status !== 'closed'
    )
    setOrders(filtered)
  }

  async function loadMenu(rid: string) {
    const { data } = await supabase
      .from('menu_items')
      .select('id, name_th, price, is_available, image_url')
      .eq('restaurant_id', rid)
      .order('sort_order')
    setMenuItems(data || [])
  }

  function subscribeRealtime(rid: string) {
    supabase
      .channel('owner-orders')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'order_items',
      }, async () => {
        await loadOrders(rid)
        const { data } = await supabase
          .from('orders')
          .select(`
            id, status, created_at, nickname, session_id,
            order_items (id, quantity, price_snapshot, note, status, menu_item_id,
              menu_items (name_th)
            ),
            table_sessions (id, session_code,
              tables (table_number, label)
            )
          `)
          .eq('restaurant_id', rid)
          .eq('status', 'confirmed')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (data && soundOnRef.current) {
          const order = data as unknown as Order
          const tableLabel = order.table_sessions?.tables?.label ||
            `โต๊ะ ${order.table_sessions?.tables?.table_number}`
          playBeep('order')
          setTimeout(() => speak(`ออเดอร์ใหม่ ${tableLabel}`), 300)
          setNewOrderAlert(order)
          setTimeout(() => setNewOrderAlert(null), 5000)
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'payments',
        filter: `restaurant_id=eq.${rid}`,
      }, (payload) => {
        if (payload.new?.status === 'paid' && soundOnRef.current) {
          const amount = payload.new.amount
          playBeep('payment')
          setTimeout(() => speak(`รับเงินแล้ว ${amount.toLocaleString()} บาท`), 300)
        }
      })
      .subscribe()
  }

  async function updateOrderStatus(orderId: string, status: string) {
    await supabase.from('orders').update({ status }).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o))
  }

  async function toggleMenuItem(id: string, current: boolean) {
    await supabase.from('menu_items').update({ is_available: !current }).eq('id', id)
    setMenuItems(prev => prev.map(m => m.id === id ? { ...m, is_available: !current } : m))
  }

  // Receive cash for a single order
  async function receiveCash(order: Order) {
    const total = order.order_items.reduce((s, i) => s + i.price_snapshot * i.quantity, 0)
    const sessionId = order.session_id || order.table_sessions?.id

    // Record payment
    await supabase.from('payments').insert({
      session_id: sessionId,
      restaurant_id: restaurantId,
      method: 'cash',
      scope: 'full',
      amount: total,
      status: 'paid',
      paid_at: new Date().toISOString(),
    })

    // Mark all orders in this session as served
    await supabase
      .from('orders')
      .update({ status: 'served' })
      .eq('session_id', sessionId)

    // CLOSE the session — next customers scanning this table get a NEW session
    await supabase
      .from('table_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId)

    // Remove orders of closed session from UI
    setOrders(prev => prev.filter(o => o.session_id !== sessionId))

    if (soundOnRef.current) {
      playBeep('payment')
      setTimeout(() => speak(`รับเงินแล้ว ${total.toLocaleString()} บาท`), 300)
    }
  }

  // Receive cash for entire table (sum all orders in session)
  async function receiveCashForTable(sessionId: string) {
    const tableOrders = orders.filter(o => o.session_id === sessionId)
    const total = tableOrders.reduce((sum, o) =>
      sum + o.order_items.reduce((s, i) => s + i.price_snapshot * i.quantity, 0), 0)

    await supabase.from('payments').insert({
      session_id: sessionId,
      restaurant_id: restaurantId,
      method: 'cash',
      scope: 'full',
      amount: total,
      status: 'paid',
      paid_at: new Date().toISOString(),
    })

    await supabase
      .from('orders')
      .update({ status: 'served' })
      .eq('session_id', sessionId)

    await supabase
      .from('table_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId)

    setOrders(prev => prev.filter(o => o.session_id !== sessionId))

    if (soundOnRef.current) {
      playBeep('payment')
      setTimeout(() => speak(`รับเงินแล้ว ${total.toLocaleString()} บาท`), 300)
    }
  }

  const tableLabel = (o: Order) =>
    o.table_sessions?.tables?.label || `โต๊ะ ${o.table_sessions?.tables?.table_number}`

  const orderTotal = (o: Order) =>
    o.order_items.reduce((s, i) => s + i.price_snapshot * i.quantity, 0)

  const statusColor: Record<string, string> = {
    confirmed: 'bg-yellow-100 text-yellow-700',
    cooking: 'bg-blue-100 text-blue-700',
    served: 'bg-green-100 text-green-700',
  }

  const statusLabel: Record<string, string> = {
    confirmed: 'รอทำ',
    cooking: 'กำลังทำ',
    served: 'เสิร์ฟแล้ว',
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="animate-spin text-orange-500" size={32} />
    </div>
  )

  const activeOrders = orders.filter(o => ['confirmed', 'cooking'].includes(o.status))
  const servedOrders = orders.filter(o => o.status === 'served')

  // Group orders by session for cashier tab
  const sessionGroups = orders.reduce((acc, o) => {
    const sid = o.session_id
    if (!acc[sid]) acc[sid] = { sessionId: sid, orders: [], label: tableLabel(o) }
    acc[sid].orders.push(o)
    return acc
  }, {} as Record<string, { sessionId: string; orders: Order[]; label: string }>)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">

      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍽️</span>
          <span className="font-bold text-gray-900">ระบบร้านอาหาร</span>
        </div>
        <button
          onClick={() => setSoundOn(s => !s)}
          className={`p-2 rounded-full transition-colors ${soundOn ? 'bg-orange-100 text-orange-500' : 'bg-gray-100 text-gray-400'}`}
          title={soundOn ? 'เสียงเปิดอยู่' : 'เสียงปิดอยู่'}
        >
          {soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </div>

      {newOrderAlert && (
        <div className="bg-orange-500 text-white px-4 py-3 flex items-center gap-3 animate-pulse">
          <Bell size={20} />
          <div>
            <p className="font-bold text-sm">🔔 ออเดอร์ใหม่! {tableLabel(newOrderAlert)}</p>
            <p className="text-xs opacity-90">
              {newOrderAlert.order_items.map(i => `${i.menu_items?.name_th} x${i.quantity}`).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-20">

        {tab === 'orders' && (
          <div className="p-4 space-y-3">
            {activeOrders.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <ChefHat size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">ยังไม่มีออเดอร์</p>
                <p className="text-sm mt-1">รอลูกค้าสแกน QR สั่งอาหารครับ</p>
              </div>
            )}
            {activeOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 text-lg">{tableLabel(order)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[order.status]}`}>
                      {statusLabel[order.status]}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(order.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="px-4 py-2 space-y-1.5">
                  {order.order_items.map(item => (
                    <div key={item.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="bg-orange-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">
                          {item.quantity}
                        </span>
                        <span className="text-sm text-gray-800">{item.menu_items?.name_th}</span>
                        {item.note && <span className="text-xs text-gray-400">({item.note})</span>}
                      </div>
                      <span className="text-sm text-gray-500">฿{(item.price_snapshot * item.quantity).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-2">
                  <span className="font-bold text-gray-900">฿{orderTotal(order).toLocaleString()}</span>
                  <div className="flex gap-2">
                    {order.status === 'confirmed' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'cooking')}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium"
                      >
                        <ChefHat size={15} /> กำลังทำ
                      </button>
                    )}
                    {order.status === 'cooking' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'served')}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium"
                      >
                        <CheckCircle size={15} /> เสิร์ฟแล้ว
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {servedOrders.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 px-1">เสิร์ฟแล้ว ({servedOrders.length})</p>
                {servedOrders.map(order => (
                  <div key={order.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between opacity-60 mb-2">
                    <div>
                      <span className="font-medium text-sm text-gray-700">{tableLabel(order)}</span>
                      <span className="text-xs text-gray-400 ml-2">{order.order_items.length} รายการ</span>
                    </div>
                    <span className="font-bold text-sm text-gray-700">฿{orderTotal(order).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'cashier' && (
          <div className="p-4 space-y-3">
            {Object.keys(sessionGroups).length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">ยังไม่มีรายการรอเก็บเงิน</p>
              </div>
            )}
            {Object.values(sessionGroups).map(group => {
              const sessionTotal = group.orders.reduce((sum, o) =>
                sum + o.order_items.reduce((s, i) => s + i.price_snapshot * i.quantity, 0), 0)
              const allItems = group.orders.flatMap(o => o.order_items)

              return (
                <div key={group.sessionId} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <span className="font-bold text-gray-900 text-lg">{group.label}</span>
                    <span className="text-xs text-gray-400">{group.orders.length} ออเดอร์</span>
                  </div>
                  <div className="px-4 py-2 space-y-1.5">
                    {allItems.map(item => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-gray-700">{item.menu_items?.name_th} x{item.quantity}</span>
                        <span className="text-gray-500">฿{(item.price_snapshot * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">ยอดรวม</p>
                      <p className="font-bold text-xl text-gray-900">฿{sessionTotal.toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => receiveCashForTable(group.sessionId)}
                      className="flex items-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-sm transition-colors"
                    >
                      <DollarSign size={18} /> รับเงินแล้ว
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'menu' && (
          <div className="p-4 space-y-2">
            <p className="text-xs text-gray-400 px-1 mb-3">กดเปิด/ปิดเมนูที่หมดได้เลย</p>
            {menuItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0">
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name_th} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xl">🍽️</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium text-sm ${item.is_available ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                    {item.name_th}
                  </p>
                  <p className="text-xs text-orange-500 font-semibold">฿{item.price.toLocaleString()}</p>
                </div>
                <button
                  onClick={() => toggleMenuItem(item.id, item.is_available)}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${item.is_available ? 'bg-green-500' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${item.is_available ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 flex z-30">
        {[
          { key: 'orders', label: 'ออเดอร์', icon: Bell, badge: activeOrders.length },
          { key: 'cashier', label: 'เก็บเงิน', icon: DollarSign, badge: Object.keys(sessionGroups).length },
          { key: 'menu', label: 'เมนู', icon: UtensilsCrossed, badge: 0 },
        ].map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key as Tab)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors relative ${tab === key ? 'text-orange-500' : 'text-gray-400'}`}
          >
            <div className="relative">
              <Icon size={22} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {badge}
                </span>
              )}
            </div>
            <span className="text-xs font-medium">{label}</span>
            {tab === key && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-orange-500 rounded-full" />}
          </button>
        ))}
      </div>
    </div>
  )
}
