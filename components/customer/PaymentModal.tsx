'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, X, Check } from 'lucide-react'

type Props = {
  sessionId: string
  amount: number
  onClose: () => void
  onPaid: () => void
}

type Mode = 'omise' | 'manual' | 'loading'

export default function PaymentModal({ sessionId, amount, onClose, onPaid }: Props) {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('loading')
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [qrSvgDataUrl, setQrSvgDataUrl] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [promptpayName, setPromptpayName] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [remainingSec, setRemainingSec] = useState(600)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const initRef = useRef(false)

  // ─── Initialize on mount ───
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    init()
  }, [])

  async function init() {
    // 1. Fetch session → restaurant.payment_mode
    const { data: sess } = await supabase
      .from('table_sessions')
      .select('id, restaurants ( payment_mode )')
      .eq('id', sessionId)
      .single()

    const r = Array.isArray(sess?.restaurants) ? sess!.restaurants[0] : sess?.restaurants
    const paymentMode = (r as { payment_mode?: string } | null)?.payment_mode || 'manual'

    if (paymentMode === 'omise') {
      // Old Omise flow — use existing Omise endpoint
      await initOmise()
      setMode('omise')
    } else {
      // Manual or SMS — static PromptPay QR
      await initStatic()
      setMode('manual')
    }
  }

  async function initOmise() {
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, amount, method: 'promptpay' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'สร้าง QR ไม่สำเร็จ')
        return
      }
      // Omise returns QR image directly
      setQrSvgDataUrl(data.qr_code || data.qr_image)
      setPaymentId(data.payment?.id || data.payment_id)
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any
      setError(err.message)
    }
  }

  async function initStatic() {
    try {
      const res = await fetch('/api/payments/create-static', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, amount }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'สร้าง QR ไม่สำเร็จ')
        return
      }
      setQrPayload(data.qr_payload)
      setPaymentId(data.payment_id)
      setPromptpayName(data.promptpay_name)
      setExpiresAt(data.expires_at)
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any
      setError(err.message)
    }
  }

  // ─── Realtime listen for payment status ───
  useEffect(() => {
    if (!paymentId) return
    const channel = supabase
      .channel(`payment-${paymentId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'payments', filter: `id=eq.${paymentId}`,
      }, (payload) => {
        const row = payload.new as { status: string }
        if (row.status === 'paid') {
          setPaid(true)
          setTimeout(() => onPaid(), 2000)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [paymentId, supabase, onPaid])

  // ─── Countdown ───
  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setRemainingSec(remaining)
      if (remaining === 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  // ─── QR rendering for static mode ───
  useEffect(() => {
    if (!qrPayload) return
    // Use qrcode.react or external library? Let's generate via API.
    // For simplicity, use a CDN-style QR generator
    renderQrCode(qrPayload)
  }, [qrPayload])

  async function renderQrCode(payload: string) {
    try {
      // Dynamic import qrcode lib (will use installed library)
      const QRCode = await import('qrcode')
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
      setQrSvgDataUrl(dataUrl)
    } catch (e) {
      // Fallback: use public QR API service
      console.warn('qrcode library not installed, using fallback:', e)
      const encoded = encodeURIComponent(payload)
      setQrSvgDataUrl(`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encoded}`)
    }
  }

  const min = Math.floor(remainingSec / 60).toString().padStart(2, '0')
  const sec = (remainingSec % 60).toString().padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">ชำระเงิน</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="p-5">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              ⚠️ {error}
            </div>
            <button onClick={onClose} className="w-full mt-3 py-3 bg-gray-200 rounded-xl">ปิด</button>
          </div>
        )}

        {!error && mode === 'loading' && (
          <div className="p-10 text-center">
            <Loader2 className="animate-spin mx-auto text-orange-500 mb-3" size={32} />
            <p className="text-sm text-gray-600">กำลังสร้าง QR...</p>
          </div>
        )}

        {!error && paid && (
          <div className="p-8 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Check size={48} className="text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-green-700 mb-2">ชำระเงินสำเร็จ</h3>
            <p className="text-gray-600">ขอบคุณค่ะ 🙏</p>
          </div>
        )}

        {!error && !paid && mode !== 'loading' && qrSvgDataUrl && (
          <div className="p-5 text-center">
            <p className="text-xs text-gray-600 mb-1">
              {mode === 'omise' ? 'Omise PromptPay' : '📱 สแกนเพื่อโอนเงิน'}
            </p>
            <p className="text-3xl font-bold text-orange-600 mb-3">
              ฿{amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>

            <div className="inline-block bg-white p-4 rounded-2xl border-2 border-gray-200 mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSvgDataUrl} alt="QR Code" className="w-64 h-64" />
            </div>

            {promptpayName && (
              <p className="text-sm text-gray-700 font-medium mb-1">
                ผู้รับ: {promptpayName}
              </p>
            )}

            {mode === 'manual' && expiresAt && (
              <p className={`text-sm font-medium mb-3 ${remainingSec < 60 ? 'text-red-600' : 'text-gray-600'}`}>
                ⏱ QR หมดอายุใน {min}:{sec}
              </p>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-gray-700 text-left mt-4">
              <p className="font-semibold mb-1">📌 วิธีจ่ายเงิน:</p>
              <p>1. เปิด app ธนาคารของคุณ</p>
              <p>2. สแกน QR Code ด้านบน</p>
              <p>3. ยืนยันการโอนเงิน</p>
              <p className="text-orange-700 mt-2">
                ⏳ หลังโอนเสร็จ ระบบจะยืนยันอัตโนมัติ
                {mode === 'manual' && ' (หรือแม่ค้าจะยืนยันให้)'}
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 mt-4 text-xs text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              รอการชำระเงิน...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
