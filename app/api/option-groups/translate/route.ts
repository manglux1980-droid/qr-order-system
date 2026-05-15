import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/option-groups/translate
// body: { group_name_th, item_names_th: string[] }
// Returns: { group: {en,zh,ja,ko}, items: [{en,zh,ja,ko}, ...] }
export async function POST(req: NextRequest) {
  const { group_name_th, item_names_th } = await req.json();

  if (!group_name_th || !Array.isArray(item_names_th)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const prompt = `You are translating Thai restaurant menu option labels.

The group name is for a category of menu options (e.g. "เนื้อสัตว์" = meat choice, "ระดับความเผ็ด" = spice level, "Topping").
The item names are the choices inside the group (e.g. "หมูชิ้น", "ไก่", "ไข่ดาว").

Translate ALL text to English (en), Simplified Chinese (zh), Japanese (ja), and Korean (ko).
Keep translations SHORT (1-3 words ideal) — these appear as small buttons in a mobile menu UI.
Use the most natural and commonly recognized term in each language for restaurant context.

Group name (Thai): ${group_name_th}
Item names (Thai): ${JSON.stringify(item_names_th)}

Respond with ONLY this JSON, no markdown, no commentary:
{
  "group": { "en": "...", "zh": "...", "ja": "...", "ko": "..." },
  "items": [
    { "en": "...", "zh": "...", "ja": "...", "ko": "..." }
  ]
}

The "items" array must have EXACTLY ${item_names_th.length} entries in the same order as input.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'translate failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
