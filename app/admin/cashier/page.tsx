'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

type BillItem = {
  name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  options: string[];
};

type CashierSession = {
  session_id: string;
  status: string;
  opened_at: string;
  table_id: string;
  table_number: number;
  table_label: string | null;
  total: number;
  item_count: number;
  items: BillItem[];
};

let thaiVoiceCache: SpeechSynthesisVoice | null = null;
let femaleVoiceCache: SpeechSynthesisVoice | null = null;

function pickVoices() {
  const voices = speechSynthesis.getVoices();
  const thaiAll = voices.filter(v => v.lang.toLowerCase().startsWith('th'));

  if (thaiAll.length > 0) {
    thaiVoiceCache = thaiAll[0];

    // Try to find female Thai voice
    // Common Thai female voice names: Kanya, Premwadee, Narisa
    // On macOS: Kanya
    // On Windows: Pattara (male) / Premwadee (female)
    // On Android: th-TH-Wavenet-A (female)
    const femaleKeywords = ['kanya', 'premwadee', 'narisa', 'female', 'หญิง', 'wavenet-a', 'wavenet-b'];
    const female = thaiAll.find(v =>
      femaleKeywords.some(k => v.name.toLowerCase().includes(k))
    );
    femaleVoiceCache = female || thaiAll[0]; // fallback to any Thai voice
  }
}

function speakThai(text: string, opts?: { female?: boolean; rate?: number; pitch?: number }) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH';
    u.rate = opts?.rate ?? 1.0;
    u.volume = 1.0;
    u.pitch = opts?.pitch ?? 1.0;

    const voice = opts?.female
      ? (femaleVoiceCache || thaiVoiceCache)
      : thaiVoiceCache;
    if (voice) u.voice = voice;

    speechSynthesis.speak(u);
  } catch (e) {
    console.warn('Speech failed:', e);
  }
}

