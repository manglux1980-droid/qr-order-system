import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const body = await req.text();

  // ─── Omise signature verification (header is "x-omise-signature") ───
  const secret = process.env.OMISE_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get('x-omise-signature') || '';
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature !== expected) {
      console.warn('Omise webhook signature mismatch', { got: signature, expected });
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  const event = JSON.parse(body);
  const supabase = await createServiceClient();

  console.log('Omise webhook received:', event.key, event.data?.id);

  if (event.key !== 'charge.complete' && event.key !== 'charge.update') {
    return NextResponse.json({ ok: true });
  }

  const charge = event.data;
  if (!charge?.id) return NextResponse.json({ ok: true });

  const { data: payment } = await supabase
    .from('payments')
    .select('id, status, session_id, restaurant_id')
    .eq('omise_charge_id', charge.id)
    .single();

  if (!payment) {
    console.warn('Payment not found for charge:', charge.id);
    return NextResponse.json({ ok: true });
  }
  if (payment.status === 'paid') return NextResponse.json({ ok: true });

  if (charge.status === 'successful' || charge.paid === true) {
    const nowIso = new Date().toISOString();

    await supabase
      .from('payments')
      .update({ status: 'paid', paid_at: nowIso })
      .eq('id', payment.id);

    // Dine-in: close session
    if (payment.session_id) {
      await supabase
        .from('table_sessions')
        .update({ status: 'closed', closed_at: nowIso })
        .eq('id', payment.session_id);
    }

    // Pre-order: confirm order
    const orderId = charge.metadata?.order_id;
    const orderType = charge.metadata?.order_type;
    if (orderType === 'preorder' && orderId) {
      await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', orderId);
    }

    console.log('Payment marked paid:', payment.id);
  } else if (charge.status === 'failed' || charge.status === 'expired') {
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', payment.id);
  }

  return NextResponse.json({ ok: true });
}
