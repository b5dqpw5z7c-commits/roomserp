# ROOM'S ERP Cloud API v2

Base path: `/api`

## Auth
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/change-password`

## Users
- `GET /users`
- `POST /users`

## Accounts
- `GET /accounts?type=customer|supplier`
- `GET /accounts/:id`
- `POST /accounts`

## Orders / Production
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `POST /orders/:id/stages/:stage/accept`
- `POST /orders/:id/stages/:stage/complete`
- `POST /orders/:id/warehouse-accept`
- `POST /orders/:id/ship`

## Inventory
- `GET /inventory/materials`
- `POST /inventory/materials`
- `POST /inventory/stock-entry`
- `GET /inventory/movements`

## Purchases
- `POST /purchases`
  - Atomik olarak satın alma belgesi, tedarikçi faturası, stok girişleri ve isteğe bağlı peşin ödeme/kasa çıkışı oluşturur.
- `GET /purchases`
- `GET /purchases/:id`

## Accounting
- `POST /accounting/customer-collection`
- `POST /accounting/supplier-invoice`
- `POST /accounting/supplier-payment`
- `POST /accounting/expense`
- `POST /accounting/cash-transfer`
- `POST /accounting/transactions/:id/reverse`
- `GET /accounting/cashbook`
- `GET /accounting/summary`

## HR
- `GET /hr/employees`
- `POST /hr/employees`
- `POST /hr/attendance-scan`
- `POST /hr/employee-payment`
- `GET /hr/employees/:id/payroll-preview?year=2026&month=5`
- `POST /hr/employees/:id/payroll-run`
  - Backend net maaşı kendisi hesaplar; client tarafından gönderilen net maaşa güvenmez.

## Reports / Settings
- `GET /reports/dashboard`
- `GET /settings`
- `PUT /settings/:key`
