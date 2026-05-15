import QRCode from 'qrcode';

export type QrTable = {
  id: string;
  table_number: number;
  label: string | null;
  qr_token: string;
};

export function buildTableUrl(slug: string, qrToken: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${base}/r/${slug}/${qrToken}`;
}

export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

export const SCAN_TEXTS = {
  th: 'สแกนเพื่อสั่งอาหาร',
  en: 'Scan to order',
  zh: '扫码点餐',
  ja: 'スキャンして注文',
  ko: '스캔하여 주문',
};
