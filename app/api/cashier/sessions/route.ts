import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function unwrapOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id, role')
    .eq('user_id', user.id)
    .single();
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 });
  if (!['admin', 'cashier'].includes(ru.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('table_sessions')
    .select(`
      id, status, opened_at,
      tables!inner ( id, table_number, label ),
      orders (
        id, status,
        order_items (
          id, quantity, price_snapshot, options_snapshot,
          menu_items ( name_th )
        )
      )
    `)
    .eq('restaurant_id', ru.restaurant_id)
    .in('status', ['open', 'ordering', 'paying'])
    .order('opened_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type OptionSnap = { option_name: string; price_delta: number; quantity?: number };
  type Item = {
    id: string;
    quantity: number;
    price_snapshot: number;
    options_snapshot: OptionSnap[] | null;
    menu_items: { name_th: string } | { name_th: string }[] | null;
  };
  type Order = { id: string; status: string; order_items: Item[] };
  type Row = {
    id: string;
    status: string;
    opened_at: string;
    tables: { id: string; table_number: number; label: string | null } | { id: string; table_number: number; label: string | null }[];
    orders: Order[];
  };

  const sessions = (((data as unknown) as Row[]) ?? []).map((s) => {
    type LineItem = { name: string; qty: number; unit_price: number; subtotal: number; options: string[] };
    const lineItems: LineItem[] = [];
    let total = 0;
    let itemCount = 0;

    const tbl = unwrapOne(s.tables);

    for (const o of s.orders ?? []) {
      if (o.status === 'cancelled') continue;
      for (const it of o.order_items ?? []) {
        const mi = unwrapOne(it.menu_items);
        const name = mi?.name_th ?? '?';
        const base = Number(it.price_snapshot);
        const optDelta = (it.options_snapshot ?? []).reduce(
          (sum, op) => sum + Number(op.price_delta) * (op.quantity ?? 1),
          0
        );
        const unitPrice = base + optDelta;
        const subtotal = unitPrice * it.quantity;
        total += subtotal;
        itemCount += it.quantity;

        const optStrs = (it.options_snapshot ?? []).map(op => {
          const q = op.quantity ?? 1;
          const priceText = op.price_delta !== 0
            ? ` (${op.price_delta > 0 ? '+' : ''}฿${(Number(op.price_delta) * q).toFixed(0)})`
            : '';
          return q > 1 ? `${q}x ${op.option_name}${priceText}` : `${op.option_name}${priceText}`;
        });

        lineItems.push({ name, qty: it.quantity, unit_price: unitPrice, subtotal, options: optStrs });
      }
    }

    return {
      session_id: s.id,
      status: s.status,
      opened_at: s.opened_at,
      table_id: tbl?.id ?? '',
      table_number: tbl?.table_number ?? 0,
      table_label: tbl?.label ?? null,
      total,
      item_count: itemCount,
      items: lineItems,
    };
  });

  sessions.sort((a, b) => {
    if (a.status === 'paying' && b.status !== 'paying') return -1;
    if (b.status === 'paying' && a.status !== 'paying') return 1;
    return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
  });

  return NextResponse.json({ sessions });
}
