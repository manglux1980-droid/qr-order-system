import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { omise } from '@/lib/omise';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { preorder_qr_token, customer_name, customer_phone, items } = body;

  if (!preorder_qr_token || !items?.length) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data: qr } = await supabase
    .from('preorder_qr')
    .select('id, restaurant_id, is_active')
    .eq('qr_token', preorder_qr_token)
    .single();

  if (!qr || !qr.is_active) {
    return NextResponse.json({ error: 'QR ไม่ถูกต้องหรือถูกปิดใช้งาน' }, { status: 404 });
  }

  type ItemInput = {
    menu_item_id: string;
    quantity: number;
    price_snapshot: number;
    note?: string;
    options_snapshot?: Array<{ group_name: string; option_name: string; price_delta: number; quantity?: number }>;
  };

  let total = 0;
  for (const it of items as ItemInput[]) {
    const optDelta = (it.options_snapshot ?? []).reduce(
      (s, o) => s + Number(o.price_delta) * (o.quantity ?? 1), 0
    );
    total += (Number(it.price_snapshot) + optDelta) * it.quantity;
  }

  if (total <= 0) {
    return NextResponse.json({ error: 'ยอดรวมต้องมากกว่า 0' }, { status: 400 });
  }

  const { data: codeRes } = await supabase
    .rpc('generate_pickup_code', { p_restaurant_id: qr.restaurant_id });
  const pickupCode = codeRes as string;

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .insert({
      restaurant_id: qr.restaurant_id,
      session_id: null,
      device_id: null,
      status: 'pending',
      order_type: 'preorder',
      pickup_code: pickupCode,
      customer_name: customer_name || null,
      customer_phone: customer_phone || null,
    })
    .select()
    .single();

  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  const itemRows = (items as ItemInput[]).map((it) => ({
    order_id: order.id,
    menu_item_id: it.menu_item_id,
    quantity: it.quantity,
    price_snapshot: it.price_snapshot,
    note: it.note || null,
    options_snapshot: it.options_snapshot || [],
    status: 'pending',
  }));

  const { error: iErr } = await supabase.from('order_items').insert(itemRows);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  try {
    const amountSatang = Math.round(total * 100);

    // ─── Step 1: Create source for PromptPay ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source: any = await (omise as any).sources.create({
      type: 'promptpay',
      amount: amountSatang,
      currency: 'thb',
    });

    // ─── Step 2: Create charge using source id ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge: any = await omise.charges.create({
      amount: amountSatang,
      currency: 'thb',
      source: source.id,
      metadata: {
        order_id: order.id,
        restaurant_id: qr.restaurant_id,
        order_type: 'preorder',
        pickup_code: pickupCode,
      },
    });

    const { data: payment } = await supabase
      .from('payments')
      .insert({
        session_id: null,
        restaurant_id: qr.restaurant_id,
        method: 'promptpay',
        amount: total,
        status: 'pending',
        omise_charge_id: charge.id,
      })
      .select()
      .single();

    // QR image URL from source (not charge)
    const qrUrl =
      source.scannable_code?.image?.download_uri ??
      charge.source?.scannable_code?.image?.download_uri ??
      null;

    return NextResponse.json({
      order_id: order.id,
      pickup_code: pickupCode,
      payment_id: payment?.id,
      qr_code: qrUrl,
      total,
    });
  } catch (err) {
    // Roll back order if Omise fails
    await supabase.from('order_items').delete().eq('order_id', order.id);
    await supabase.from('orders').delete().eq('id', order.id);

    // Surface real Omise error message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    const msg = e?.message || e?.error?.message || 'omise error';
    console.error('Omise error:', JSON.stringify(e, null, 2));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
