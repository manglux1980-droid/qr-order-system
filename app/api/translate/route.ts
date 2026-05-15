import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  const { name_th, desc_th } = await req.json()

  if (!name_th) {
    return NextResponse.json({ error: 'name_th required' }, { status: 400 })
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
Keep translations natural and appetizing for restaurant menus.`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const clean = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Translation error:', error)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
