# Deploying the SCOVRR API to Vercel

This backend is now prepared as a Vercel-compatible Express application. Create the Vercel project with `backend/` as the project root. Vercel will detect `src/app.js` and serve the exported Express app as a Node.js Function.

## Vercel project setup

1. Import the repository into Vercel.
2. Set **Root Directory** to `backend`.
3. Leave the framework preset and build command at their defaults.
4. Add the production environment variables listed below.
5. Deploy the project.

The API base URL for the mobile app will be:

```text
https://<your-vercel-project>.vercel.app/api/v1
```

Set that value as `EXPO_PUBLIC_API_URL` when building the app.

## Required production environment variables

Set these in Vercel under Project Settings → Environment Variables. Do not commit real values to `.env` or this repository.

```text
NODE_ENV=production
MONGODB_URI=<MongoDB Atlas connection string>
JWT_ACCESS_SECRET=<random value at least 32 characters>
JWT_REFRESH_SECRET=<different random value at least 32 characters>
CORS_ALLOWED_ORIGINS=https://<your-frontend-domain>
PAYSTACK_SECRET_KEY=<Paystack secret key>
PAYMENT_CALLBACK_URL=https://<your-frontend-domain>/payment/callback
MEDIA_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=<Cloudinary cloud name>
CLOUDINARY_API_KEY=<Cloudinary API key>
CLOUDINARY_API_SECRET=<Cloudinary API secret>
CRON_SECRET=<random scheduler secret>
```

The remaining settings can use the defaults in `.env.example`, then be overridden in Vercel when needed.

## Jobs and realtime limitations

Vercel Functions are request-based. They do not keep the existing Socket.IO server or `setInterval` worker alive between requests.

This deployment includes `GET /api/cron/jobs`, protected by:

```text
Authorization: Bearer <CRON_SECRET>
```

On a Vercel plan that supports frequent Cron Jobs, add this to `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/jobs", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel Hobby Cron Jobs are limited to once per day, which is not suitable for notification delivery, payouts, or reconciliation. For those features, use an external scheduler that calls the protected endpoint or run the existing `npm start` server on a long-lived host. The current chat UI already falls back to REST when Socket.IO is unavailable, but true realtime chat requires a separate WebSocket-capable host.

## Local verification

From the backend directory:

```bash
npm ci
npm test
npm start
```

Then check:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/v1
```

