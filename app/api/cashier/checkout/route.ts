import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/cashier/checkout
// body: { session_id, amount, method? }  (method defaults to 'cash')
export async function POST(req: NextRequest) {
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

  const { session_id, amount, method = 'cash' } = await req.json();
  if (!session_id || amount == null) {
    return NextResponse.json({ error: 'session_id + amount required' }, { status: 400 });
  }

  // Verify session belongs to this restaurant + not closed
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, restaurant_id, status')
    .eq('id', session_id)
    .single();

  if (!session || session.restaurant_id !== ru.restaurant_id) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  if (session.status === 'closed') {
    return NextResponse.json({ error: 'session already closed' }, { status: 400 });
  }

  // Insert paid payment record
  const nowIso = new Date().toISOString();
  const { error: pErr } = await supabase
    .from('payments')
    .insert({
      session_id,
      restaurant_id: ru.restaurant_id,
      method,
      amount,
      status: 'paid',
      confirmed_by: user.id,
      confirmed_at: nowIso,
      paid_at: nowIso,
    });

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // Close session
  await supabase
    .from('table_sessions')
    .update({ status: 'closed', closed_at: nowIso })
    .eq('id', session_id);

  return NextResponse.json({ ok: true, amount });
}
