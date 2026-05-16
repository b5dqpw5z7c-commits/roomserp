# Veri Modeli Özeti

Ana tablolar:

- `users`, `sessions`
- `orders`, `production_events`
- `materials`, `material_variants`, `stock_movements`, `consumption_rules`
- `accounts`, `account_transactions`, `cash_transactions`, `allocations`
- `expenses`
- `employees`, `attendance_logs`, `employee_transactions`
- `notifications`, `audit_log`, `app_settings`

## Muhasebe mantığı

Kâr-zarar ve kasa ayrıdır.

- Satış tahakkuku: müşteri hesabına debit, kâr-zarara satış olarak girer.
- Tahsilat: müşteri hesabına credit, kasaya giriş girer.
- Tedarikçi faturası: tedarikçi hesabına credit, alış/maliyet olarak girer.
- Tedarikçi ödemesi: tedarikçi hesabına debit, kasadan çıkış girer.
- Gider: gider tablosuna girer; ödenmişse kasadan çıkış da oluşur.

## Üretim mantığı

- İş kabul: `production_events.accept`
- İş tamamlama: `production_events.complete`
- Depo kabul: `warehouse_accept`
- Sevk: `ship`
- Sevkte müşteri hesabı varsa otomatik satış tahakkuku oluşur.

## Stok mantığı

Üretim tamamlamadan önce `consumption_rules` üzerinden stok yeterlilik kontrolü yapılır. Stok yetersizse işlem durur.
