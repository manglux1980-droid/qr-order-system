import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Cashier manually confirms payment.
 * Body: { payment_id: string }
 */
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

  const { payment_id } = await req.json();
  if (!payment_id) {
    return NextResponse.json({ error: 'payment_id required' }, { status: 400 });
  }

  // Verify payment belongs to this restaurant
  const { data: payment } = await supabase
    .from('payments')
    .select('id, session_id, restaurant_id, status, amount')
    .eq('id', payment_id)
    .single();

  if (!payment) return NextResponse.json({ error: 'payment not found' }, { status: 404 });
  if (payment.restaurant_id !== ru.restaurant_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (payment.status === 'paid') {
    return NextResponse.json({ error: 'already paid' }, { status: 400 });
  }

  // Mark payment as paid
  const { error: payError } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      confirmed_by_user_id: user.id,
    })
    .eq('id', payment_id);

  if (payError) {
    return NextResponse.json({ error: payError.message }, { status: 500 });
  }

  // Close session
  const { error: sessError } = await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
    })
    .eq('id', payment.session_id);

  if (sessError) {
    return NextResponse.json({ error: sessError.message }, { status: 500 });
  }

  console.log(`Payment ${payment_id} confirmed by user ${user.id}, session ${payment.session_id} closed`);

  return NextResponse.json({ ok: true });
}
