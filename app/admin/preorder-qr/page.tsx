'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Loader2 } from 'lucide-react';

type PreorderQr = {
  id: string;
  qr_token: string;
  label: string | null;
  is_active: boolean;
};

export default function PreorderQrPage() {
  const [qrs, setQrs] = useState<PreorderQr[]>([]);
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const res = await fetch('/api/preorder-qr');
    const json = await res.json();
    if (res.ok) {
      setQrs(json.qrs ?? []);
      setSlug(json.slug ?? '');

      // Generate QR images
      const base = window.location.origin;
      const map: Record<string, string> = {};
      await Promise.all(
        (json.qrs ?? []).map(async (q: PreorderQr) => {
          const url = `${base}/preorder/${json.slug}/${q.qr_token}`;
          map[q.id] = await QRCode.toDataURL(url, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 512,
          });
        })
      );
      setQrDataUrls(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createQr() {
    const label = prompt('ป้ายชื่อ QR (ไม่บังคับ) เช่น "หน้าร้าน", "Facebook page", "Line"');
    setCreating(true);
    const res = await fetch('/api/preorder-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label ?? null }),
    });
    setCreating(false);
    if (!res.ok) {
      const json = await res.json();
      alert(json.error);
      return;
    }
    load();
  }

  async function remove(id: string) {
    if (!confirm('ลบ QR นี้? ใครสแกนเก่าจะใช้ไม่ได้')) return;
    const res = await fetch(`/api/preorder-qr?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json();
      alert(json.error);
      return;
    }
    load();
  }

  function downloadQr(qr: PreorderQr) {
    const dataUrl = qrDataUrls[qr.id];
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `preorder-qr-${qr.label || qr.qr_token.slice(0, 6)}.png`;
    a.click();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">QR สั่งล่วงหน้า</h1>
          <p className="text-sm text-gray-600 mt-1">
            ลูกค้าสแกนจากที่บ้าน สั่ง+จ่ายเงินก่อน แล้วมารับที่ร้านพร้อมเลขออเดอร์
          </p>
        </div>
        <button
          onClick={createQr}
          disabled={creating}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
        >
          + สร้าง QR ใหม่
        </button>
      </div>

      {loading && <div className="text-gray-600">กำลังโหลด...</div>}

      {!loading && qrs.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">📱</div>
          <p className="text-gray-700 font-medium">ยังไม่มี QR สั่งล่วงหน้า</p>
          <p className="text-sm text-gray-500 mt-1">สร้างได้หลายอันสำหรับช่องทางต่างๆ</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {qrs.map((qr) => (
          <div key={qr.id} className="bg-white border border-gray-200 rounded-xl p-4">
            {qrDataUrls[qr.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrls[qr.id]}
                alt="QR"
                className="w-full aspect-square object-contain border border-gray-100 rounded-lg mb-3"
              />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center border border-gray-100 rounded-lg mb-3">
                <Loader2 className="animate-spin text-gray-400" />
              </div>
            )}

            <p className="font-medium text-gray-900 text-sm truncate">
              {qr.label || 'QR สั่งล่วงหน้า'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 break-all">
              /preorder/{slug}/{qr.qr_token.slice(0, 8)}...
            </p>

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => downloadQr(qr)}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                <Download size={14} /> ดาวน์โหลด
              </button>
              <button
                onClick={() => remove(qr.id)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm"
              >
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 mt-6">
        💡 ลูกค้าสแกน QR นี้ → เห็นเมนู → สั่ง → จ่ายเงินผ่าน PromptPay → ได้เลขออเดอร์ →
        มารับที่ร้านแจ้งเลขออเดอร์
      </p>
    </div>
  );
}
