import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * SMS webhook endpoint - receives forwarded SMS from phone.
 *
 * Authentication: ?secret=<restaurant.sms_webhook_secret>
 * Body: { text: "SMS body text" } or { message: "..." } or raw body
 *
 * Parses Thai bank notification SMS to extract amount and match with pending payment.
 *
 * Supports common patterns:
 * - "K+ มียอดเข้า 250.00 บาท"
 * - "SCB เงินเข้า 250.00 จาก..."
 * - "BBL เงินโอนเข้า 250 บาท"
 * - "KTB เครดิตเงินเข้า 250"
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'secret required' }, { status: 401 });
  }

  const supabase = await createServiceClient();

  // Find restaurant by webhook secret
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, payment_mode')
    .eq('sms_webhook_secret', secret)
    .single();

  if (!restaurant) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  // Parse SMS text from various possible body shapes
  let smsText = '';
  try {
    // Try JSON body first
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      smsText = body.text || body.message || body.body || body.sms || body.content || JSON.stringify(body);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      smsText = (formData.get('text') || formData.get('message') || formData.get('body') || '') as string;
    } else {
      // Raw text
      smsText = await req.text();
    }
  } catch {
    smsText = await req.text();
  }

  if (!smsText) {
    return NextResponse.json({ error: 'no SMS text found' }, { status: 400 });
  }

  console.log(`[SMS Webhook] restaurant=${restaurant.id} text=${smsText.substring(0, 200)}`);

  // Extract amount from SMS — match patterns like "250.00 บาท" or "250 บาท" or "฿250.00"
  // Try common patterns
  const patterns = [
    /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*บาท/,  // 250.00 บาท
    /฿\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,    // ฿250.00
    /THB\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i, // THB 250.00
    /(\d+(?:\.\d{1,2})?)\s*THB/i,                 // 250.00 THB
  ];

  let extractedAmount: number | null = null;
  for (const pattern of patterns) {
    const match = smsText.match(pattern);
    if (match) {
      extractedAmount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(extractedAmount) && extractedAmount > 0) break;
      extractedAmount = null;
    }
  }

  if (!extractedAmount) {
    console.log(`[SMS Webhook] could not extract amount from: ${smsText}`);
    return NextResponse.json({
      ok: false,
      reason: 'no amount found in SMS',
      received_text: smsText.substring(0, 100),
    });
  }

  // Find pending payment with matching amount within expires_at
  const now = new Date().toISOString();
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount_expected, session_id, expires_at, status')
    .eq('restaurant_id', restaurant.id)
    .eq('status', 'pending_confirmation')
    .gt('expires_at', now)
    .order('created_at', { ascending: false });

  if (!payments || payments.length === 0) {
    console.log(`[SMS Webhook] no pending payments for restaurant ${restaurant.id}`);
    return NextResponse.json({
      ok: false,
      reason: 'no pending payments',
      extracted_amount: extractedAmount,
    });
  }

  // Find best match (exact amount, most recent)
  const matched = payments.find(p => Math.abs(Number(p.amount_expected) - extractedAmount) < 0.01);

  if (!matched) {
    console.log(`[SMS Webhook] no payment matching amount ${extractedAmount}. Available:`, payments.map(p => p.amount_expected));
    return NextResponse.json({
      ok: false,
      reason: 'no matching amount',
      extracted_amount: extractedAmount,
      pending_amounts: payments.map(p => p.amount_expected),
    });
  }

  // Mark payment as paid
  await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: now,
      sms_matched_text: smsText.substring(0, 500),
    })
    .eq('id', matched.id);

  // Close session
  await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: now,
    })
    .eq('id', matched.session_id);

  console.log(`[SMS Webhook] ✓ Auto-confirmed payment ${matched.id} (฿${extractedAmount})`);

  return NextResponse.json({
    ok: true,
    payment_id: matched.id,
    amount: extractedAmount,
  });
}

// Also support GET for testing
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'secret required' }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, name_th')
    .eq('sms_webhook_secret', secret)
    .single();

  if (!restaurant) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: 'SMS webhook is active. POST SMS body here.',
    restaurant_id: restaurant.id,
  });
}
