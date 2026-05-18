import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Cancel a pending static PromptPay payment.
 * Called when customer closes payment modal or changes payment method.
 *
 * Body: { payment_id: string }
 *
 * Effect:
 * - Mark payment as cancelled
 * - Revert session status from 'paying' back to 'open'
 *   (only if no other pending payments + not already closed)
 */
export async function POST(req: NextRequest) {
  try {
    const { payment_id } = await req.json();
    if (!payment_id) {
      return NextResponse.json({ error: 'payment_id required' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Find payment
    const { data: payment } = await supabase
      .from('payments')
      .select('id, session_id, status, method')
      .eq('id', payment_id)
      .single();

    if (!payment) {
      return NextResponse.json({ error: 'payment not found' }, { status: 404 });
    }

    // Only cancel if still pending
    if (payment.status !== 'pending_confirmation' && payment.status !== 'pending') {
      return NextResponse.json({ ok: true, message: 'payment already finalized' });
    }

    // Cancel the payment
    await supabase
      .from('payments')
      .update({ status: 'cancelled' })
      .eq('id', payment_id);

    // Check if session has any other pending payments
    const { data: otherPending } = await supabase
      .from('payments')
      .select('id')
      .eq('session_id', payment.session_id)
      .in('status', ['pending', 'pending_confirmation'])
      .limit(1);

    // If no other pending → revert session to 'open'
    if (!otherPending || otherPending.length === 0) {
      const { data: sess } = await supabase
        .from('table_sessions')
        .select('status')
        .eq('id', payment.session_id)
        .single();

      if (sess && sess.status === 'paying') {
        await supabase
          .from('table_sessions')
          .update({ status: 'open' })
          .eq('id', payment.session_id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    console.error('cancel-static error:', err);
    return NextResponse.json({ error: err?.message || 'unknown error' }, { status: 500 });
  }
}
