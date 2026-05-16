# Deploy Planı

## Önerilen başlangıç

- Backend + frontend: Railway
- Database: Neon Postgres veya Railway Postgres
- SSL: Railway otomatik domain SSL
- Backup: ilk canlı kullanımda günlük Postgres backup/export planı

## Railway + Neon

1. Neon'da proje oluştur.
2. Connect ekranından pooled veya direct `DATABASE_URL` al.
3. Railway'de GitHub repo deploy et.
4. Variables bölümüne `.env.example` içindeki değerleri ekle.
5. İlk deploy migration + seed + server başlatır.

## Railway + Railway Postgres

1. Railway proje içinde PostgreSQL servisi ekle.
2. Railway app servisine PostgreSQL `DATABASE_URL` değişkenini bağla.
3. Diğer env değerlerini ekle.
4. Deploy et.

## Sağlıklı canlı kullanım için minimum kontroller

- `/api/health` 200 dönmeli.
- Login çalışmalı.
- İlk admin şifresi değiştirilmeli.
- Test cari, tedarikçi, sipariş, tahsilat, ödeme, stok kaydı girilmeli.
- Database backup planı kurulmalı.
