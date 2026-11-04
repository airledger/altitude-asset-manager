# Air Ledger phone apps

The iPhone and Android apps wrap the web app in `apps/web` with [Capacitor](https://capacitorjs.com). There is one codebase: a change to the web app reaches the website and both apps.

What the apps add is in `apps/web/src/native.ts` (it does nothing on the website):

- live QR scanning with the camera instead of taking a photo;
- files (PDFs, CSVs, invoice exports) open the phone's share sheet;
- 8am service-due and F-gas leak-check notifications, planned on the phone whenever Home loads;
- links and QR codes point at the web address in `VITE_APP_URL`, because the app itself has none.

App ID: `uk.co.airledger.app`. Icons and splash screens come from `assets/` (`npm run assets -w @airledger/mobile` after changing them). The apps are built against beta until cut-over; `build:live` builds against the live database.

## Every change

The "Phone apps" GitHub workflow builds both apps from the beta web app:

- **Android:** download `air-ledger-android-beta` from the run's Artifacts, unzip it and open the APK on the phone (allow installing from your browser or Files when asked).
- **iPhone:** the run proves the app still builds. To put it on your phone, use Xcode below.

## iPhone, from a Mac

You need Xcode (free, from the Mac App Store) and Node 22 or later.

```sh
git clone https://github.com/airledger/altitude-asset-manager.git
cd altitude-asset-manager
npm ci
npm run ios -w @airledger/mobile   # builds the beta web app, syncs it and opens Xcode
```

In Xcode: choose the **App** target, open **Signing & Capabilities**, tick **Automatically manage signing** and pick your Apple ID as the team (Xcode → Settings → Accounts to add it). Plug the iPhone in, pick it at the top, and press Run. The first time, the iPhone asks you to trust the developer: Settings → General → VPN & Device Management. With a free Apple ID the app stops opening after 7 days; press Run again to renew it.

## Releasing (later)

1. Bump `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in Xcode and `versionName`/`versionCode` in `android/app/build.gradle`.
2. iPhone: needs an Apple Developer account. Xcode → Product → Archive → Distribute App → App Store Connect (TestFlight first).
3. Android: needs a Google Play developer account. Android Studio → Build → Generate Signed App Bundle, then upload the `.aab` to internal testing. Keep the upload keystore safe; losing it means the app can't be updated.
