type PayStrings = {
  title: string;
  checkout: (id: string) => string;
  markPaid: string;
  returnLabel: string;
};

const PAY: Record<string, PayStrings> = {
  en: {
    title: "Pay",
    checkout: (id) => `Testnet checkout for invoice ${id}.`,
    markPaid: "Mark paid (test only)",
    returnLabel: "Return to mailbox signup",
  },
  zh: {
    title: "支付",
    checkout: (id) => `测试网发票 ${id} 结账。`,
    markPaid: "标记已支付（仅测试）",
    returnLabel: "返回邮箱注册",
  },
  es: {
    title: "Pagar",
    checkout: (id) => `Pago de prueba para la factura ${id}.`,
    markPaid: "Marcar como pagado (solo prueba)",
    returnLabel: "Volver al registro del buzón",
  },
  ar: {
    title: "الدفع",
    checkout: (id) => `دفع تجريبي للفاتورة ${id}.`,
    markPaid: "تعليم كمدفوع (اختبار فقط)",
    returnLabel: "العودة إلى تسجيل صندوق البريد",
  },
  pt: {
    title: "Pagar",
    checkout: (id) => `Checkout de teste para a fatura ${id}.`,
    markPaid: "Marcar como pago (somente teste)",
    returnLabel: "Voltar ao cadastro da caixa de correio",
  },
  id: {
    title: "Bayar",
    checkout: (id) => `Checkout testnet untuk faktur ${id}.`,
    markPaid: "Tandai sudah dibayar (hanya uji)",
    returnLabel: "Kembali ke pendaftaran mailbox",
  },
  fr: {
    title: "Payer",
    checkout: (id) => `Paiement testnet pour la facture ${id}.`,
    markPaid: "Marquer comme payé (test uniquement)",
    returnLabel: "Retour à l'inscription de la boîte mail",
  },
  ja: {
    title: "支払い",
    checkout: (id) => `請求書 ${id} のテストネット決済。`,
    markPaid: "支払い済みにする（テストのみ）",
    returnLabel: "メールボックス登録に戻る",
  },
  fa: {
    title: "پرداخت",
    checkout: (id) => `تسویه تست‌نت برای فاکتور ${id}.`,
    markPaid: "علامت‌گذاری پرداخت‌شده (فقط آزمایش)",
    returnLabel: "بازگشت به ثبت‌نام صندوق پستی",
  },
};

export function payStrings(locale: string): PayStrings {
  return PAY[locale] ?? PAY.en!;
}
