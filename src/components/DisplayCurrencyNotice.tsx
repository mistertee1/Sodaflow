import { useDisplayMoney } from '../context/useDisplayMoney';
export function DisplayCurrencyNotice({ onSettings }: { onSettings: () => void }) {
  const { quote } = useDisplayMoney();
  if (!quote) return null;
  return <aside aria-label="عملة العرض المعتمدة" data-testid="display-currency-notice" className="sf-card p-3 mb-4 text-xs flex flex-wrap items-center gap-2 justify-between">
    <p>عملة النظام: <b>{quote.currency}</b> · السعر اليدوي المعتمد: <bdi dir="ltr">1 USD = {quote.units_per_usd} {quote.currency}</bdi>. عند اختلاف قيمة الدفترين يظهر مقابل كل دفتر باسمه؛ لا يُجمعان. المستندات الأصلية تحتفظ بعملتها وصرفها.</p>
    <button type="button" className="sf-secondary shrink-0" onClick={onSettings}>تغيير العملة والسعر</button>
  </aside>;
}
