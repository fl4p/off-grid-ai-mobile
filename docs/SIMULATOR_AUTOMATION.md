# Driving the iOS Simulator / Android Emulator (agent automation)

How an agent (or CI) can drive the running app end-to-end — tap, type, screenshot,
and read logs — without a human. Used for reproducing bugs and verifying UI flows
against the live app. Validated on iPhone 16e sim (iOS 26.3) + Pixel emulator.

## iOS Simulator

`xcrun simctl` gives launch/screenshot/logs but **no tap/type**. For input you need
`idb` (Facebook's iOS Development Bridge). `cliclick`/AppleScript UI-scripting do not
work — the terminal lacks Accessibility permission ("osascript is not allowed
assistive access").

### One-time setup

```bash
brew install facebook/fb/idb-companion            # native companion (~80 MB)
# fb-idb (the CLI) uses asyncio.get_event_loop(), REMOVED in Python 3.14.
# Use a 3.10–3.12 venv, NOT 3.14:
python3.10 -m venv /tmp/idbenv && /tmp/idbenv/bin/pip install fb-idb
IDB=/tmp/idbenv/bin/idb
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}')
```

### Observe

```bash
xcrun simctl io booted screenshot out.png          # screenshot (points × deviceScale = px)
# Inspect the accessibility tree — labels + frames (in POINTS, e.g. 390×844 for a 3x phone):
$IDB ui describe-all --udid $UDID | python3 -c "import sys,json
for e in json.load(sys.stdin):
  l=e.get('AXLabel') or e.get('AXValue') or ''
  f=e.get('frame',{})
  if l.strip(): print(round(f.get('x',0)),round(f.get('y',0)),'-',l[:50])"
```

### Interact (coordinates are POINTS, not pixels)

```bash
$IDB ui tap  --udid $UDID <x> <y>       # tap element center from describe-all
$IDB ui text --udid $UDID "plot a sine curve"   # type into the focused field
$IDB ui swipe --udid $UDID <x1> <y1> <x2> <y2>
```

### Logs — including React Native JS `console.log`

The app's `logger.*` (console.log/warn/error) surfaces in the device log under
`com.facebook.react.log:javascript`, so `[PythonRuntime] …` etc. are visible WITHOUT
Metro. Native module logs (static server, WebKit/WebView) are there too.

```bash
xcrun simctl spawn booted log stream --level=debug --style=compact \
  --predicate 'processImagePath CONTAINS[c] "offgrid" OR process CONTAINS[c] "WebContent"' \
  > ioslog.txt 2>&1 &
# then trigger the action via idb, and:
grep 'com.facebook.react.log:javascript' ioslog.txt | grep -iE 'PythonRuntime|Provider|Tool' | sed 's/.*javascript] //'
```

Run the log stream as its OWN background process — if you bundle `log stream &` in a
wrapper that exits, the stream can be reaped and you miss the window.

## Android emulator

Full control via `adb` (device coordinates = pixels, from screenshots):

```bash
D=emulator-5554
adb -s $D shell monkey -p ai.offgridmobile.dev -c android.intent.category.LAUNCHER 1
adb -s $D exec-out screencap -p > out.png
adb -s $D shell input tap <x> <y>
adb -s $D shell input text "plot%sa%ssine%scurve"   # %s = space
adb -s $D logcat -c && adb -s $D logcat | grep -iE "PythonRuntime|ReactNativeJS"
```

Note: the Android emulator is heavily CPU/GPU-starved (software rendering) — a poor
target for anything compute-heavy (e.g. Pyodide WASM boot will time out from emulator
slowness, not a real bug). Prefer the iOS sim (native arch) or a physical device for
perf-sensitive flows.

## Reading app data (chats, KB) — see CLAUDE.md "Pulling App Data"

Chat transcripts, settings, and the RAG DB are directly readable to assert what actually
reached the model (e.g. which `enabledTools` were sent, OCR text in the KB).
