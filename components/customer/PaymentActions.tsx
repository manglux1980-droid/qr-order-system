'use client';

import { useState } from 'react';
import PaymentModal from './PaymentModal';

type Props = {
  sessionId: string;
  total: number;
  sessionStatus: string; // 'ordering' | 'paying' | etc
  onChanged?: () => void; // refresh callback
};

// Drop this into the customer page near the bottom of the cart / order list.
// Shows two buttons:
//   1. "ขอจ่ายเงิน" (primary, big) — flags session as paying, cashier will come / customer goes to counter
//   2. "📱 จ่ายด้วย QR ที่โต๊ะ" (secondary, small) — opens PaymentModal for PromptPay/Alipay+
export default function PaymentActions({ sessionId, total, sessionStatus, onChanged }: Props) {
  const [showQrModal, setShowQrModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isRequesting = sessionStatus === 'paying';

  async function requestBill() {
    setSubmitting(true);
    const res = await fetch('/api/cashier/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json();
      alert(json.error || 'เรียกแคชเชียร์ไม่สำเร็จ');
      return;
    }
    onChanged?.();
  }

  async function cancelRequest() {
    setSubmitting(true);
    const res = await fetch(`/api/cashier/request?session_id=${sessionId}`, {
      method: 'DELETE',
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json();
      alert(json.error || 'ยกเลิกไม่สำเร็จ');
      return;
    }
    onChanged?.();
  }

  if (total <= 0) return null;

  return (
    <>
      <div className="space-y-3">
        {!isRequesting ? (
          <button
            onClick={requestBill}
            disabled={submitting}
            className="w-full py-4 bg-orange-500 text-white font-bold text-lg rounded-xl hover:bg-orange-600 disabled:opacity-50"
          >
            💰 ขอจ่ายเงิน (฿{total.toFixed(2)})
          </button>
        ) : (
          <div className="p-4 border-2 border-orange-300 bg-orange-50 rounded-xl text-center">
            <div className="flex justify-center mb-2">
              <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="font-bold text-orange-700">เรียกแคชเชียร์แล้ว</p>
            <p className="text-sm text-gray-700 mt-1">
              กรุณาแจ้งเลขโต๊ะที่เคาน์เตอร์ หรือรอพนักงาน
            </p>
            <button
              onClick={cancelRequest}
              disabled={submitting}
              className="mt-3 text-sm text-gray-600 underline hover:text-gray-900"
            >
              ยกเลิก (อยากสั่งเพิ่ม)
            </button>
          </div>
        )}

        {!isRequesting && (
          <button
            onClick={() => setShowQrModal(true)}
            className="w-full py-2.5 border border-gray-300 text-gray-700 font-medium text-sm rounded-lg hover:bg-gray-50"
          >
            📱 จ่ายด้วย QR ที่โต๊ะ (PromptPay / Alipay+)
          </button>
        )}
      </div>

      {showQrModal && (
        <PaymentModal
          sessionId={sessionId}
          amount={total}
          onClose={() => setShowQrModal(false)}
          onPaid={() => {
            setShowQrModal(false);
            onChanged?.();
          }}
        />
      )}
    </>
  );
}
