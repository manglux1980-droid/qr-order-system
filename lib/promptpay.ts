/**
 * PromptPay QR Code generator
 * Generates EMV QR Code Specification compliant payload for Thai PromptPay
 *
 * Reference: https://github.com/dtinth/promptpay-qr
 */

function crc16(s: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

function formatTarget(id: string): { tag: string; value: string } {
  // Remove all non-digit characters
  const digits = id.replace(/\D/g, '');

  // Mobile phone (10 digits, starts with 0) → convert to E.164: 66XXXXXXXXX (13 digits with 0066)
  if (digits.length === 10 && digits.startsWith('0')) {
    return { tag: '01', value: `0066${digits.substring(1)}` };
  }

  // Citizen ID (13 digits)
  if (digits.length === 13) {
    return { tag: '02', value: digits };
  }

  // Tax ID (13 digits, same format as citizen ID)
  // E-wallet (15 digits)
  if (digits.length === 15) {
    return { tag: '03', value: digits };
  }

  throw new Error('Invalid PromptPay ID format');
}

/**
 * Generate PromptPay QR payload (text to encode in QR code)
 * @param promptpayId - 10-digit phone number (with leading 0) or 13-digit citizen/tax ID
 * @param amount - Amount in THB (optional)
 * @returns QR payload string ready to encode
 */
export function generatePromptPayPayload(promptpayId: string, amount?: number): string {
  const target = formatTarget(promptpayId);

  // Payload format indicator
  let payload = tlv('00', '01');
  // Point of initiation method: 11 = static, 12 = dynamic (amount included)
  payload += tlv('01', amount ? '12' : '11');

  // Merchant account information (PromptPay)
  const merchantAccount =
    tlv('00', 'A000000677010111') + // AID for PromptPay
    tlv(target.tag, target.value);
  payload += tlv('29', merchantAccount);

  // Country code
  payload += tlv('58', 'TH');
  // Currency: 764 = THB
  payload += tlv('53', '764');

  // Transaction amount (if provided)
  if (amount !== undefined && amount > 0) {
    payload += tlv('54', amount.toFixed(2));
  }

  // Add CRC placeholder
  payload += '6304';

  // Calculate CRC16-CCITT and append
  const crc = crc16(payload);
  payload += crc;

  return payload;
}

/**
 * Validate PromptPay ID format
 */
export function isValidPromptPayId(id: string): boolean {
  const digits = id.replace(/\D/g, '');
  // Phone (10 digits starting with 0) or citizen ID (13) or e-wallet (15)
  return (
    (digits.length === 10 && digits.startsWith('0')) ||
    digits.length === 13 ||
    digits.length === 15
  );
}
