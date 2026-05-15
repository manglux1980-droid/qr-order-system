import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// POST /api/payments/webhook
// Omise sends payment status updates here
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('omise-signature') || '';

  // Verify signature
  const secret = process.env.OMISE_WEBHOOK_SECRET;
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature !== expected) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  const event = JSON.parse(body);
  const supabase = await createServiceClient();

  // Only handle charge.complete or charge.update
  if (event.key !== 'charge.complete' && event.key !== 'charge.update') {
    return NextResponse.json({ ok: true });
  }

  const charge = event.data;
  if (!charge?.id) return NextResponse.json({ ok: true });

  // Find payment by Omise charge ID
  const { data: payment } = await supabase
    .from('payments')
    .select('id, status, session_id, restaurant_id')
    .eq('omise_charge_id', charge.id)
    .single();

  if (!payment) return NextResponse.json({ ok: true });
  if (payment.status === 'paid') return NextResponse.json({ ok: true });

  if (charge.status === 'successful' || charge.paid === true) {
    const nowIso = new Date().toISOString();

    // Mark payment paid
    await supabase
      .from('payments')
      .update({ status: 'paid', paid_at: nowIso })
      .eq('id', payment.id);

    // ─── Dine-in: close session ───
    if (payment.session_id) {
      await supabase
        .from('table_sessions')
        .update({ status: 'closed', closed_at: nowIso })
        .eq('id', payment.session_id);
    }

    // ─── Pre-order: confirm order (move to confirmed so it shows in KDS) ───
    const orderId = charge.metadata?.order_id;
    const orderType = charge.metadata?.order_type;
    if (orderType === 'preorder' && orderId) {
      await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', orderId);
    }
  } else if (charge.status === 'failed' || charge.status === 'expired') {
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', payment.id);
  }

  return NextResponse.json({ ok: true });
}
