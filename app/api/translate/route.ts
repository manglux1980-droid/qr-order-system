import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

const client = new Anthropic({
  apiKey: apiKey,
});

export async function POST(req: NextRequest) {
  if (!apiKey) {
    console.error('Anthropic API key not configured');
    return NextResponse.json(
      { error: 'AI service not configured. Please set ANTHROPIC_API_KEY in environment variables.' },
      { status: 500 }
    );
  }

  const { name_th, desc_th } = await req.json();

  if (!name_th) {
    return NextResponse.json({ error: 'name_th required' }, { status: 400 });
  }

  const prompt = `You are a restaurant menu translator. Translate the following Thai menu item into English, Chinese (Simplified), Japanese, and Korean.

Thai name: ${name_th}
Thai description: ${desc_th || '(none)'}

Respond ONLY with valid JSON in this exact format, no markdown, no explanation:
{
  "names": {
    "en": "...",
    "zh": "...",
    "ja": "...",
    "ko": "..."
  },
  "descs": {
    "en": "...",
    "zh": "...",
    "ja": "...",
    "ko": "..."
  }
}

For descriptions, if the Thai description is "(none)", return empty strings for all.
Keep translations natural and appetizing for restaurant menus.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const clean = text.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch {
      console.error('JSON parse failed. Raw response:', text);
      return NextResponse.json(
        { error: 'AI returned invalid format' },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = error as any;
    const msg = e?.message || 'Translation failed';
    console.error('Translation error:', msg, e?.error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
