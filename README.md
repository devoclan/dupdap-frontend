# DupDub Frontend

> Merchant dashboard and customer payment portal for the DupDub crypto-to-fiat settlement platform.

This is the Next.js app merchants use to manage payments and settlements, and the page customers land on to pay a merchant with USDC on Stellar. It talks exclusively to the [`dupdap-backend`](../dupdap-backend) REST API — there is no direct on-chain write path from the frontend itself beyond what the customer's wallet signs.

Related repos:
- [`dupdap-backend`](../dupdap-backend) — the API this app calls (`NEXT_PUBLIC_API_URL`)
- [`dupdapp_stellar`](../dupdapp_stellar) — the Soroban contracts (`payment_escrow`, etc.) that the customer payment flow ultimately settles into

## Why Stellar

The customer-facing payment flow here is built around Stellar, not a generic multi-chain wallet connector:

- **One asset, one chain to reason about** — the payment page only needs to handle Stellar/USDC, so there's no chain-switching UX, no gas-token juggling, and no per-network RPC config on the client.
- **Sub-second-feeling confirmations** — Stellar's ~5s ledger close means the "waiting for payment" state on `/pay/[paymentId]` resolves fast enough to keep a checkout flow feeling responsive.
- **Escrow, not a bare wallet transfer** — the customer flow is approve → deposit into the `payment_escrow` Soroban contract, not a raw transfer to a merchant address, so funds are held under contract logic until settlement conditions are met (see [`dupdapp_stellar`](../dupdapp_stellar)).
- **Fees low enough for small payments** — near-zero base fees keep the platform viable for low-ticket merchant transactions.

## Component Architecture

The codebase separates code by **responsibility**, not by feature folder. Knowing which bucket a new file belongs in keeps the app navigable as it grows.

### Page components (`src/app`)

Files under `src/app` are **route entry points** for the Next.js App Router. A `page.tsx` owns the route's data fetching, layout composition, and route-level state; a `layout.tsx` wraps a subtree (e.g. the dashboard shell). Page components:

- Are the only place that should call `useQuery` for a route's primary data.
- Compose shared components and hooks — they should stay thin and delegate real logic downward.
- Are **not** imported by other components. If something needs to be reused, it belongs in `src/components`.

### Shared components (`src/components`)

Reusable, presentational-or-lightly-stateful building blocks used across multiple pages (e.g. `ConfirmDialog`, status badges, tables, form fields). Shared components:

- Receive data via props and avoid reaching into global stores directly where a prop would do.
- Live in `src/components` and are imported by pages and other shared components.
- Should be generic — if a component is only ever used by one page, keep it colocated with that page until a second consumer appears.

### Hooks (`src/lib` / `use*` files)

Custom React hooks encapsulate reusable stateful behavior (e.g. `useFocusTrap`). A hook:

- Is named `useSomething` and lives alongside the code it supports (currently `src/lib`).
- Owns side effects, refs, and lifecycle logic so components stay declarative.
- Should not render UI — it returns values/handlers the component wires up.

### Utils (`src/lib`)

Pure, framework-agnostic helpers with no React dependency: formatting, `className` merging (`clsx` + `tailwind-merge`), error-message extraction, and shared constant maps (`STATUS_COLORS`, etc.). Utils:

- Are plain functions/constants — no hooks, no JSX.
- Are the canonical home for logic used in more than one place; extend the shared module rather than copying it per-page.

### File naming conventions

- **Files and directories: `kebab-case`** — e.g. `confirm-dialog.tsx`, `use-focus-trap.ts`, `payment-status-badge.tsx`. Route segments follow the same rule (`forgot-password`, `reset-password`).
- **React components: `PascalCase`** — the exported component is `ConfirmDialog`, `PaymentStatusBadge`, etc., even though the file is `confirm-dialog.tsx`.
- **Hooks: `camelCase` with a `use` prefix** — `useFocusTrap`, exported from a kebab-case file.
- **Utils/constants: `camelCase`** for functions (`getErrorMessage`) and `SCREAMING_SNAKE_CASE` for constants (`STATUS_COLORS`).

### State management patterns

- **Global client state → Zustand** (`src/lib/store.ts`). Auth (`token`, `merchant`) is the only global state, persisted to `localStorage` under `dupdub-auth`. Reach for Zustand only for state that genuinely spans routes (auth, theme, etc.) — not for per-page data.
- **Server state → `useQuery`** (TanStack Query). Payment lists, analytics, settlements, and any other backend data are fetched and cached per-page via `useQuery`, calling the grouped helpers in `src/lib/api.ts`. This gives caching, background refetch, and loading/error states without hand-rolled `useEffect` fetching.
- **Local UI state → `useState`/`useReducer`** inside the component that owns it (modals open/closed, form inputs).

Rule of thumb: if the data comes from the API, it's `useQuery`; if it must survive navigation and isn't server-owned, it's Zustand; otherwise keep it local.

## Architecture

### App structure (`src/app`, Next.js App Router)

```
/                       marketing/landing page
/waitlist               public waitlist signup
/auth/login             merchant login
/auth/register          merchant registration
/auth/forgot-password   request a password reset link
/auth/reset-password    set a new password from a reset link
/pay/[paymentId]        customer-facing payment page (approve → deposit → status → receipt)
/dashboard              merchant dashboard shell (layout.tsx wraps the routes below)
  /dashboard            overview
  /dashboard/payments   payment list/detail
  /dashboard/settlements merchant settlement tracking
  /dashboard/analytics  revenue/conversion analytics
  /dashboard/webhooks   webhook endpoint management
  /dashboard/settings   profile, API keys, notification prefs
  /dashboard/admin      internal/admin views
    /dashboard/admin/settlements
```

