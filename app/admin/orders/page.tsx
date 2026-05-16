'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

type OptionSnap = {
  group_name: string;
  option_name: string;
  price_delta: number;
  quantity?: number;
};

type OrderItem = {
  id: string;
  quantity: number;
  name_th: string;
  note: string | null;
  options: OptionSnap[];
};

type KdsOrder = {
  id: string;
  created_at: string;
  status: string;
  table_number: number | null;
  order_type: 'dine_in' | 'preorder';
  pickup_code: string | null;
  customer_name: string | null;
  items: OrderItem[];
};

type RawItem = {
  id: string;
  quantity: number;
  note: string | null;
  options_snapshot: OptionSnap[] | null;
  menu_items: { name_th: string } | { name_th: string }[] | null;
};

type RawOrder = {
  id: string;
  created_at: string;
  status: string;
  order_type: 'dine_in' | 'preorder';
  pickup_code: string | null;
  customer_name: string | null;
  order_items: RawItem[];
  table_sessions:
    | { tables: { table_number: number } | { table_number: number }[] | null }
    | { tables: { table_number: number } | { table_number: number }[] | null }[]
    | null;
};

function unwrapOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default function OrdersKdsPage() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'dine_in' | 'preorder'>('all');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const ordersRef = useRef<KdsOrder[]>([]);

  const supabase = createClient();

  // Keep ref in sync with state
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // Unlock audio on first user gesture
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      if (!audioCtxRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current!;
      if (ctx.state === 'suspended') ctx.resume();

      const u = new SpeechSynthesisUtterance('');
      speechSynthesis.speak(u);

      audioUnlockedRef.current = true;
    } catch (e) {
      console.warn('Audio unlock failed:', e);
    }
  }, []);

  useEffect(() => {
    const handler = () => unlockAudio();
    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [unlockAudio]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select(`
        id, created_at, status, order_type, pickup_code, customer_name,
        order_items (
          id, quantity, note, options_snapshot,
          menu_items ( name_th )
        ),
        table_sessions (
          tables ( table_number )
        )
      `)
      .in('status', ['pending', 'confirmed', 'cooking'])
      .order('created_at', { ascending: true });

    const rows: KdsOrder[] = (((data as unknown) as RawOrder[]) ?? [])
      .filter((o) => (o.order_items?.length ?? 0) > 0)
      .map((o) => {
        const sess = unwrapOne(o.table_sessions);
        const tbl = sess ? unwrapOne(sess.tables) : null;
        return {
          id: o.id,
          created_at: o.created_at,
          status: o.status,
          order_type: o.order_type ?? 'dine_in',
          pickup_code: o.pickup_code,
          customer_name: o.customer_name,
          table_number: tbl?.table_number ?? null,
          items: (o.order_items ?? []).map((it) => {
            const mi = unwrapOne(it.menu_items);
            return {
              id: it.id,
              quantity: it.quantity,
              note: it.note,
              name_th: mi?.name_th ?? '?',
              options: it.options_snapshot ?? [],
            };
          }),
        };
      });

    setOrders(rows);
    setLoading(false);
  }, [supabase]);

  function playDing(orderId?: string) {
    if (!audioUnlockedRef.current) {
      console.warn('Audio not unlocked yet');
      return;
    }
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      // Ding sound
      [600, 900].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.18 + 0.2);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.2);
      });

      // Verbose speech with table + items
      setTimeout(() => {
        try {
          speechSynthesis.cancel();
          const order = ordersRef.current.find(o => o.id === orderId);
          let text = 'ออเดอร์ใหม่';
          if (order) {
            if (order.order_type === 'preorder') {
              text = `สั่งล่วงหน้า รหัส ${order.pickup_code ?? ''}`;
            } else if (order.table_number) {
              text = `ออเดอร์ใหม่ โต๊ะ ${order.table_number}`;
            }
            // Add first 2 items
            const itemNames = order.items.slice(0, 2).map(it =>
              it.quantity > 1 ? `${it.name_th} ${it.quantity} ที่` : it.name_th
            );
            if (itemNames.length > 0) {
              text += ' ' + itemNames.join(' ');
              if (order.items.length > 2) text += ' และอื่นๆ';
            }
          }
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'th-TH';
          u.rate = 1.0;
          u.volume = 1.0;
          speechSynthesis.speak(u);
        } catch (e) {
          console.warn('Speech failed:', e);
        }
      }, 400);
    } catch (e) {
      console.warn('playDing failed:', e);
    }
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel('kds-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (
          payload.eventType === 'UPDATE' &&
          (payload.new as { status?: string }).status === 'confirmed' &&
          (payload.old as { status?: string }).status !== 'confirmed' &&
          soundOn
        ) {
          const orderId = (payload.new as { id: string }).id;
          // Load first, then play (so we have updated data)
          load().then(() => {
            setTimeout(() => playDing(orderId), 200);
          });
          return;
        }
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, supabase, soundOn]);

  async function markServed(orderId: string) {
    setUpdating(orderId);
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, status: 'served' }),
    });
    setUpdating(null);
    if (!res.ok) {
      const json = await res.json();
      alert(json.error || 'อัปเดตไม่สำเร็จ');
      return;
    }
    load();
  }

  function elapsed(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  }

  function urgencyClass(iso: string) {
    const mins = (Date.now() - new Date(iso).getTime()) / 60000;
    if (mins >= 10) return 'border-red-500 bg-red-50';
    if (mins >= 5) return 'border-orange-400 bg-orange-50';
    return 'border-gray-300 bg-white';
  }

  const filtered = orders.filter(o =>
    filter === 'all' ? true : o.order_type === filter
  );
  const dineInCount = orders.filter(o => o.order_type === 'dine_in').length;
  const preorderCount = orders.filter(o => o.order_type === 'preorder').length;

  return (
    <div className="p-6 max-w-7xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">ออเดอร์ (KDS)</h1>
        <button
          onClick={() => {
            setSoundOn((s) => !s);
            unlockAudio();
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      {!audioUnlockedRef.current && soundOn && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          👆 คลิกที่ใดก็ได้บนหน้านี้ครั้งแรกเพื่อเปิดใช้งานเสียง (กฎของ browser)
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-lg text-sm font-medium ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300'}`}>
          ทั้งหมด ({orders.length})
        </button>
        <button onClick={() => setFilter('dine_in')} className={`px-4 py-2 rounded-lg text-sm font-medium ${filter === 'dine_in' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300'}`}>
          🍽️ กินที่ร้าน ({dineInCount})
        </button>
        <button onClick={() => setFilter('preorder')} className={`px-4 py-2 rounded-lg text-sm font-medium ${filter === 'preorder' ? 'bg-orange-600 text-white' : 'bg-white border border-gray-300'}`}>
          🥡 สั่งล่วงหน้า ({preorderCount})
        </button>
      </div>

      {loading && <div className="text-gray-600">กำลังโหลด...</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">👨‍🍳</div>
          <p className="text-gray-700 font-medium">ไม่มีออเดอร์ที่รอทำ</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((o) => (
          <div key={o.id} className={`border-2 rounded-xl p-4 shadow-sm ${urgencyClass(o.created_at)}`}>
            <div className="flex items-center justify-between mb-3">
              {o.order_type === 'preorder' ? (
                <div className="bg-orange-500 text-white font-bold rounded-lg px-3 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider">🥡 Pre-order</div>
                  <div className="text-xl leading-none">{o.pickup_code}</div>
                </div>
              ) : (
                <div className="bg-gray-900 text-white font-bold rounded-lg px-3 py-1.5 text-lg">
                  โต๊ะ #{o.table_number ?? '?'}
                </div>
              )}
              <div className="text-sm text-gray-700 font-medium">
                ⏱ {elapsed(o.created_at)}
              </div>
            </div>

            {o.order_type === 'preorder' && o.customer_name && (
              <p className="text-xs text-gray-600 mb-2">👤 {o.customer_name}</p>
            )}

            <ul className="space-y-2 mb-4">
              {o.items.map((it) => (
                <li key={it.id} className="border-l-4 border-gray-300 pl-2">
                  <div className="flex gap-2">
                    <span className="bg-gray-200 text-gray-900 font-bold rounded px-2 py-0.5 text-sm">×{it.quantity}</span>
                    <div className="flex-1">
                      <div className="text-gray-900 font-medium">{it.name_th}</div>
                      {it.options.map((opt, idx) => (
                        <div key={idx} className="text-xs text-gray-600 ml-1">
                          - {opt.quantity && opt.quantity > 1 ? `${opt.quantity}x ` : ''}{opt.option_name}
                        </div>
                      ))}
                      {it.note && <div className="text-xs text-orange-700 mt-0.5">📝 {it.note}</div>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <button
              onClick={() => markServed(o.id)}
              disabled={updating === o.id}
              className="w-full py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {updating === o.id ? 'กำลังบันทึก...' : '✓ ทำเสร็จแล้ว'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
