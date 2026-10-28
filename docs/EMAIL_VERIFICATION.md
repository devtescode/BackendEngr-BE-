# Email verification

New student accounts must verify their email address before they can log in,
reset their password, or call authenticated `/engineering/*` endpoints.
Admin auth (`/admin/*`) is not affected.

## Flow

1. `POST /engineering/usersignup` creates the user with `isEmailVerified: false`,
   generates a random token (`crypto.randomBytes(32)`, 64 hex chars), stores only
   its SHA-256 hash with a 24h expiry, and emails the link
   `FRONTEND_URL/verify-email/<token>`. No JWT or user document is returned.
2. The frontend page `/verify-email/$token` calls `POST /engineering/verify-email/:token`
   (POST, so email link scanners that pre-fetch GET links can't consume it).
3. On success the user can log in. Re-opening the same link returns `ALREADY_VERIFIED`.
4. Users can request a new link via `POST /engineering/resend-verification`
   (60s cooldown per account). A new link invalidates the previous one.

## Endpoints and codes

All responses: `{ success, code?, message, email?, retryAfterSeconds? }`.

| Endpoint | Rate limit | Codes |
| --- | --- | --- |
| `POST /usersignup` | 10 / 15 min | 201 `VERIFICATION_SENT`, 201 `VERIFICATION_EMAIL_FAILED` (account kept; use resend), 409 `EMAIL_NOT_VERIFIED`, 409 `ACCOUNT_EXISTS` |
| `POST /userlogin` | — | 403 `EMAIL_NOT_VERIFIED` (after password check; no JWT) |
| `POST /verify-email/:token` | 20 / 15 min | 200 `EMAIL_VERIFIED`, 200 `ALREADY_VERIFIED`, 400 `TOKEN_EXPIRED` (includes `email`), 400 `TOKEN_INVALID` |
| `POST /resend-verification` `{email}` | 5 / 15 min | 200 `VERIFICATION_RESENT` (generic, also for unknown/verified emails), 429 `RESEND_COOLDOWN` (`retryAfterSeconds`), 503 `EMAIL_SEND_FAILED`, 400 invalid email |
| `POST /forgot-password`, `GET/POST /reset-password/:token` | existing | 403 `EMAIL_NOT_VERIFIED` for unverified accounts |
| Any route using `verifyToken` | — | 403 `EMAIL_NOT_VERIFIED` |

Any rate-limited endpoint can return 429 `RATE_LIMITED`.

## Environment variables

- `FRONTEND_URL` — origin used to build verification (and reset/payment) links.
  Trailing slashes are stripped. **In production it must be the public production
  frontend origin, never `localhost`.**
- `EMAIL_PROVIDER` — `gmail` or `sendbyte` (default).
- SendByte: `SENDBYTE_API_KEY`, `SENDBYTE_FROM`.
- Gmail: `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- `URI` — MongoDB connection string (also used by the migration script).

If email isn't configured, signup still creates the account and returns
`VERIFICATION_EMAIL_FAILED`; resend returns 503 `EMAIL_SEND_FAILED`.

## Legacy users

Strict by default: any user whose `isEmailVerified` is not exactly `true` —
including accounts created before this feature, which have no such field — is
treated as unverified and must verify (via resend) before logging in.

To grandfather existing accounts instead, run the opt-in script deliberately:

```sh
node scripts/mark-existing-users-verified.js          # dry run: prints how many would change
node scripts/mark-existing-users-verified.js --apply  # sets isEmailVerified:true, emailVerifiedAt:now
```

It only updates unverified documents that never received a verification token,
so accounts created under the new flow are never auto-verified. Run it once,
before or right after deploying, if legacy users should keep access without
verifying. If you deploy without running it, every existing user is asked to
verify on their next login (and current sessions get 403 until they do).

## Abandoned signups

A new-flow account that is still unverified 7 days after signup is deleted the
next time someone signs up with the same email, matric or phone number
(`UNVERIFIED_ACCOUNT_TTL_DAYS` in `Controllers/user.controllers.js`). This stops
anyone from permanently reserving another student's email, matric or phone.
Legacy accounts are never deleted by this.

## Production email setup

- **SendByte**: use a live key (`sk_live_...`; `sk_test_` keys are sandboxed and
  don't deliver). `SENDBYTE_FROM` must use an address on a domain verified in
  SendByte (SPF/DKIM records configured), or sends fail.
- **Gmail**: `GMAIL_APP_PASSWORD` must be a Google App Password (requires
  2-Step Verification), not the account password. Mail is sent from `GMAIL_USER`.
  Gmail has daily sending limits; prefer a verified-domain provider for production.
- Set `FRONTEND_URL` to the production frontend origin and confirm a test signup
  receives a working link.
- Raw tokens are never logged or stored; only their SHA-256 hash is in the database.
