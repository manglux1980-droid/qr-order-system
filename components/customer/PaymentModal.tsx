'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Method = 'promptpay' | 'alipay_plus' | 'truemoney';

type Props = {
  sessionId: string;
  amount: number;
  onClose: () => void;
  onPaid: () => void;
};

type Stage = 'choose' | 'omise_waiting' | 'paid' | 'error';

export default function PaymentModal({ sessionId, amount, onClose, onPaid }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    if (!paymentId) return;
    const channel = supabase
      .channel(`payment-${paymentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payments',
          filter: `id=eq.${paymentId}`,
        },
        (payload) => {
          const row = payload.new as { status: string };
          if (row.status === 'paid') {
            setStage('paid');
            setTimeout(onPaid, 1500);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [paymentId, onPaid, supabase]);

  async function submit(method: Method) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, method, amount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'failed');

      setPaymentId(json.payment.id);
      setQrCode(json.qr_code);
      setStage('omise_waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setStage('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 text-gray-900">
        {stage === 'choose' && (
          <>
            <h2 className="text-xl font-bold mb-1">จ่ายด้วย QR</h2>
            <p className="text-3xl font-bold text-orange-600 mb-6">
              ฿{amount.toFixed(2)}
            </p>

            <div className="space-y-3">
              <button
                disabled={submitting}
                onClick={() => submit('promptpay')}
                className="w-full p-4 border-2 border-gray-300 rounded-xl hover:border-orange-500 hover:bg-orange-50 text-left disabled:opacity-50"
              >
                <div className="font-semibold">📱 PromptPay</div>
                <div className="text-sm text-gray-600">สแกน QR ด้วยแอปธนาคาร</div>
              </button>

              <button
                disabled={submitting}
                onClick={() => submit('alipay_plus')}
                className="w-full p-4 border-2 border-gray-300 rounded-xl hover:border-orange-500 hover:bg-orange-50 text-left disabled:opacity-50"
              >
                <div className="font-semibold">🌍 Alipay+ / TrueMoney</div>
                <div className="text-sm text-gray-600">35+ wallets นักท่องเที่ยว</div>
              </button>
            </div>

            <button
              onClick={onClose}
              className="mt-4 w-full py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              ยกเลิก
            </button>
          </>
        )}

        {stage === 'omise_waiting' && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-3">สแกนเพื่อชำระเงิน</h2>
            {qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCode} alt="Payment QR" className="mx-auto w-64 h-64" />
            )}
            <p className="text-3xl font-bold text-orange-600 mt-4">
              ฿{amount.toFixed(2)}
            </p>
            <p className="text-sm text-gray-500 mt-2 mb-4">
              ระบบจะอัปเดตเมื่อชำระเงินสำเร็จ
            </p>
            <button
              onClick={onClose}
              className="w-full py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              ปิด
            </button>
          </div>
        )}

        {stage === 'paid' && (
          <div className="text-center py-6">
            <div className="text-6xl mb-3">✅</div>
            <h2 className="text-2xl font-bold text-green-600 mb-2">
              ชำระเงินสำเร็จ
            </h2>
            <p className="text-gray-700">ขอบคุณที่ใช้บริการ</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-bold text-red-600 mb-2">เกิดข้อผิดพลาด</h2>
            <p className="text-gray-700 mb-4">{error}</p>
            <button
              onClick={() => setStage('choose')}
              className="w-full py-3 bg-orange-500 text-white rounded-xl font-semibold"
            >
              ลองอีกครั้ง
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