### State & data flow

- **`src/lib/api.ts`** — a single Axios instance (`NEXT_PUBLIC_API_URL`, default `http://localhost:3000/api/v1`) with:
  - a request interceptor that attaches `Authorization: Bearer <token>` from the Zustand auth store (single source of truth)
  - a response interceptor that calls `logout()` on the auth store and redirects to `/auth/login` on `401`
  - grouped API helpers (`authApi`, `paymentsApi`, …) rather than ad-hoc fetches scattered through components
- **`src/lib/store.ts`** — Zustand + `persist` for auth state (`token`, `merchant`), persisted to `localStorage` under the `dupdub-auth` key. This is the only global client state; everything else (payment lists, analytics, etc.) is fetched per-page through `api.ts`.

### `src/lib` overview

- **`src/lib/api.ts`** — the Axios instance and grouped API helpers described above.
- **`src/lib/store.ts`** — the Zustand auth store described above.
- **`src/lib/errors.ts`** — the app-wide error-message utility. Pages and components should extract user-facing error text via `getErrorMessage` from this module.
- **`src/lib/utils.ts`** — shared formatting/className helpers (`clsx` + `tailwind-merge`).

> **Error handling:** always import `getErrorMessage` from `src/lib/errors.ts`. It is the single app-wide helper — `utils.ts` deliberately does not export a same-named variant, so an import from the wrong module fails the type-check instead of silently changing behavior.

### Auth token security

The access token is persisted in `localStorage` via Zustand. Any XSS vector can read it synchronously. Mitigations in this repo:

- **Single storage key** — the Axios client reads from `useAuthStore`, not a duplicate `access_token` key, so 401 logout and UI auth state stay in sync.
- **CSP headers** — `next.config.js` sets a restrictive Content-Security-Policy (plus `X-Frame-Options`, `Referrer-Policy`) to reduce XSS blast radius.
- **Recommended long-term fix** — move to an `httpOnly`, `SameSite=Strict` session cookie issued by `dupdap-backend`, with the frontend never handling the raw JWT.

### Conventions

Several helpers exist in more than one place in this codebase. To keep new work from adding a third copy, use the canonical source below and extend it in place rather than redefining it per-page:

- **Error messages** — import `getErrorMessage` from `src/lib/errors.ts`. That is the only `getErrorMessage` in the repo; do not add a same-named helper to `utils.ts` or any page. If you need to change error-message behavior, change it in `errors.ts`.
- **Status colors/icons** — import `STATUS_COLORS`, `STATUS_ICONS`, and `DEFAULT_STATUS_COLOR` from `src/lib/utils.ts`. Do not redefine per-page status→color or status→icon maps; add new statuses to the shared maps in `utils.ts` so every page stays consistent.
- **Destructive confirmations** — use the shared `ConfirmDialog` component rather than `window.confirm`. It matches the app's styling, is accessible, and keeps confirmation UX consistent across the dashboard.
- **Overlays (modal, off-canvas drawer)** — wrap the panel with `useFocusTrap` from `src/lib/useFocusTrap.ts` and add an Escape handler. The dashboard's mobile nav drawer does both, so focus moves into the drawer on open, cycles within it on Tab/Shift+Tab, and returns to the hamburger button on close. Panels should carry `role="dialog"` and `aria-modal="true"`.

When in doubt, grep for the helper name first — if it already exists in `src/lib`, reuse it instead of writing a local copy.

### Customer payment flow (`/pay/[paymentId]`)

1. Approve USDC allowance for the escrow contract (`approve(escrow_contract, amount)`)
2. Deposit into escrow (`deposit()`), which pulls funds via `transfer_from`
3. Customer confirms/signs in their own wallet — the app never touches a private key
4. Frontend polls the backend for payment status (`GET /payments/:id/status`) until it's confirmed/settled
5. Receipt view once settled

### Images

There are no `<img>` tags or image files in the codebase today — icons come from `lucide-react` and QR codes are rendered inline by `qrcode.react`. When the first real image is added (merchant logos, avatars, marketing assets), use Next.js's `next/image` component:

```tsx
import Image from 'next/image';

// Local asset (placed in /public):
<Image src="/logo.png" alt="Merchant logo" width={120} height={40} />

// Remote asset — hostname must be allow-listed in next.config.js first:
<Image src="https://cdn.example.com/avatar.jpg" alt="Avatar" width={48} height={48} />
```

Why `next/image` over a plain `<img>`:
- Automatic format conversion (WebP/AVIF) and responsive `srcset` generation
- Built-in lazy loading with a low-quality placeholder option
- Prevents Cumulative Layout Shift via required `width`/`height` (or `fill` layout)

**Adding a remote image domain:** edit the `remotePatterns` array in `next.config.js` — Next.js throws a hard error at build time for any remote hostname not explicitly listed there. The array is already wired up (currently empty); add an entry for each CDN or image host as you introduce it.

## Tech stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS (custom `brand` color scale in `tailwind.config.ts`)
- **State**: Zustand (with `persist` for auth)
- **HTTP**: Axios, with interceptors for auth + 401 handling
- **Blockchain**: `@stellar/stellar-sdk` (client-side Stellar operations for the paymen

/* … truncated 4282 chars — edit only what you need near the top … */
