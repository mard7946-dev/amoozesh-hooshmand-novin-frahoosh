# Frahoosh Novin Android shell

This is a separate Android application for the Frahoosh Novin web portal.

- Application ID: `ir.frahoosh.novin`
- Start URL: `https://frahoosh.ir/`
- Minimum Android: API 24
- The app keeps the existing web portal, Supabase login flow, role panels and school pages as the source of truth.
- WebView navigation is restricted to HTTPS pages on `frahoosh.ir` and `www.frahoosh.ir`; other links are opened externally.
- Camera and microphone permissions are granted only after an Android runtime prompt and only to the trusted Frahoosh origin.
- File inputs are supported through the Android document picker.
- No service-role key, database password or other server secret is embedded in the APK.

## Classroom compatibility note

The existing classroom page and its JavaScript are intentionally not modified. Camera/microphone access is handled through WebView permission callbacks. The web Screen Capture API (`getDisplayMedia`) is not supported on Android WebView or Chrome for Android according to current compatibility data. Therefore screen sharing from Android is not claimed as supported in this initial shell. Desktop classroom behavior remains unchanged. A native Android MediaProjection/WebRTC integration would require a separately reviewed classroom adapter and explicit regression testing; it is not silently substituted here.

## Build

From this directory with JDK 17 and Gradle 8.9:

```sh
gradle assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
