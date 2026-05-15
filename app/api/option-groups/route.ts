import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: ru } = await supabase
    .from('restaurant_users')
    .select('restaurant_id')
    .eq('user_id', user.id)
    .single();
  if (!ru) return NextResponse.json({ error: 'no restaurant' }, { status: 403 });

  const { data, error } = await supabase
    .from('option_groups')
    .select(`
      *,
      option_group_items (*)
    `)
    .eq('restaurant_id', ru.restaurant_id)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ groups: data ?? [] });
}

type ItemInput = {
  name_th: string;
  name_en?: string | null;
  name_zh?: string | null;
  name_ja?: string | null;
  name_ko?: string | null;
  price_delta: number;
  image_url?: string | null;
  sort_order?: number;
};

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
  const { name_th, name_en, name_zh, name_ja, name_ko, selection_type, is_required, sort_order, items } = body;
  if (!name_th) return NextResponse.json({ error: 'name_th required' }, { status: 400 });

  const { data: group, error } = await supabase
    .from('option_groups')
    .insert({
      restaurant_id: ru.restaurant_id,
      name_th, name_en: name_en || null, name_zh: name_zh || null,
      name_ja: name_ja || null, name_ko: name_ko || null,
      selection_type: selection_type === 'multi' ? 'multi' : 'single',
      is_required: !!is_required,
      sort_order: sort_order ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(items) && items.length > 0) {
    const rows = items.map((it: ItemInput, idx: number) => ({
      group_id: group.id,
      name_th: it.name_th,
      name_en: it.name_en || null,
      name_zh: it.name_zh || null,
      name_ja: it.name_ja || null,
      name_ko: it.name_ko || null,
      price_delta: it.price_delta ?? 0,
      image_url: it.image_url || null,
      sort_order: it.sort_order ?? idx,
    }));
    await supabase.from('option_group_items').insert(rows);
  }

  return NextResponse.json({ group });
}

export async function PATCH(req: NextRequest) {
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
  const { id, name_th, name_en, name_zh, name_ja, name_ko, selection_type, is_required, sort_order, is_active, items } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (name_th !== undefined) patch.name_th = name_th;
  if (name_en !== undefined) patch.name_en = name_en;
  if (name_zh !== undefined) patch.name_zh = name_zh;
  if (name_ja !== undefined) patch.name_ja = name_ja;
  if (name_ko !== undefined) patch.name_ko = name_ko;
  if (selection_type !== undefined) patch.selection_type = selection_type;
  if (is_required !== undefined) patch.is_required = is_required;
  if (sort_order !== undefined) patch.sort_order = sort_order;
  if (is_active !== undefined) patch.is_active = is_active;
  patch.updated_at = new Date().toISOString();

  const { error: uErr } = await supabase
    .from('option_groups')
    .update(patch)
    .eq('id', id)
    .eq('restaurant_id', ru.restaurant_id);

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  if (Array.isArray(items)) {
    await supabase.from('option_group_items').delete().eq('group_id', id);
    if (items.length > 0) {
      const rows = items.map((it: ItemInput, idx: number) => ({
        group_id: id,
        name_th: it.name_th,
        name_en: it.name_en || null,
        name_zh: it.name_zh || null,
        name_ja: it.name_ja || null,
        name_ko: it.name_ko || null,
        price_delta: it.price_delta ?? 0,
        image_url: it.image_url || null,
        sort_order: it.sort_order ?? idx,
      }));
      await supabase.from('option_group_items').insert(rows);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('option_groups').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
