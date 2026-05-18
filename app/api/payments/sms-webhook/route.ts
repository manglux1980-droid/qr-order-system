import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * SMS webhook - PRIVACY HARDENED version.
 *
 * - Extracts amount from SMS
 * - Does NOT store account numbers, balance, or full SMS text
 * - Only stores: amount, masked excerpt (for audit)
 * - Response does NOT echo raw SMS text
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

  // 🔒 PRIVACY: Sanitize before logging
  const sanitizedForLog = sanitizeSensitive(smsText);
  console.log(`[SMS Webhook] restaurant=${restaurant.id} sms=${sanitizedForLog}`);

  const extractedAmount = extractCreditAmount(smsText);

  if (!extractedAmount) {
    console.log(`[SMS Webhook] could not extract credit amount`);
    return NextResponse.json({
      ok: false,
      reason: 'no credit amount found',
      // 🔒 Don't echo SMS text in response
    });
  }

  console.log(`[SMS Webhook] extracted amount: ${extractedAmount}`);

  const now = new Date().toISOString();
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount_expected, session_id, expires_at, status')
    .eq('restaurant_id', restaurant.id)
    .eq('status', 'pending_confirmation')
    .gt('expires_at', now)
    .order('created_at', { ascending: false });

  if (!payments || payments.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: 'no pending payments',
      // 🔒 Show extracted amount only — caller may need this
      extracted_amount: extractedAmount,
    });
  }

  const matched = payments.find(p => Math.abs(Number(p.amount_expected) - extractedAmount) < 0.01);

  if (!matched) {
    return NextResponse.json({
      ok: false,
      reason: 'no matching amount',
      extracted_amount: extractedAmount,
      // 🔒 Removed: pending_amounts (could leak data)
    });
  }

  // Mark payment as paid
  // 🔒 PRIVACY: Don't store full SMS text — only store sanitized audit trail
  await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: now,
      sms_matched_text: sanitizedForLog.substring(0, 100),  // 🔒 short + masked
    })
    .eq('id', matched.id);

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
 * 🔒 PRIVACY: Remove sensitive data from SMS text before logging/storing
 *
 * Removes:
 * - Account numbers (X-NNNN, NNN-NNNN-NNNN, etc.)
 * - Balance amounts (after "คงเหลือ" / "balance")
 * - Reference numbers
 */
function sanitizeSensitive(text: string): string {
  return text
    // Mask account number patterns (X-1234, X1234)
    .replace(/[xX]\s*[-]?\s*\d{3,}/g, 'X-****')
    // Mask account numbers like 123-4-56789-0
    .replace(/\d{3}-\d-\d{5}-\d/g, '***-*-*****-*')
    // Remove balance info (คงเหลือ/balance + number)
    .replace(/คงเหลือ[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*[บ\.]*/g, 'คงเหลือ ***')
    .replace(/ยอดคงเหลือ[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g, 'ยอดคงเหลือ ***')
    .replace(/balance[\s:]*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gi, 'balance ***')
    // Remove reference numbers (Ref:XXXX)
    .replace(/[Rr]ef[.:]?\s*\w+/g, 'Ref:***')
    // Truncate to 100 chars max
    .substring(0, 100);
}

/**
 * Extract credit amount from Thai/English bank SMS.
 */
function extractCreditAmount(text: string): number | null {
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

  for (const keyword of creditKeywords) {
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

  const fallbackPatterns = [
    /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*บาท/,
    /฿\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/,
    /THB\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*THB/i,
  ];

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
    message: 'SMS webhook is active',
  });
}
