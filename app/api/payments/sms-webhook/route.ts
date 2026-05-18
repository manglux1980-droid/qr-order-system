import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * SMS webhook - receives forwarded SMS, extracts amount, matches pending payment.
 *
 * Smart parser handles Thai bank SMS variants:
 * - KBank: "18/05/69 21:31 บช X-4439 เงินเข้า 20.00 คงเหลือ 4,586.74 บ."
 * - K+:    "K+ เงินเข้า 250.00 บาท"
 * - SCB:   "SCB ได้รับเงินโอน THB 60.00"
 * - BBL:   "Bualuang เงินเข้า ฿60"
 * - KTB:   "เครดิตเงินเข้า 100.00"
 *
 * Strategy: Find amount that comes AFTER a credit keyword
 * (เงินเข้า, เครดิต, รับ, credit, receive, deposit)
 * NOT after "คงเหลือ" (balance) or "ยอด" (total balance)
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'secret required' }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, payment_mode')
    .eq('sms_webhook_secret', secret)
    .single();

  if (!restaurant) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  // Parse SMS body
  let smsText = '';
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      smsText = body.text || body.message || body.body || body.sms || body.content || JSON.stringify(body);
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      smsText = (formData.get('text') || formData.get('message') || formData.get('body') || '') as string;
    } else {
      smsText = await req.text();
    }
  } catch {
    smsText = await req.text();
  }

  if (!smsText) {
    return NextResponse.json({ error: 'no SMS text found' }, { status: 400 });
  }

  console.log(`[SMS Webhook] restaurant=${restaurant.id} text=${smsText.substring(0, 200)}`);

  const extractedAmount = extractCreditAmount(smsText);

  if (!extractedAmount) {
    console.log(`[SMS Webhook] could not extract credit amount from: ${smsText}`);
    return NextResponse.json({
      ok: false,
      reason: 'no credit amount found in SMS',
      received_text: smsText.substring(0, 200),
    });
  }

  console.log(`[SMS Webhook] extracted amount: ${extractedAmount}`);

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

  // Find match (exact amount)
  const matched = payments.find(p => Math.abs(Number(p.amount_expected) - extractedAmount) < 0.01);

  if (!matched) {
    console.log(`[SMS Webhook] no match for ${extractedAmount}. Available:`, payments.map(p => p.amount_expected));
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

/**
 * Extract credit amount from Thai/English bank SMS.
 * Returns null if no credit amount found.
 *
 * Strategy:
 * 1. Look for amount after credit keywords (เงินเข้า, เครดิต, รับ, credit, etc.)
 * 2. Skip amounts after balance keywords (คงเหลือ, ยอดคงเหลือ, balance)
 * 3. Fall back to first amount in message if no keywords found
 */
function extractCreditAmount(text: string): number | null {
  // Credit keywords (sorted by specificity - longer first)
  const creditKeywords = [
    'เครดิตเงินเข้า',
    'เงินโอนเข้า',
    'เงินเข้าบัญชี',
    'รับเงินโอน',
    'เงินเข้า',
    'เครดิต',
    'received',
    'credit',
    'deposit',
    'receive',
    'incoming',
  ];

  // Try to find amount AFTER a credit keyword
  for (const keyword of creditKeywords) {
    // Pattern: <keyword> ... <amount> (within 50 chars)
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `${escapedKeyword}[\\s:.]*[A-Za-z฿]*\\s*(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{1,2})?)`,
      'i'
    );
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) {
        return amount;
      }
    }
  }

  // Fallback: try common patterns (amount + currency unit)
  const fallbackPatterns = [
    /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*บาท/,
    /฿\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
    /THB\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*THB/i,
  ];

  // BUT first remove "คงเหลือ ..." part to avoid matching balance
  const cleanedText = text
    .replace(/คงเหลือ[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*[บ\.]*/g, '')
    .replace(/ยอดคงเหลือ[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g, '')
    .replace(/balance[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gi, '');

  for (const pattern of fallbackPatterns) {
    const match = cleanedText.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }

  return null;
}

// GET for testing connectivity
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
