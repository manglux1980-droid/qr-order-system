'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Loader2, CheckCircle, CreditCard, DollarSign, QrCode } from 'lucide-react'
import type { Locale, PaymentMethod } from '@/lib/types'

interface Props {
  sessionId: string
  orderId: string
  amount: number
  locale: Locale
  onClose: () => void
  onSuccess: () => void
}

const t = (locale: Locale, th: string, en: string, zh: string, ja: string, ko: string) => {
  const map: Record<Locale, string> = { th, en, zh, ja, ko }
  return map[locale] || th
}

export default function PaymentModal({ sessionId, orderId, amount, locale, onClose, onSuccess }: Props) {
  const supabase = createClient()
  const [step, setStep] = useState<'select' | 'qr' | 'success'>('select')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [qrUrl, setQrUrl] = useState<string>('')
  const [paymentId, setPaymentId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Submit order to backend
  async function submitOrderToBackend() {
    // Order already submitted before this modal — just confirm via order_id
    return true
  }

  // Cash flow: just mark order as awaiting cashier
  async function payCash() {
    setLoading(true)
    await supabase.from('payments').insert({
      session_id: sessionId,
      restaurant_id: '',  // server will fill via trigger or use API
      method: 'cash',
      scope: 'full',
      amount,
      status: 'pending',
    })
    setLoading(false)
    setStep('success')
    setTimeout(onSuccess, 2000)
  }

  // PromptPay / Alipay flow
  async function payOnline(m: 'promptpay' | 'alipay_plus') {
    setLoading(true)
    setMethod(m)
    const res = await fetch('/api/payments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, method: m, amount }),
    })
    const data = await res.json()
    if (data.qr_image_url) {
      setQrUrl(data.qr_image_url)
      setPaymentId(data.payment_id)
      setStep('qr')
    }
    setLoading(false)
  }

  // Subscribe to payment status changes
  useEffect(() => {
    if (!paymentId) return
    const channel = supabase
      .channel(`payment-${paymentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'payments',
        filter: `id=eq.${paymentId}`,
      }, (payload) => {
        if (payload.new?.status === 'paid') {
          setStep('success')
          setTimeout(onSuccess, 2000)
        }
      })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [paymentId, supabase, onSuccess])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={step === 'select' ? onClose : undefined} />
      <div className="relative bg-white rounded-t-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">
            {step === 'select' && t(locale, 'เลือกวิธีชำระเงิน', 'Select Payment', '选择付款方式', 'お支払い方法', '결제 방법')}
            {step === 'qr' && t(locale, 'สแกน QR เพื่อชำระ', 'Scan QR to Pay', '扫码付款', 'QRコードをスキャン', 'QR 코드 스캔')}
            {step === 'success' && t(locale, 'สำเร็จ!', 'Success!', '成功！', '完了！', '완료!')}
          </h2>
          {step === 'select' && (
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
          )}
        </div>

        <div className="overflow-y-auto p-5">
          {/* Total */}
          <div className="text-center mb-5">
            <p className="text-xs text-gray-400 mb-1">
              {t(locale, 'ยอดรวม', 'Total', '总计', '合計', '합계')}
            </p>
            <p className="text-3xl font-bold text-gray-900">฿{amount.toLocaleString()}</p>
          </div>

          {/* SELECT step */}
          {step === 'select' && (
            <div className="space-y-2">
              <button
                onClick={() => payOnline('promptpay')}
                disabled={loading}
                className="w-full p-4 border-2 border-gray-200 hover:border-orange-500 rounded-2xl flex items-center gap-4 transition-colors disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-2xl">📱</div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">PromptPay</p>
                  <p className="text-xs text-gray-500">
                    {t(locale, 'สแกนผ่านแอพธนาคารไทย', 'Scan with Thai bank app', '泰国银行App扫码', 'タイの銀行アプリ', '태국 은행 앱')}
                  </p>
                </div>
              </button>

              <button
                onClick={() => payOnline('alipay_plus')}
                disabled={loading}
                className="w-full p-4 border-2 border-gray-200 hover:border-orange-500 rounded-2xl flex items-center gap-4 transition-colors disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-2xl">🌏</div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">Alipay+</p>
                  <p className="text-xs text-gray-500">
                    {t(locale, 'Alipay, TrueMoney, KakaoPay, GCash', 'Alipay, TrueMoney, KakaoPay, GCash', '支付宝, TrueMoney, KakaoPay, GCash', 'Alipay, TrueMoney, KakaoPay, GCash', 'Alipay, TrueMoney, KakaoPay, GCash')}
                  </p>
                </div>
              </button>

              <button
                onClick={payCash}
                disabled={loading}
                className="w-full p-4 border-2 border-gray-200 hover:border-orange-500 rounded-2xl flex items-center gap-4 transition-colors disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center text-2xl">💵</div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">
                    {t(locale, 'จ่ายที่แคชเชียร์', 'Pay at cashier', '到收银台付款', 'レジでお支払い', '카운터에서 결제')}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t(locale, 'เงินสด - แจ้งพนักงาน', 'Cash - notify staff', '现金 - 通知服务员', '現金 - スタッフへ', '현금 - 직원에게')}
                  </p>
                </div>
              </button>

              {loading && (
                <div className="flex items-center justify-center py-4 text-gray-400">
                  <Loader2 className="animate-spin mr-2" size={18} />
                  <span className="text-sm">{t(locale, 'กำลังโหลด...', 'Loading...', '加载中...', '読み込み中...', '로딩 중...')}</span>
                </div>
              )}
            </div>
          )}

          {/* QR step */}
          {step === 'qr' && (
            <div className="text-center">
              {qrUrl && (
                <div className="bg-white p-4 rounded-2xl border-2 border-gray-200 inline-block mb-4">
                  <img src={qrUrl} alt="QR Code" className="w-64 h-64 object-contain" />
                </div>
              )}
              <p className="text-sm text-gray-600 mb-2">
                {method === 'promptpay'
                  ? t(locale, 'เปิดแอพธนาคาร และสแกน QR นี้', 'Open your bank app and scan this QR', '打开银行App扫描此码', '銀行アプリでこのQRをスキャン', '은행 앱으로 이 QR을 스캔')
                  : t(locale, 'เปิด Alipay/TrueMoney/อื่นๆ และสแกน', 'Open Alipay/TrueMoney/etc. and scan', '打开支付宝等扫码', 'Alipay等を開いてスキャン', 'Alipay 등을 열어 스캔')}
              </p>
              <div className="flex items-center justify-center text-orange-500 mt-4">
                <Loader2 className="animate-spin mr-2" size={18} />
                <span className="text-sm font-medium">
                  {t(locale, 'รอการชำระเงิน...', 'Waiting for payment...', '等待付款...', '支払い待ち...', '결제 대기 중...')}
                </span>
              </div>
              <button
                onClick={onClose}
                className="mt-6 text-sm text-gray-500 underline"
              >
                {t(locale, 'ยกเลิก', 'Cancel', '取消', 'キャンセル', '취소')}
              </button>
            </div>
          )}

          {/* SUCCESS step */}
          {step === 'success' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="text-green-500" size={48} />
              </div>
              <p className="text-lg font-bold text-gray-900 mb-1">
                {method === 'cash'
                  ? t(locale, 'สั่งสำเร็จ!', 'Order placed!', '下单成功！', 'ご注文完了！', '주문 완료!')
                  : t(locale, 'ชำระเงินสำเร็จ!', 'Payment successful!', '付款成功！', 'お支払い完了！', '결제 완료!')}
              </p>
              <p className="text-sm text-gray-500">
                {method === 'cash'
                  ? t(locale, 'กรุณาแจ้งพนักงานเพื่อรับบิล', 'Please notify staff for your bill', '请通知服务员结账', 'スタッフにお声がけください', '직원에게 계산서를 요청하세요')
                  : t(locale, 'ขอบคุณที่ใช้บริการ', 'Thank you!', '谢谢惠顾', 'ありがとうございました', '감사합니다')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
