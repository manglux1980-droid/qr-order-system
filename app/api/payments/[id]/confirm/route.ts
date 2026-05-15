import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/payments/[id]/confirm
// Cashier-only. Marks payment paid + closes session.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // Auth — must be staff (admin or cashier)
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

  // Fetch payment
  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .select('id, session_id, restaurant_id, status, method, amount')
    .eq('id', id)
    .single();

  if (pErr || !payment) {
    return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  }

  // Must belong to staff's restaurant
  if (payment.restaurant_id !== ru.restaurant_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Only confirm pending cash
  if (payment.status !== 'pending') {
    return NextResponse.json(
      { error: `ไม่สามารถยืนยันได้ (status=${payment.status})` },
      { status: 400 }
    );
  }
  if (payment.method !== 'cash') {
    return NextResponse.json(
      { error: 'การชำระประเภทนี้ยืนยันอัตโนมัติผ่าน webhook' },
      { status: 400 }
    );
  }

  // Mark paid
  const { error: uErr } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Close session
  await supabase
    .from('table_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', payment.session_id);

  return NextResponse.json({ ok: true, amount: payment.amount });
}
