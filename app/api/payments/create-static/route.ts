import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generatePromptPayPayload } from '@/lib/promptpay';

/**
 * Create a static PromptPay payment record.
 * Body: { session_id: string, amount: number }
 * Returns: { payment_id, qr_payload, amount, expires_at, promptpay_name }
 *
 * Note: Uses customer-facing client to verify session ownership,
 * then service client to insert payment (which has RLS).
 */
export async function POST(req: NextRequest) {
  try {
    const { session_id, amount } = await req.json();
    if (!session_id || !amount || amount <= 0) {
      return NextResponse.json({ error: 'session_id and valid amount required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch session + restaurant info
    const { data: sess } = await supabase
      .from('table_sessions')
      .select('id, status, restaurant_id, restaurants ( id, promptpay_id, promptpay_name, payment_mode )')
      .eq('id', session_id)
      .single();

    if (!sess) return NextResponse.json({ error: 'session not found' }, { status: 404 });

    type RestaurantInfo = {
      id: string;
      promptpay_id: string | null;
      promptpay_name: string | null;
      payment_mode: string;
    };
    const restaurant = Array.isArray(sess.restaurants) ? sess.restaurants[0] : sess.restaurants;
    const r = restaurant as RestaurantInfo;

    if (!r) {
      return NextResponse.json({ error: 'restaurant not found' }, { status: 404 });
    }

    if (!['manual', 'sms'].includes(r.payment_mode)) {
      return NextResponse.json({ error: 'payment mode not configured for static QR' }, { status: 400 });
    }

    if (!r.promptpay_id) {
      return NextResponse.json({ error: 'PromptPay ID not configured' }, { status: 400 });
    }

    // Generate QR payload
    let qrPayload: string;
    try {
      qrPayload = generatePromptPayPayload(r.promptpay_id, amount);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      return NextResponse.json({ error: 'Invalid PromptPay ID: ' + err.message }, { status: 400 });
    }

    // Insert payment record using service client (bypasses RLS)
    const service = await createServiceClient();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    const { data: payment, error: insertError } = await service
      .from('payments')
      .insert({
        session_id,
        restaurant_id: r.id,
        amount,
        amount_expected: amount,
        method: 'promptpay_static',
        status: 'pending_confirmation',
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Payment insert error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Update session status to 'paying' so cashier sees it
    await service
      .from('table_sessions')
      .update({ status: 'paying' })
      .eq('id', session_id);

    return NextResponse.json({
      payment_id: payment.id,
      qr_payload: qrPayload,
      amount,
      expires_at: expiresAt,
      promptpay_name: r.promptpay_name,
    });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    console.error('create-static error:', err);
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 });
  }
}
