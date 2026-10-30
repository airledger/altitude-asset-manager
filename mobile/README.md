# Air Ledger phone apps

The iPhone and Android apps wrap the web app in the repo root with [Capacitor](https://capacitorjs.com). There is one codebase: change `index.html` and the website and both apps get the change.

## What the apps add
- `native.js` (repo root): live QR scanning, 8am service-due and leak-check reminders, exports through the phone's share sheet, safe-area layout. It does nothing on the website.
- `offline.js` (repo root): keeps the last synced records on the device and queues changes made without signal. Used on the website too.
- `scripts/build-web.mjs`: copies the web files into `www/` and swaps the CDN scripts for local copies, so the app opens with no signal.

App ID: `uk.co.airledger.app`. Icons and splash screens come from `assets/` (run `npm run assets` after changing them).

## Run it on your own phone
You need Node 22 or later.

```sh
cd mobile
npm install
npm run ios       # builds, syncs and opens Xcode (Mac only)
npm run android   # builds, syncs and opens Android Studio
```

- **iPhone:** in Xcode, pick the App target, then Signing & Capabilities, then choose your team (a free Apple ID works for testing on your own phone). Plug in your iPhone and press Run.
- **Android:** every pull request builds a test APK. Open the "Android test build" run on GitHub, download `air-ledger-android-test` from Artifacts, and open the APK on the phone.

## Releasing
1. Bump `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in Xcode and `versionName`/`versionCode` in `android/app/build.gradle`.
2. iPhone: Xcode, Product, Archive, then Distribute App to App Store Connect (TestFlight first).
3. Android: Android Studio, Build, Generate Signed App Bundle, then upload the `.aab` to Google Play internal testing. Keep the upload keystore safe; losing it means you can't update the app.
