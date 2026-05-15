import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const event = await req.json()

  // Omise sends events like: charge.complete, charge.expire
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

  // If paid, close session and mark all orders as served
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
