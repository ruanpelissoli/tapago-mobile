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
  hooks/                # useAuth (React Context; no state library yet)
  services/             # env config; API client lands here
  theme/                # Colours, spacing, type scale
app.json                # Static Expo config (app name, icons, plugins)
app.config.ts           # Dynamic config — injects env values into `extra`
```

Each directory above has a `CLAUDE.md` with the decisions and gotchas behind it.

## Configuration

`API_BASE_URL` flows from `.env` → `app.config.ts` → `expo-constants` → `src/services/env.ts`.

Only `EXPO_PUBLIC_`-prefixed variables reach the app, and they are **inlined into the
shipped bundle** — never put secrets in `.env`. Changing `.env` needs a restart with a
cleared cache: `npx expo start --clear`.

## Current state

Navigation shell only. `sign-in` and `home` are text stubs, and auth state is in-memory,
so the app starts signed out on every launch. Real credentials, token persistence and
the dashboard land in follow-up tasks.

## Notes

- Native `ios/` and `android/` directories are generated via `npx expo prebuild` and are
  not committed — this is a managed workflow.
- Do not add a `babel.config.js` referencing `babel-preset-expo`; in SDK 57 that preset
  is not resolvable from the project root and a hand-written config breaks bundling.
- `package.json` pins `react-dom` via `overrides` to match `react`. `expo-router` pulls
  web-only Radix packages that otherwise drag in a mismatched `react-dom` and make
  `npm ci` fail.
