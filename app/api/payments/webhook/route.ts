import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const body = await req.text();

  // ─── Omise signature verification ───
  // Omise sends:
  //   omise-signature: <hex hmac-sha256>
  //   omise-signature-timestamp: <unix timestamp>
  // Signed payload = `${timestamp}.${body}`
  const secret = process.env.OMISE_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get('omise-signature') || '';
    const timestamp = req.headers.get('omise-signature-timestamp') || '';

    if (!signature || !timestamp) {
      console.warn('Missing Omise signature headers');
      return NextResponse.json({ error: 'missing signature' }, { status: 401 });
    }

    // Try multiple signing schemes Omise might use
    const candidates: string[] = [
      // Most likely: timestamp.body
      crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'),
      // Fallback: body only
      crypto.createHmac('sha256', secret).update(body).digest('hex'),
      // Fallback: timestamp + body (no separator)
      crypto.createHmac('sha256', secret).update(`${timestamp}${body}`).digest('hex'),
    ];

    const matched = candidates.includes(signature);

    if (!matched) {
      console.warn('Signature mismatch', {
        received: signature,
        expected: candidates,
        timestamp,
      });
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }

    // Optionally reject very old timestamps (prevent replay)
    const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (Number.isFinite(ageSeconds) && ageSeconds > 300) {
      console.warn('Webhook timestamp too old', { ageSeconds });
      return NextResponse.json({ error: 'timestamp too old' }, { status: 401 });
    }
  }

  const event = JSON.parse(body);
  const supabase = await createServiceClient();

  if (event.key !== 'charge.complete' && event.key !== 'charge.update') {
    return NextResponse.json({ ok: true });
  }

  const charge = event.data;
  if (!charge?.id) return NextResponse.json({ ok: true });

  const { data: payment } = await supabase
    .from('payments')
    .select('id, status, session_id, restaurant_id')
    .eq('gateway_ref', charge.id)
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
