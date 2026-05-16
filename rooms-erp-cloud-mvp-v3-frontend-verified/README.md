# ROOM'S ERP Cloud MVP

Bu paket, Room's Interior ERP prototipini **canlıya alınabilir bulut MVP** seviyesine taşımak için hazırlanmıştır.

## İçerik

- Express.js backend
- PostgreSQL veritabanı
- JWT + server-side session kontrolü
- Rol bazlı temel yetki
- Sipariş, üretim QR, depo/sevk, stok, cari, tedarikçi, kasa, gider, personel ve rapor API'leri
- Basit API-first web paneli
- Eski tek dosyalı prototip referansı: `/legacy-phase3.html`
- Railway + Neon/Railway Postgres uyumlu deploy yapısı

## Lokal kurulum

```bash
cp .env.example .env
# .env içindeki DATABASE_URL ve JWT_SECRET değerlerini doldur
npm install
npm run migrate
npm run seed
npm start
```

Tarayıcı:

```text
http://localhost:3001
```

İlk kullanıcı `.env` içindeki değerlerden oluşur. Varsayılan örnek:

```text
admin / ChangeMe123!
```

İlk girişten sonra şifre değiştirmen gerekir.

## Canlı deploy için kısa yol

1. Neon veya Railway Postgres içinde bir PostgreSQL veritabanı oluştur.
2. `DATABASE_URL` bağlantı adresini al.
3. Bu projeyi GitHub'a yükle.
4. Railway'de yeni Node.js servis olarak deploy et.
5. Railway Variables bölümüne şu değerleri gir:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=çok-uzun-rastgele-bir-secret
NODE_ENV=production
APP_URL=https://senin-railway-domainin
CORS_ORIGIN=https://senin-railway-domainin
COOKIE_SECURE=true
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=ilk-kurulum-şifren
SEED_ADMIN_NAME=ROOM'S Admin
```

Railway start command zaten `railway.json` içinde tanımlıdır:

```bash
npm run migrate && npm run seed && npm start
```

## Önemli güvenlik notları

- `JWT_SECRET` kesinlikle güçlü ve uzun olmalı.
- İlk admin şifresi deploy sonrası hemen değiştirilmeli.
- Gerçek işletme verisi girmeden önce backup planı kurulmalı.
- Bu paket e-fatura/e-defter gibi resmi muhasebe entegrasyonu içermez; operasyonel ERP + ticari takip çekirdeğidir.

## Mimari

Ayrıntılar için:

- `docs/DEPLOYMENT.md`
- `docs/API.md`
- `docs/DATA_MODEL.md`
- `docs/NEXT_STEPS.md`

## v1.1.0 hardening notes

Bu paket Claude tarafından önerilen fikirler incelenerek yeniden sertleştirildi. Doğrudan kopya kod kullanılmadı; akıllı tırnak, endpoint sırası, ödeme bağlantısı, bordro formülü ve satın alma belgesi/stok hareketi ayrımı gibi hatalar düzeltilerek uygulandı.

### Eklenen / düzeltilen ana noktalar

- `/api/purchases` modülü eklendi.
- Satın alma artık yalnızca stok hareketi değil, `purchase_documents` + `purchase_items` + stok hareketi + tedarikçi cari kaydı şeklinde atomik işlenir.
- Peşin satın alma ödemesi artık fatura hareketine değil, ödeme hareketine bağlı kasa çıkışı üretir.
- Tedarikçi işlemlerinde hesap tipi doğrulanır; müşteri kartına yanlışlıkla tedarikçi faturası/ödemesi girilemez.
- Malzemenin varyantı yoksa otomatik `Standart` varyant oluşturulur; stok girişi boşa düşmez.
- Kasa virmanı kanal bakiyelerinde doğru etki eder: kaynak azalır, hedef artar.
- Puantaj QR akışında önceki günden açık kayıt varsa sistem otomatik kapatmaz; yönetici müdahalesi ister.
- Puantaj saat hesaplarında `BUSINESS_TIMEZONE` / `Europe/Istanbul` dikkate alınır.
- Bordro formülü Room's kuralına göre düzenlendi: %95 tolerans; %95 altı kayıp oranı × 2 maaş kesinti oranı.
- `payroll-run` artık frontend’den gelen net tutara güvenmez; net maaşı backend kendisi hesaplar.
- Aynı personel için aynı ayda mükerrer maaş ödemesini engelleyen unique index eklendi.
- API 404 sırası düzeltildi; bilinmeyen `/api/...` istekleri artık HTML değil JSON hata döndürür.
- Frontend’e basit satın alma ekranı eklendi.

### Migration

Mevcut veritabanı için sadece:

```bash
npm run migrate
```

yeterlidir. Yeni migration `002_hardening_purchases_payroll.sql` otomatik uygulanır.
