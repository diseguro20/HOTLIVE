# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Vizzion Pay

The coin store is wired to `/api/payments`, served by Vite in development and preview so gateway credentials never go into browser code.

1. Copy `.env.example` to `.env.local`.
2. Keep `VIZZION_PAY_MOCK=true` while testing the UI without credentials.
3. To use the real gateway, set `VIZZION_PAY_MOCK=false` and fill `VIZZION_PAY_PUBLIC_KEY` and `VIZZION_PAY_SECRET_KEY` with credentials created in Vizzion Pay under Integrations > API.
4. The integration uses `POST /gateway/pix/receive` to create charges and `GET /gateway/transactions?id=:id` to check their status.
5. In production, run these routes on a persistent backend, point `VITE_PAYMENT_API_BASE` to it, configure `VIZZION_PAY_WEBHOOK_URL`, and keep every `VIZZION_PAY_*` secret only on the server.

## Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the project's SQL Editor.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
4. Restart the Vite server.

Browser clients can read their balance but cannot change it directly. Payment
credits must be written by a trusted webhook using the Supabase service role.
