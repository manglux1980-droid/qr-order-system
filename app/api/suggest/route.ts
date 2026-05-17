import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const client = new Anthropic({ apiKey });

type MenuItemRow = {
  id: string;
  name_th: string;
  name_en: string | null;
  price: number;
  image_url: string | null;
  category_id: string;
  is_available: boolean;
};

type CategoryRow = {
  id: string;
  name_th: string;
  is_active: boolean;
};

export async function POST(req: NextRequest) {
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
  }

  try {
    const { restaurant_id, cart_categories, exclude_item_ids = [] } = await req.json();

    if (!restaurant_id) {
      return NextResponse.json({ error: 'restaurant_id required' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Get all active categories
    const { data: cats } = await supabase
      .from('menu_categories')
      .select('id, name_th, is_active')
      .eq('restaurant_id', restaurant_id)
      .eq('is_active', true)
      .order('sort_order');

    if (!cats || cats.length === 0) {
      return NextResponse.json({ suggested_item: null });
    }

    // Find categories NOT in cart yet
    const cartCatSet = new Set(cart_categories ?? []);
    const unusedCats = (cats as CategoryRow[]).filter(c => !cartCatSet.has(c.id));

    if (unusedCats.length === 0) {
      // All categories already in cart
      return NextResponse.json({ suggested_item: null });
    }

    // Get menu items from unused categories
    const unusedCatIds = unusedCats.map(c => c.id);
    const { data: items } = await supabase
      .from('menu_items')
      .select('id, name_th, name_en, price, image_url, category_id, is_available')
      .eq('restaurant_id', restaurant_id)
      .eq('is_available', true)
      .in('category_id', unusedCatIds);

    if (!items || items.length === 0) {
      return NextResponse.json({ suggested_item: null });
    }

    // Exclude items already suggested
    const filtered = (items as MenuItemRow[]).filter(it => !exclude_item_ids.includes(it.id));
    if (filtered.length === 0) {
      return NextResponse.json({ suggested_item: null });
    }

    // Get cart category names for prompt
    const cartCatNames = (cats as CategoryRow[])
      .filter(c => cartCatSet.has(c.id))
      .map(c => c.name_th);

    // Build prompt with available items grouped by category
    const itemsByCategory: Record<string, MenuItemRow[]> = {};
    for (const it of filtered) {
      if (!itemsByCategory[it.category_id]) itemsByCategory[it.category_id] = [];
      itemsByCategory[it.category_id].push(it);
    }

    const itemsList = unusedCats
      .filter(c => itemsByCategory[c.id])
      .map(c => {
        const items = itemsByCategory[c.id].map(it => `- ${it.name_th} (id: ${it.id}, ราคา: ${it.price}บาท)`).join('\n');
        return `หมวด: ${c.name_th}\n${items}`;
      })
      .join('\n\n');

    const prompt = `คุณเป็นพนักงานร้านอาหารไทยที่แนะนำเมนูเพิ่มเติมให้ลูกค้า

ลูกค้าสั่งเมนูจากหมวด: ${cartCatNames.join(', ') || '(ยังไม่ได้สั่ง)'}

เมนูที่แนะนำเพิ่มได้ (ในหมวดที่ยังไม่ได้สั่ง):
${itemsList}

ภารกิจ: เลือก 1 เมนูที่เหมาะที่สุด พร้อมเหตุผลสั้นๆ น่ารัก ชวนซื้อ (ไม่เกิน 30 ตัวอักษร)

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown:
{
  "item_id": "<id ของเมนูที่เลือก>",
  "reason": "<เหตุผลสั้นๆ ภาษาไทย>"
}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const clean = text.replace(/```json|```/g, '').trim();

    let result: { item_id: string; reason: string };
    try {
      result = JSON.parse(clean);
    } catch {
      console.error('AI invalid JSON:', text);
      return NextResponse.json({ suggested_item: null });
    }

    const chosen = filtered.find(it => it.id === result.item_id);
    if (!chosen) {
      return NextResponse.json({ suggested_item: null });
    }

    return NextResponse.json({
      suggested_item: {
        id: chosen.id,
        name_th: chosen.name_th,
        name_en: chosen.name_en,
        price: chosen.price,
        image_url: chosen.image_url,
        reason: result.reason,
      },
    });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    console.error('Suggest error:', err?.message);
    return NextResponse.json({ suggested_item: null });
  }
}