export default function CashierPage() {
  const [sessions, setSessions] = useState<CashierSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CashierSession | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [voiceReady, setVoiceReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const sessionsRef = useRef<CashierSession[]>([]);

  const supabase = createClient();

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  useEffect(() => {
    function checkVoices() {
      pickVoices();
      if (speechSynthesis.getVoices().length > 0) {
        setVoiceReady(true);
        if (thaiVoiceCache) console.log('Thai voice:', thaiVoiceCache.name, thaiVoiceCache.lang);
        if (femaleVoiceCache) console.log('Female voice:', femaleVoiceCache.name);
      }
    }
    checkVoices();
    speechSynthesis.addEventListener('voiceschanged', checkVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', checkVoices);
  }, []);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      if (!audioCtxRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current!;
      if (ctx.state === 'suspended') ctx.resume();
      const u = new SpeechSynthesisUtterance('');
      speechSynthesis.speak(u);
      audioUnlockedRef.current = true;
    } catch (e) {
      console.warn('Audio unlock failed:', e);
    }
  }, []);

  useEffect(() => {
    const handler = () => unlockAudio();
    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [unlockAudio]);

  const load = useCallback(async () => {
    const res = await fetch('/api/cashier/sessions');
    const json = await res.json();
    if (res.ok) {
      setSessions(json.sessions ?? []);
      setSelected((prev) =>
        prev
          ? (json.sessions ?? []).find((s: CashierSession) => s.session_id === prev.session_id) ?? null
          : null
      );
    }
    setLoading(false);
  }, []);

  function playDing(pattern: 'normal' | 'cash' = 'normal') {
    if (!audioUnlockedRef.current) {
      console.warn('Audio not unlocked yet');
      return;
    }
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      // Different ding patterns
      const freqs = pattern === 'cash' ? [1320, 1056, 1584] : [880, 660];
      const interval = pattern === 'cash' ? 0.15 : 0.2;

      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * interval);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * interval + 0.25);
        osc.start(ctx.currentTime + i * interval);
        osc.stop(ctx.currentTime + i * interval + 0.25);
      });
    } catch (e) {
      console.warn('playDing failed:', e);
    }
  }

  // Event: customer requested payment (status: open → paying)
  function onPayRequested(tableNumber?: number, amount?: number) {
    playDing('normal');
    setTimeout(() => {
      let text = 'คิดเงินโต๊ะ';
      if (tableNumber) text += ` ${tableNumber}`;
      if (amount) text += ` ${Math.round(amount)} บาท`;
      speakThai(text);
    }, 500);
  }

  // Event: payment completed (status → closed)
  function onPaymentCompleted(amount?: number) {
    playDing('cash');
    setTimeout(() => {
      let text = 'เงินเข้าแล้ว';
      if (amount) text += ` ${Math.round(amount)} บาท`;
      speakThai(text, { female: true, pitch: 1.15 });
    }, 600);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel('cashier-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, (payload) => {
        if (payload.eventType === 'UPDATE' && soundOn) {
          const oldStatus = (payload.old as { status?: string }).status;
          const newStatus = (payload.new as { status?: string }).status;
          const sessionId = (payload.new as { id: string }).id;
          const sess = sessionsRef.current.find(s => s.session_id === sessionId);

          // Customer requested bill at cashier
          if (newStatus === 'paying' && oldStatus !== 'paying') {
            onPayRequested(sess?.table_number, sess?.total);
          }
          // Payment completed (via webhook OR cashier checkout)
          else if (newStatus === 'closed' && oldStatus !== 'closed') {
            onPaymentCompleted(sess?.total);
          }
        }
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, supabase, soundOn]);

  async function checkout(session: CashierSession) {
    if (!window.confirm(`รับเงิน ฿${session.total.toFixed(2)} จากโต๊ะ #${session.table_number}?`)) return;
    setSubmitting(true);
    const res = await fetch('/api/cashier/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session.session_id, amount: session.total, method: 'cash' }),
    });
    setSubmitting(false);
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || 'รับเงินไม่สำเร็จ');
      return;
    }
    setSelected(null);
    load();
  }

  function elapsed(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 1) return 'เพิ่งเปิด';
    if (diff < 60) return `${diff} นาที`;
    return `${Math.floor(diff / 60)} ชม. ${diff % 60} นาที`;
  }

  function testPayRequest() {
    unlockAudio();
    setTimeout(() => onPayRequested(5, 250), 100);
  }

  function testPaymentDone() {
    unlockAudio();
    setTimeout(() => onPaymentCompleted(250), 100);
  }

  const requesting = sessions.filter((s) => s.status === 'paying');
  const active = sessions.filter((s) => s.status !== 'paying');

  return (
    <div className="p-6 max-w-6xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">แคชเชียร์</h1>
        <div className="flex gap-2">
          <button onClick={testPayRequest} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            🔔 ทดสอบ "ขอจ่าย"
          </button>
          <button onClick={testPaymentDone} className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            💵 ทดสอบ "เงินเข้า"
          </button>
          <button
            onClick={() => {
              setSoundOn((s) => !s);
              unlockAudio();
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            {soundOn ? '🔊 เสียงเปิด' : '🔇 เสียงปิด'}
          </button>
        </div>
      </div>

      {voiceReady && !thaiVoiceCache && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
          ⚠️ Browser นี้ไม่มี Thai voice — ใช้ default แทน
        </div>
      )}

      {loading && <div className="text-gray-600">กำลังโหลด...</div>}

      {!loading && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            {requesting.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-bold text-orange-700 mb-2 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  เรียกเก็บเงิน ({requesting.length})
                </h2>
                <div className="space-y-2">
                  {requesting.map((s) => (
                    <SessionCard key={s.session_id} s={s} selected={selected?.session_id === s.session_id} onClick={() => setSelected(s)} highlight elapsed={elapsed(s.opened_at)} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-sm font-bold text-gray-700 mb-2">โต๊ะที่เปิดอยู่ ({active.length})</h2>
              {active.length === 0 && requesting.length === 0 ? (
                <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
                  <div className="text-4xl mb-2">😌</div>
                  <p className="text-gray-600">ยังไม่มีโต๊ะใช้งาน</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {active.map((s) => (
                    <SessionCard key={s.session_id} s={s} selected={selected?.session_id === s.session_id} onClick={() => setSelected(s)} elapsed={elapsed(s.opened_at)} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="lg:sticky lg:top-6 h-fit">
            {selected ? (
              <BillDetail session={selected} onCheckout={() => checkout(selected)} submitting={submitting} />
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
                เลือกโต๊ะจากรายการด้านซ้ายเพื่อดูบิล
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({ s, selected, onClick, highlight, elapsed }: {
  s: CashierSession;
  selected: boolean;
  onClick: () => void;
  highlight?: boolean;
  elapsed: string;
}) {
  return (
    <button onClick={onClick} className={`w-full text-left p-4 rounded-xl border-2 transition-all ${selected ? 'border-blue-500 bg-blue-50' : highlight ? 'border-orange-400 bg-orange-50 hover:bg-orange-100' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-14 h-14 rounded-lg flex flex-col items-center justify-center font-bold ${highlight ? 'bg-orange-500 text-white' : 'bg-gray-900 text-white'}`}>
          <div className="text-[10px]">โต๊ะ</div>
          <div className="text-xl leading-none">#{s.table_number}</div>
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold text-gray-900">฿{s.total.toFixed(2)}</div>
          <div className="text-xs text-gray-600">{s.item_count} รายการ · {elapsed}</div>
        </div>
        {highlight && <div className="text-orange-600 text-sm font-medium">💰 ขอจ่าย</div>}
      </div>
    </button>
  );
}

function BillDetail({ session, onCheckout, submitting }: {
  session: CashierSession;
  onCheckout: () => void;
  submitting: boolean;
}) {
  return (
    <div className="bg-white border-2 border-gray-300 rounded-xl overflow-hidden shadow-md">
      <div className="bg-gray-900 text-white px-5 py-4 flex items-center justify-between">
        <div>
          <div className="text-sm opacity-75">บิลโต๊ะ</div>
          <div className="text-2xl font-bold">#{session.table_number}</div>
        </div>
        <div className="text-right">
          <div className="text-sm opacity-75">รวมทั้งสิ้น</div>
          <div className="text-3xl font-bold">฿{session.total.toFixed(2)}</div>
        </div>
      </div>

      <div className="p-5">
        <div className="space-y-3 mb-4">
          {session.items.map((it, idx) => (
            <div key={idx} className="border-b border-gray-100 pb-2 last:border-0">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{it.name}</p>
                  {it.options.map((opt, i) => (
                    <p key={i} className="text-xs text-gray-600 ml-2">- {opt}</p>
                  ))}
                </div>
                <div className="text-right text-sm flex-shrink-0">
                  <p className="text-gray-700">×{it.qty}</p>
                  <p className="font-bold text-gray-900">฿{it.subtotal.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t-2 border-gray-300 pt-3 flex justify-between items-center">
          <span className="font-bold text-gray-900">ยอดรวม</span>
          <span className="font-bold text-2xl text-orange-600">฿{session.total.toFixed(2)}</span>
        </div>

        <button
          onClick={onCheckout}
          disabled={submitting || session.total <= 0}
          className="mt-6 w-full py-4 bg-green-600 text-white font-bold text-lg rounded-xl hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? 'กำลังบันทึก...' : `✓ รับเงิน ฿${session.total.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
}
