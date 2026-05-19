import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Allowed statuses match DB CHECK constraint:
// 'pending', 'confirmed', 'cooking', 'served', 'cancelled'
const ALLOWED_STATUSES = ['pending', 'confirmed', 'cooking', 'served', 'cancelled'] as const

// POST /api/orders — submit items to an existing order
// body: { order_id, items: [{ menu_item_id, quantity, price_snapshot, note }] }
export async function POST(req: NextRequest) {
  const { order_id, items } = await req.json()

  if (!order_id || !items?.length) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  type IncomingItem = {
    menu_item_id: string
    quantity: number
    price_snapshot: number
    note?: string
    options_snapshot?: Array<{
      group_id: string
      group_name: string
      option_id: string
      option_name: string
      price_delta: number
      quantity: number
    }>
  }

  const rows = (items as IncomingItem[]).map((item) => ({
    order_id,
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    price_snapshot: item.price_snapshot,
    note: item.note || null,
    options_snapshot: item.options_snapshot ?? [],
    status: 'pending',
  }))

  const { data, error } = await supabase
    .from('order_items')
    .insert(rows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update order status to confirmed
  await supabase
    .from('orders')
    .update({ status: 'confirmed' })
    .eq('id', order_id)

  return NextResponse.json({ success: true, items: data })
}

// PATCH /api/orders — update order status (used by KDS "mark served")
// body: { id, status }
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .single()
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 })

  const { id, status } = await req.json()
  if (!id || !status) {
    return NextResponse.json({ error: 'id + status required' }, { status: 400 })
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `invalid status. allowed: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  const service = await createServiceClient()
  const { data, error } = await service
    .from('orders')
    .update({ status })
    .eq('id', id)
    .eq('restaurant_id', ru.restaurant_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ order: data })
}
