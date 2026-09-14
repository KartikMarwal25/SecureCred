# Enabling real authentication (2FA, OAuth, email verification)

SecureCred's identity layer is built on [Clerk](https://clerk.com). Right now, with no Clerk keys configured, the app runs in a local **dev-mode auth bypass** — `/sign-in` and `/sign-up` redirect to `/dev-login`, which only offers two fixed demo identities. This is intentional for local development, but it's why you can't currently register a real, distinct account.

Everything below — TOTP two-factor authentication, Google/GitHub sign-in, mandatory email verification — is built into Clerk's hosted UI components (`<SignIn/>`/`<SignUp/>`), which this app already uses. **None of it requires new code** — it's Dashboard configuration plus three keys pasted into `.env`.

## 1. Create a Clerk application

1. Go to [clerk.com](https://clerk.com) and create a free account, then create a new Application (e.g. "SecureCred").
2. In **API Keys** (left sidebar), copy the **Publishable key** and **Secret key**. You'll paste these in step 5.

## 2. Require email verification

**User & Authentication → Email, Phone, Username**:
- Ensure **Email address** is required.
- Under its settings, enable **"Verify at sign-up"** (verification code or link — either is fine). This is what makes a valid, confirmed email mandatory before anyone can use an account.

## 3. Enable TOTP two-factor authentication

**User & Authentication → Multi-factor**:
- Enable **"Authenticator application"** (TOTP — Google Authenticator, Authy, etc.).
- Choose whether it's optional (user can turn it on in their profile) or required for everyone. Clerk's MFA requirement is account-wide — there's no per-role toggle — so if you want it mandatory specifically for institution staff, the practical approach is to require it globally, since institution accounts are the higher-value target anyway.

## 4. Enable OAuth (social sign-in)

**User & Authentication → Social Connections**:
- Toggle on **Google** and/or any other provider you want. Clerk automatically adds "Continue with Google" etc. buttons to the hosted `<SignIn/>`/`<SignUp/>` components — no code changes needed.

## 5. Session token — add the custom claims this app reads

The API reads `role`, `institutionId`, `studentId`, `email`, and `fullName` off the verified session token (see `apps/api/src/adapters/clerk.adapter.js`). By default a Clerk session token doesn't include these. Go to **Sessions → Customize session token** and set it to:

```json
{
  "role": "{{user.public_metadata.role}}",
  "institutionId": "{{user.public_metadata.institution_id}}",
  "email": "{{user.primary_email_address}}",
  "fullName": "{{user.full_name}}"
}
```

Note: `institutionId`/`role` here are read as a **fallback only, for institution accounts** (see step 7) — for everyone else (self-registered students), the API resolves role/institution/student scope live from its own database on every request instead of trusting the token, specifically so a student's access can change (e.g. once an institution issues them a credential) without needing a new session token. You do not need to set `studentId` here at all; the database is always authoritative for it.

## 6. Webhook (optional, but recommended for production)

**Webhooks → Add Endpoint**:
- URL: `https://<your-public-api-host>/api/v1/webhooks/clerk`
- Events: `user.created`, `user.updated`
- Copy the **Signing Secret**.

This keeps the database in sync even for updates that don't happen via an authenticated API call. It is **not required for the app to work** locally — role/institution/student scope is resolved fresh from the database on every authenticated request regardless (see `apps/api/src/middleware/auth.mw.js`), so local development (where Clerk can't reach a webhook at `localhost`) doesn't depend on webhook delivery at all. If you do want to test webhooks locally, use Clerk's CLI (`npx clerk-cli listen`) or a tunnel like ngrok to forward `https://<tunnel>/api/v1/webhooks/clerk`.

## 7. Choosing a role (self-service)

A brand-new signed-up account has **no role at all** until they choose one — the frontend takes them to `/choose-role` right after sign-up/sign-in (see `apps/web/src/pages/public/RoleSelectionPage.jsx`), where they pick:

- **Student** — nothing further needed; their gallery starts empty until an institution issues them something.
- **Institution** — they provide an institution name and a short code (`POST /api/v1/auth/choose-role`, see `apps/api/src/routes/auth.routes.js`). If that code already exists, they join the existing institution as another staff member; otherwise a new institution row is created and they become its first staff account. This is intentionally self-service and auto-approved — **anyone can currently claim to be "an institution" and immediately get certificate-issuance rights.** That's a fine tradeoff for local testing/demo use, but a real public deployment should gate this behind manual review (e.g. hold new institution accounts at `account_status = 'DISABLED'` until someone approves them — the column already exists for exactly this) rather than auto-activating.

You can still set an account's role/institution directly via Clerk Dashboard metadata as an alternative (useful for fixing a mistake or scripting many accounts at once):

```json
{ "role": "institution", "institution_id": "<the institution's institution_id UUID>" }
```

This is only read as a fallback, though — the database (populated via `/choose-role` or this metadata path through the webhook) is what actually governs access on every request.

## 8. Paste the keys in

Fill in the repo-root `.env` (copy from `.env.example` if you haven't already):

```
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...        # only if you set up step 6
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...  # same publishable key, read by the frontend build
```

Restart the API (`npm run api:dev` or `docker compose up --build api`) and rebuild the frontend (`npm run web:build` or `docker compose up --build web`). `/sign-in` and `/sign-up` will now render Clerk's real hosted forms — with MFA, OAuth, and email verification exactly as configured above — instead of redirecting to `/dev-login`.
