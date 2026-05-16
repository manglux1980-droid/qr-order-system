import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

/**
 * Omise webhook signature verification.
 *
 * Reference: https://docs.omise.co/api-webhooks
 *
 * Omise sends:
 *   Omise-Signature: <hex sig>[,<hex sig>]   (comma-separated during secret rotation)
 *   Omise-Signature-Timestamp: <unix timestamp>
 *
 * The webhook secret is base64-encoded and MUST be decoded to raw bytes
 * before being used as the HMAC key.
 *
 * Signed payload = `${timestamp}.${rawBody}`
 */
export async function POST(req: NextRequest) {
  const body = await req.text();

  const secretEnv = process.env.OMISE_WEBHOOK_SECRET;
  if (secretEnv) {
    const signatureHeader = req.headers.get('omise-signature') || '';
    const timestamp = req.headers.get('omise-signature-timestamp') || '';

    if (!signatureHeader || !timestamp) {
      console.warn('Missing Omise signature headers');
      return NextResponse.json({ error: 'missing signature' }, { status: 401 });
    }

    // Decode base64-encoded webhook secret to raw bytes
    const secret = Buffer.from(secretEnv, 'base64');

    // Build signed payload: "timestamp.body"
    const signedPayload = `${timestamp}.${body}`;

    // Compute expected signature as hex
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Omise-Signature header may contain multiple comma-separated signatures
    // during secret rotation. Match against any of them.
    const receivedSignatures = signatureHeader.split(',').map(s => s.trim());

    const matched = receivedSignatures.some(sig => {
      try {
        const a = Buffer.from(sig, 'hex');
        const b = Buffer.from(expected, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        return false;
      }
    });

    if (!matched) {
      console.warn('Omise signature mismatch', { received: signatureHeader, expected });
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }

    // Reject very old timestamps (prevent replay attacks)
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
