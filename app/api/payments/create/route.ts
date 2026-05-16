import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { omise } from '@/lib/omise';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const body = await req.json();
  const { session_id, method, amount } = body;

  if (!session_id || !method || !amount) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  if (method === 'cash') {
    return NextResponse.json(
      { error: 'การชำระด้วยเงินสดจัดการผ่านแคชเชียร์' },
      { status: 400 }
    );
  }

  const { data: session, error: sErr } = await supabase
    .from('table_sessions')
    .select('id, restaurant_id, status, table_id')
    .eq('id', session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  if (session.status === 'closed') {
    return NextResponse.json({ error: 'session already closed' }, { status: 400 });
  }

  const { data: existingPending } = await supabase
    .from('payments')
    .select('id')
    .eq('session_id', session_id)
    .eq('status', 'pending')
    .neq('method', 'cash')
    .maybeSingle();

  if (existingPending) {
    return NextResponse.json(
      { error: 'มีการชำระเงินที่รอดำเนินการอยู่แล้ว', payment_id: existingPending.id },
      { status: 409 }
    );
  }

  try {
    const amountSatang = Math.round(amount * 100);
    const sourceType = method === 'promptpay' ? 'promptpay' : method;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source: any = await (omise as any).sources.create({
      type: sourceType,
      amount: amountSatang,
      currency: 'thb',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge: any = await omise.charges.create({
      amount: amountSatang,
      currency: 'thb',
      source: source.id,
      metadata: { session_id, restaurant_id: session.restaurant_id },
    });

    const qrUrl =
      source.scannable_code?.image?.download_uri ??
      charge.source?.scannable_code?.image?.download_uri ??
      null;

    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        session_id,
        restaurant_id: session.restaurant_id,
        method,
        amount,
        status: 'pending',
        gateway_ref: charge.id,
        qr_image_url: qrUrl,
      })
      .select()
      .single();

    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    return NextResponse.json({
      payment,
      charge_id: charge.id,
      qr_code: qrUrl,
    });
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    const msg = e?.message || e?.error?.message || 'omise error';
    console.error('Omise error:', JSON.stringify(e, null, 2));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
