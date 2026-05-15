import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // Verify Omise webhook signature
  const signature = req.headers.get('omise-signature')
  const secret = process.env.OMISE_WEBHOOK_SECRET

  if (secret && signature) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')
    if (signature !== expected) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    }
  }

  const event = JSON.parse(rawBody)

  if (event.key !== 'charge.complete' && event.key !== 'charge.expire') {
    return NextResponse.json({ ok: true })
  }

  const charge = event.data
  const paymentId = charge.metadata?.payment_id

  if (!paymentId) return NextResponse.json({ error: 'no payment_id' }, { status: 400 })

  const supabase = await createServiceClient()
  const newStatus = charge.status === 'successful' ? 'paid' : 'failed'

  await supabase
    .from('payments')
    .update({
      status: newStatus,
      paid_at: newStatus === 'paid' ? new Date().toISOString() : null,
    })
    .eq('id', paymentId)

  if (newStatus === 'paid') {
    const { data: payment } = await supabase
      .from('payments')
      .select('session_id')
      .eq('id', paymentId)
      .single()

    if (payment?.session_id) {
      await supabase
        .from('table_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', payment.session_id)

      await supabase
        .from('orders')
        .update({ status: 'served' })
        .eq('session_id', payment.session_id)
    }
  }

  return NextResponse.json({ ok: true })
}
