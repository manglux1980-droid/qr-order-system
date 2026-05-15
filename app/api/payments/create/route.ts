import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { omise } from '@/lib/omise'

export async function POST(req: NextRequest) {
  const { session_id, method, amount } = await req.json()
  // method: 'promptpay' | 'alipay_plus'

  if (!session_id || !method || !amount) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  // Get session info
  const { data: session } = await supabase
    .from('table_sessions')
    .select('id, restaurant_id')
    .eq('id', session_id)
    .single()

  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 })

  // Create payment record (pending)
  const { data: payment } = await supabase
    .from('payments')
    .insert({
      session_id,
      restaurant_id: session.restaurant_id,
      method,
      scope: 'full',
      amount,
      status: 'pending',
    })
    .select()
    .single()

  if (!payment) return NextResponse.json({ error: 'failed to create payment' }, { status: 500 })

  try {
    // Create Omise source
    const sourceType = method === 'promptpay' ? 'promptpay' : 'alipay'
    const source = await omise.sources.create({
      type: sourceType,
      amount: Math.round(amount * 100), // satang
      currency: 'thb',
    })

    // Create charge
    const charge = await omise.charges.create({
      amount: Math.round(amount * 100),
      currency: 'thb',
      source: source.id,
      metadata: {
        payment_id: payment.id,
        session_id,
      },
    })

    // Extract QR code URL
    const qrImageUrl =
      method === 'promptpay'
        ? (charge.source as { scannable_code?: { image?: { download_uri?: string } } })?.scannable_code?.image?.download_uri
        : charge.authorize_uri

    // Update payment with charge ref + QR
    await supabase
      .from('payments')
      .update({
        gateway_ref: charge.id,
        qr_image_url: qrImageUrl,
      })
      .eq('id', payment.id)

    return NextResponse.json({
      payment_id: payment.id,
      charge_id: charge.id,
      qr_image_url: qrImageUrl,
      method,
      amount,
    })
  } catch (err) {
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', payment.id)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
