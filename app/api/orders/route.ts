import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { order_id, items } = await req.json()
  // items: [{ menu_item_id, quantity, price_snapshot, note }]

  if (!order_id || !items?.length) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  const rows = items.map((item: {
    menu_item_id: string
    quantity: number
    price_snapshot: number
    note?: string
  }) => ({
    order_id,
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    price_snapshot: item.price_snapshot,
    note: item.note || null,
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
