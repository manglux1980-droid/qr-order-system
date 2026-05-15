import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id, restaurants(slug)')
    .eq('user_id', user.id)
    .single();
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 });

  const { data, error } = await supabase
    .from('preorder_qr')
    .select('id, qr_token, label, is_active')
    .eq('restaurant_id', ru.restaurant_id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // @ts-expect-error supabase typing
  const slug = ru.restaurants?.slug;
  return NextResponse.json({ qrs: data ?? [], slug });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .single();
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 });

  const { label } = await req.json();

  const { data, error } = await supabase
    .from('preorder_qr')
    .insert({
      restaurant_id: ru.restaurant_id,
      label: label || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ qr: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('preorder_qr').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
