# TaPago Mobile

React Native + Expo (SDK 57) app for TaPago, using `expo-router` file-based navigation.

## Getting started

```bash
npm install
cp .env.example .env   # adjust EXPO_PUBLIC_API_BASE_URL if needed
npx expo start
```

Then press `i` for the iOS simulator or `a` for the Android emulator.

> Android emulators reach your host machine at `10.0.2.2`, not `localhost`.

## Scripts

| Script              | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm start`         | Start the Metro dev server                    |
| `npm run ios`       | Start and open the iOS simulator              |
| `npm run android`   | Start and open the Android emulator           |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm run lint`      | ESLint (`eslint-config-expo`)                 |
| `npm run doctor`    | `expo-doctor` project health checks           |

## Project structure

```
app/                    # Routes — the directory tree IS the navigation graph
  _layout.tsx           #   Root: providers + headerless stack
  index.tsx             #   Entry redirect, based on auth state
  (auth)/sign-in.tsx    #   Unauthenticated screens
  (app)/home.tsx        #   Authenticated screens, behind the auth guard
  (app)/create-bet.tsx  #   Create-bet step 1 (+ create-bet-payment.tsx stub)
  +not-found.tsx
src/
  components/           # Shared presentational UI
  domain/               # Bet rules: goal-type enum, bounds, input parsing (pure)
  hooks/                # useAuth (React Context), useGoogleSignIn
  services/             # env config, apiClient, authService, sessionStorage
  theme/                # Colours, spacing, type scale
app.json                # Static Expo config (app name, icons, plugins)
app.config.ts           # Dynamic config — injects env values into `extra`
```

Each directory above has a `CLAUDE.md` with the decisions and gotchas behind it.

## Configuration

Config flows from `.env` → `app.config.ts` → `expo-constants` → `src/services/env.ts`.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Backend base URL, no trailing slash |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth client ID for iOS |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Google OAuth client ID for Android |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth "web application" client ID |

Only `EXPO_PUBLIC_`-prefixed variables reach the app, and they are **inlined into the
shipped bundle** — never put secrets in `.env`. Changing `.env` needs a restart with a
cleared cache: `npx expo start --clear`.

The Google client IDs are public identifiers rather than secrets, but each one must also
appear in the backend's `GOOGLE_CLIENT_IDS` — it becomes the ID token's `aud` claim, and
the API rejects an audience it doesn't recognise. Leave them blank to hide the Google
button.

## Sign-in

`(auth)/sign-in.tsx` offers Google and Apple sign-in. Each provider SDK runs its own
OAuth flow and returns an ID token, which the app exchanges at `POST /auth/google` or
`POST /auth/apple` for a TaPago JWT.

Both need native configuration, so **social sign-in does not work in Expo Go** — use a
development build (`npx expo run:ios` / `run:android`). Apple Sign-In additionally
requires the entitlement enabled by `ios.usesAppleSignIn`, and its button is rendered
only on iOS 13+, per Apple's guidelines.

## Current state

Sign-in works end to end against the API and the session **persists across restarts** —
the JWT and user are stored in `expo-secure-store` and restored on cold start, so a
signed-in user stays signed in. The restore is optimistic: token expiry is not checked,
and no request attaches an `Authorization` header yet. Email/password credentials,
`401`-driven sign-out and the dashboard land in follow-up tasks; `home` is still a stub —
it exists to offer a "Create bet" button.

**Create bet** is at step 1: `(app)/create-bet.tsx` collects a goal type, a target-day
count (1–365, default 30) and a BRL stake (R$ 1,00 – R$ 1.000,00, comma or dot accepted),
validates locally, and passes the values to `(app)/create-bet-payment.tsx` as router params
with money as integer centavos. That payment screen is a **stub** that echoes what it
received — real card selection and the `POST /v1/bets` call are a follow-up task. The rules
live in `src/domain/` and are deliberately pure.

There is no test runner in this project yet. `npm run typecheck` and `npm run lint` are
the checks that exist; both must pass.

## Notes

- Native `ios/` and `android/` directories are generated via `npx expo prebuild` and are
  not committed — this is a managed workflow.
- Do not add a `babel.config.js` referencing `babel-preset-expo`; in SDK 57 that preset
  is not resolvable from the project root and a hand-written config breaks bundling.
- `package.json` pins `react-dom` via `overrides` to match `react`. `expo-router` pulls
  web-only Radix packages that otherwise drag in a mismatched `react-dom` and make
  `npm ci` fail.
