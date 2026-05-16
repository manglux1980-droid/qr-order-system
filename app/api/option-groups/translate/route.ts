import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const client = new Anthropic({ apiKey });

export async function POST(req: NextRequest) {
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI service not configured' },
      { status: 500 }
    );
  }

  const { group_name_th, item_names_th } = await req.json();

  if (!group_name_th || !Array.isArray(item_names_th) || item_names_th.length === 0) {
    return NextResponse.json(
      { error: 'group_name_th and item_names_th required' },
      { status: 400 }
    );
  }

  const prompt = `You are a restaurant menu translator. Translate the following Thai option group and its items into English, Chinese (Simplified), Japanese, and Korean.

Group name (Thai): ${group_name_th}
Item names (Thai):
${item_names_th.map((n: string, i: number) => `${i + 1}. ${n}`).join('\n')}

Respond ONLY with valid JSON in this exact format, no markdown, no explanation:
{
  "group": {
    "en": "...",
    "zh": "...",
    "ja": "...",
    "ko": "..."
  },
  "items": [
    { "en": "...", "zh": "...", "ja": "...", "ko": "..." },
    ...
  ]
}

The "items" array must have exactly ${item_names_th.length} entries in the same order as the input.
Keep translations natural for restaurant menu options.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const clean = text.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      console.error('JSON parse failed. Raw response:', text);
      return NextResponse.json({ error: 'AI returned invalid format' }, { status: 500 });
    }

    return NextResponse.json(result);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = error as any;
    const msg = e?.message || 'Translation failed';
    console.error('Translation error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
