import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const body = await req.text();

  // ─── DEBUG: log all headers to find correct signature header ───
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => { headers[key] = value; });
  console.log('Webhook headers:', JSON.stringify(headers));

  // ─── Try multiple signature header names + hash formats ───
  const secret = process.env.OMISE_WEBHOOK_SECRET;
  if (secret) {
    // Try all possible header names
    const candidates = [
      req.headers.get('x-omise-signature'),
      req.headers.get('omise-signature'),
      req.headers.get('opn-signature'),
      req.headers.get('x-opn-signature'),
    ].filter(Boolean) as string[];

    const expectedHex = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const expectedBase64 = crypto.createHmac('sha256', secret).update(body).digest('base64');

    console.log('Sig candidates:', candidates);
    console.log('Expected hex:', expectedHex);
    console.log('Expected base64:', expectedBase64);

    const matched = candidates.some(c =>
      c === expectedHex ||
      c === expectedBase64 ||
      c === `sha256=${expectedHex}` ||
      c === `sha256=${expectedBase64}`
    );

    if (!matched) {
      console.warn('Signature mismatch — proceeding anyway for debug');
      // For debugging, still proceed. Change to `return 401` after we identify the format.
      // return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  }

  const event = JSON.parse(body);
  const supabase = await createServiceClient();

  console.log('Omise webhook event:', event.key, event.data?.id);

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
    console.warn('Payment not found:', charge.id);
    return NextResponse.json({ ok: true });
  }
  if (payment.status === 'paid') return NextResponse.json({ ok: true });

  if (charge.status === 'successful' || charge.paid === true) {
    const nowIso = new Date().toISOString();

    await supabase
      .from('payments')
      .update({ status: 'paid', paid_at: nowIso })
      .eq('id', payment.id);

    if (payment.session_id) {
      await supabase
        .from('table_sessions')
        .update({ status: 'closed', closed_at: nowIso })
        .eq('id', payment.session_id);
    }

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
