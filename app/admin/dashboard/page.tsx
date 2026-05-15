'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type TopItem = {
  name: string;
  qty: number;
  revenue: number;
};

type Stats = {
  revenue_today: number;
  order_count_today: number;
  paid_session_count: number;
  avg_per_order: number;
  top_items: TopItem[];
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const now = new Date();
      const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startIso = startLocal.toISOString();

      // 1. Revenue today
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('status', 'paid')
        .gte('paid_at', startIso);

      const revenue_today = (payments ?? []).reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const paid_session_count = payments?.length ?? 0;

      // 2. Order count today
      const { count: order_count_today } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startIso);

      // 3. Top items today
      const { data: items } = await supabase
        .from('order_items')
        .select(`
          quantity, price_snapshot,
          menu_items!inner ( name_th ),
          orders!inner ( created_at, status )
        `)
        .gte('orders.created_at', startIso)
        .neq('orders.status', 'cancelled');

      type ItemRow = {
        quantity: number;
        price_snapshot: number;
        menu_items: { name_th: string } | { name_th: string }[] | null;
      };

      const acc = new Map<string, TopItem>();
      for (const it of ((items as unknown) as ItemRow[]) ?? []) {
        // menu_items can be returned as either object or array depending on Supabase typing
        const mi = Array.isArray(it.menu_items) ? it.menu_items[0] : it.menu_items;
        const name = mi?.name_th ?? '?';
        const prev = acc.get(name) ?? { name, qty: 0, revenue: 0 };
        prev.qty += it.quantity;
        prev.revenue += it.quantity * Number(it.price_snapshot);
        acc.set(name, prev);
      }
      const top_items = Array.from(acc.values())
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

      setStats({
        revenue_today,
        order_count_today: order_count_today ?? 0,
        paid_session_count,
        avg_per_order: paid_session_count > 0 ? revenue_today / paid_session_count : 0,
        top_items,
      });
      setLoading(false);
    })();
  }, [supabase]);

  if (loading) return <div className="p-6 text-gray-900">กำลังโหลด...</div>;
  if (!stats) return <div className="p-6 text-gray-900">โหลดข้อมูลไม่สำเร็จ</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">ภาพรวม — วันนี้</h1>
        <div className="text-sm text-gray-600">
          {new Date().toLocaleDateString('th-TH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="ยอดขายวันนี้"
          value={`฿${stats.revenue_today.toLocaleString('th-TH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          icon="💰"
          color="green"
        />
        <StatCard
          label="ออเดอร์วันนี้"
          value={stats.order_count_today.toString()}
          icon="📋"
          color="blue"
        />
        <StatCard
          label="บิลที่จ่ายแล้ว"
          value={stats.paid_session_count.toString()}
          icon="✅"
          color="purple"
        />
        <StatCard
          label="ค่าเฉลี่ย/บิล"
          value={`฿${stats.avg_per_order.toLocaleString('th-TH', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`}
          icon="📊"
          color="orange"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="font-semibold text-gray-900">🔥 เมนูขายดีวันนี้ (Top 5)</h2>
        </div>

        {stats.top_items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">ยังไม่มีข้อมูลวันนี้</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {stats.top_items.map((item, idx) => (
              <li key={item.name} className="px-5 py-3 flex items-center gap-4">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${
                    idx === 0
                      ? 'bg-yellow-500'
                      : idx === 1
                      ? 'bg-gray-400'
                      : idx === 2
                      ? 'bg-orange-400'
                      : 'bg-gray-300'
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-sm text-gray-500">ขายไป {item.qty} จาน</div>
                </div>
                <div className="font-semibold text-gray-900">
                  ฿{item.revenue.toLocaleString('th-TH', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-4">
        💡 ข้อมูลคำนวณตามวันที่ปัจจุบัน (เริ่ม 00:00) · รีเฟรชหน้าเพื่อดูข้อมูลล่าสุด
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: string;
  color: 'green' | 'blue' | 'purple' | 'orange';
}) {
  const colorMap = {
    green: 'border-green-200 bg-green-50',
    blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50',
    orange: 'border-orange-200 bg-orange-50',
  };
  return (
    <div className={`border-2 rounded-xl p-4 ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-2xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
