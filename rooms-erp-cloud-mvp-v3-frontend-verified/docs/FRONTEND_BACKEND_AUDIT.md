# Frontend / Backend Fonksiyon Uyum Kontrolü

Bu sürümde `public/index.html` yeniden düzenlendi ve görünen butonların backend karşılıkları kontrol edildi.

## Doğrulanan ana akışlar

| Frontend işlem | Backend endpoint | Durum |
|---|---|---|
| Giriş | `POST /api/auth/login` | Eşleşiyor |
| Çıkış | `POST /api/auth/logout` | Eşleşiyor |
| Oturum kontrolü | `GET /api/auth/me` | Eşleşiyor |
| Şifre değiştirme | `POST /api/auth/change-password` | Eşleşiyor |
| Dashboard | `GET /api/reports/dashboard`, `GET /api/accounting/summary` | Eşleşiyor |
| Sipariş listesi | `GET /api/orders` | Eşleşiyor |
| Sipariş oluşturma | `POST /api/orders` | Eşleşiyor |
| İş kabul | `POST /api/orders/:id/stages/:stage/accept` | Eşleşiyor |
| İş tamamlama | `POST /api/orders/:id/stages/:stage/complete` | Eşleşiyor |
| Depo kabul | `POST /api/orders/:id/warehouse-accept` | Eşleşiyor |
| Sevk | `POST /api/orders/:id/ship` | Eşleşiyor |
| Cari / tedarikçi listesi | `GET /api/accounts?type=...` | Eşleşiyor |
| Cari / tedarikçi detay-ekstre | `GET /api/accounts/:id` | Eşleşiyor |
| Cari / tedarikçi kartı oluşturma | `POST /api/accounts` | Eşleşiyor |
| Müşteri tahsilatı | `POST /api/accounting/customer-collection` | Eşleşiyor |
| Tedarikçi faturası | `POST /api/accounting/supplier-invoice` | Eşleşiyor |
| Tedarikçi ödemesi | `POST /api/accounting/supplier-payment` | Eşleşiyor |
| Gider | `POST /api/accounting/expense` | Eşleşiyor |
| Kasa virmanı | `POST /api/accounting/cash-transfer` | Eşleşiyor |
| Kasa defteri | `GET /api/accounting/cashbook` | Eşleşiyor |
| Malzeme listesi | `GET /api/inventory/materials` | Eşleşiyor |
| Malzeme oluşturma | `POST /api/inventory/materials` | Eşleşiyor |
| Stok girişi | `POST /api/inventory/stock-entry` | Eşleşiyor |
| Stok hareketleri | `GET /api/inventory/movements` | Eşleşiyor |
| Satın alma listesi | `GET /api/purchases` | Eşleşiyor |
| Satın alma oluşturma | `POST /api/purchases` | Eşleşiyor |
| Personel listesi | `GET /api/hr/employees` | Eşleşiyor |
| Personel oluşturma | `POST /api/hr/employees` | Eşleşiyor |
| Kapı QR puantaj | `POST /api/hr/attendance-scan` | Eşleşiyor |
| Personel avans/ödeme | `POST /api/hr/employee-payment` | Eşleşiyor |
| Maaş önizleme | `GET /api/hr/employees/:id/payroll-preview` | Eşleşiyor |
| Maaş ödeme | `POST /api/hr/employees/:id/payroll-run` | Eşleşiyor |
| Ayarlar | `GET /api/settings`, `PUT /api/settings/:key` | Eşleşiyor |

## Bu sürümde yapılan frontend düzeltmeleri

- Manuel cari/tedarikçi UUID yazma zorunluluğu kaldırıldı; formlar artık listeden seçim yaptırıyor.
- Sipariş aksiyonları, siparişin gerçek aşamasına göre gösteriliyor.
- Aşama akışında yanlış sırada işlem yapılmasını azaltmak için frontend yönlendirmesi ve backend kontrolü birlikte güçlendirildi.
- Cari ve tedarikçi kartlarında doğrudan ekstre, tahsilat, fatura ve ödeme aksiyonları eklendi.
- Kasa virmanı, gider, stok girişi, satın alma, personel avans/ödeme ve maaş işlemleri görünür hale getirildi.
- Kullanıcı verileri HTML içine basılırken escape edildi.
- Frontend JavaScript syntax kontrolünden geçti.

## Backend tarafında yapılan akış düzeltmeleri

- Üretim aşama statü geçişi, tamamlanan aşamaya göre netleştirildi.
- Yanlış sırada aşama kabul/tamamlama engellendi.
- Sipariş detayında bulunamayan cari için düzgün 404 davranışı eklendi.

## Testler

- `npm run check` geçti.
- `npm test` geçti.
- `public/index.html` içindeki script `node --check` ile doğrulandı.

Not: Bu kontrol statik kod/syntax ve endpoint/payload eşleşmesi seviyesindedir. Gerçek canlı PostgreSQL üzerinde uçtan uca veri yazma testi için deploy sonrası test checklist uygulanmalıdır.
