import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET — list tables of staff's restaurant
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

  const { data: tables, error } = await supabase
    .from('tables')
    .select('id, table_number, label, qr_token, is_active')
    .eq('restaurant_id', ru.restaurant_id)
    .order('table_number', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // @ts-expect-error supabase typing
  const slug = ru.restaurants?.slug;
  return NextResponse.json({ tables, slug });
}

// POST — add table(s). body: { table_number, label } | { from, to } for bulk
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

  const body = await req.json();

  // bulk create: { from: 1, to: 10 }
  if (typeof body.from === 'number' && typeof body.to === 'number') {
    const rows = [];
    for (let n = body.from; n <= body.to; n++) {
      rows.push({
        restaurant_id: ru.restaurant_id,
        table_number: n,
        label: `โต๊ะ ${n}`,
      });
    }
    const { data, error } = await supabase.from('tables').insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tables: data });
  }

  // single
  const { data, error } = await supabase
    .from('tables')
    .insert({
      restaurant_id: ru.restaurant_id,
      table_number: body.table_number,
      label: body.label ?? `โต๊ะ ${body.table_number}`,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ table: data });
}

// PATCH — update label / active
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, label, is_active, table_number } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (label !== undefined) patch.label = label;
  if (is_active !== undefined) patch.is_active = is_active;
  if (table_number !== undefined) patch.table_number = table_number;

  const { data, error } = await supabase
    .from('tables')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ table: data });
}

// DELETE — ?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // safety: don't delete if open sessions exist
  const { count } = await supabase
    .from('table_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('table_id', id)
    .in('status', ['open', 'ordering', 'paying']);

  if (count && count > 0) {
    return NextResponse.json(
      { error: 'มี session ที่ยังไม่ปิดอยู่ ปิด session ก่อนค่อยลบ' },
      { status: 400 }
    );
  }

  const { error } = await supabase.from('tables').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
