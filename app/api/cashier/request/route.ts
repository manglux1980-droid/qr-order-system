import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// POST /api/cashier/request
// Customer-facing: signal "I want to pay now, please come to my table OR I'll come to counter"
// body: { session_id }
export async function POST(req: NextRequest) {
  const { session_id } = await req.json();
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Fetch session
  const { data: session, error: sErr } = await supabase
    .from('table_sessions')
    .select('id, status, restaurant_id')
    .eq('id', session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  if (session.status === 'closed') {
    return NextResponse.json({ error: 'session already closed' }, { status: 400 });
  }

  // Flip session status → "paying" (this is what cashier filters on)
  const { error: uErr } = await supabase
    .from('table_sessions')
    .update({ status: 'paying' })
    .eq('id', session_id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/cashier/request?session_id=xxx
// Customer cancels the request (e.g. wants to order more)
export async function DELETE(req: NextRequest) {
  const session_id = req.nextUrl.searchParams.get('session_id');
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // Only revert if still in "paying" state (avoid race with cashier closing)
  const { data, error } = await supabase
    .from('table_sessions')
    .update({ status: 'ordering' })
    .eq('id', session_id)
    .eq('status', 'paying')
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: 'session not in paying state' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
