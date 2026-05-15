import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/payments/[id]/cancel
// Either: cashier from admin side, OR customer (with matching session_id in body)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const body = await req.json().catch(() => ({}));
  const customerSessionId: string | undefined = body.session_id;

  // Fetch payment first
  const { data: payment } = await supabase
    .from('payments')
    .select('id, session_id, restaurant_id, status, method')
    .eq('id', id)
    .single();

  if (!payment) return NextResponse.json({ error: 'payment not found' }, { status: 404 });

  if (payment.status !== 'pending') {
    return NextResponse.json(
      { error: `ไม่สามารถยกเลิกได้ (status=${payment.status})` },
      { status: 400 }
    );
  }

  // Authorization: either staff of this restaurant OR customer with matching session
  const { data: { user } } = await supabase.auth.getUser();
  let authorized = false;

  if (user) {
    const { data: ru } = await supabase
      .from('restaurant_users')
      .select('restaurant_id, role')
      .eq('user_id', user.id)
      .single();
    if (ru && ru.restaurant_id === payment.restaurant_id) authorized = true;
  }

  // Customer path — must provide matching session_id
  if (!authorized && customerSessionId && customerSessionId === payment.session_id) {
    authorized = true;
  }

  if (!authorized) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Only cash payments can be cancelled this way; Omise pending should be voided differently
  if (payment.method !== 'cash') {
    return NextResponse.json(
      { error: 'การชำระประเภทนี้ยกเลิกไม่ได้จากที่นี่' },
      { status: 400 }
    );
  }

  // Mark cancelled
  const { error } = await supabase
    .from('payments')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reopen session back to 'ordering' so customer can pick a different method or add more
  await supabase
    .from('table_sessions')
    .update({ status: 'ordering' })
    .eq('id', payment.session_id)
    .eq('status', 'paying'); // only if still in paying state

  return NextResponse.json({ ok: true });
}
