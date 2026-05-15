import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { table_token, device_id, nickname } = await req.json()
  if (!table_token || !device_id) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  // Find table by token
  const { data: table } = await supabase
    .from('tables')
    .select('id, restaurant_id, table_number, label')
    .eq('qr_token', table_token)
    .eq('is_active', true)
    .single()

  if (!table) return NextResponse.json({ error: 'table not found' }, { status: 404 })

  // Check for ANY active session (open / ordering / paying)
  // Include 'paying' so that if a customer pressed "ขอจ่ายเงิน" but a friend at the
  // same table is still ordering, the friend joins the same session/bill.
  const { data: existing } = await supabase
    .from('table_sessions')
    .select('*')
    .eq('table_id', table.id)
    .in('status', ['open', 'ordering', 'paying'])
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let session = existing

  if (!session) {
    // Create new session (new group of guests)
    const { data: newSession } = await supabase
      .from('table_sessions')
      .insert({
        restaurant_id: table.restaurant_id,
        table_id: table.id,
        status: 'open',
        guest_count: 1,
      })
      .select()
      .single()
    session = newSession
  } else {
    // Only increment guest_count if this device is new to the session
    const { data: existingOrderForDevice } = await supabase
      .from('orders')
      .select('id')
      .eq('session_id', session.id)
      .eq('device_id', device_id)
      .maybeSingle()

    if (!existingOrderForDevice) {
      await supabase
        .from('table_sessions')
        .update({ guest_count: (session.guest_count || 1) + 1 })
        .eq('id', session.id)
    }
  }

  // Create order for this device if not exists
  const { data: existingOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('session_id', session.id)
    .eq('device_id', device_id)
    .maybeSingle()

  let order = existingOrder
  if (!order) {
    const { data: newOrder } = await supabase
      .from('orders')
      .insert({
        session_id: session.id,
        restaurant_id: table.restaurant_id,
        device_id,
        nickname: nickname || null,
        status: 'pending',
      })
      .select()
      .single()
    order = newOrder
  }

  return NextResponse.json({ session, order, table })
}
