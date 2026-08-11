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
  +not-found.tsx
src/
  components/           # Shared presentational UI
  hooks/                # useAuth (React Context), useGoogleSignIn
  services/             # env config, apiClient, authService
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

Sign-in works end to end against the API, but the session is **in-memory only** — nothing
is persisted, so the app starts signed out on every launch. Email/password credentials,
token persistence (`expo-secure-store`) and the dashboard land in follow-up tasks;
`home` is still a stub.

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
