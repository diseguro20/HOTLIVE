# Payments Edge Function

Deploy with Supabase CLI after linking the project:

```sh
supabase functions deploy payments --no-verify-jwt
```

The function validates user JWTs itself for purchase/status routes because the
Vizzion webhook route must remain public. Set every server variable documented
in `.env.example` as a Supabase secret before deploying.

Production endpoints:

- `POST /functions/v1/payments/coin-purchases`
- `GET /functions/v1/payments/coin-purchases/:id`
- `POST /functions/v1/payments/webhooks/vizzion`
