import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Manually close a session by cashier.
 * Used when a customer left without paying, or session was abandoned.
 *
 * Body: { session_id: string, reason?: 'abandoned' | 'no_show' | 'manual' }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id, role')
    .eq('user_id', user.id)
    .single();
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 });
  if (!['admin', 'cashier'].includes(ru.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { session_id, reason } = await req.json();
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  // Verify session belongs to this restaurant
  const { data: sess } = await supabase
    .from('table_sessions')
    .select('id, status, restaurant_id')
    .eq('id', session_id)
    .single();

  if (!sess) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (sess.restaurant_id !== ru.restaurant_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (sess.status === 'closed') {
    return NextResponse.json({ error: 'session already closed' }, { status: 400 });
  }

  // Close session
  const { error } = await supabase
    .from('table_sessions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
    })
    .eq('id', session_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`Session ${session_id} closed by cashier ${user.id}, reason: ${reason || 'manual'}`);

  return NextResponse.json({ ok: true });
}
