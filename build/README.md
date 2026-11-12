# AirQR Build Scripts

All centralized project build scripts live here.

From the repository root:

```bash
python build/all.py
python build/web_singlefile.py
python build/encoder_linksite.py
python build/python_bundle.py
python build/flutter_bundle.py
```

From this `build/` directory:

```bash
python all.py
python web_singlefile.py
python encoder_linksite.py
python python_bundle.py
python flutter_bundle.py
```

Outputs:

- `dist/web-singlefile/airqr-portable.html`
- `dist/web-singlefile/airqr-encoder-linksite.html`
- `dist/web-python`
- `dist/Android/AirQR.apk`
- `dist/Windows/AirQR`
- `dist/Windows/AirQR-windows-x64.zip`
- `dist/Windows/AirQR-windows-x64-setup.exe`
- `dist/Linux/AirQR-linux-x64.tar.gz`
- `dist/Linux/AirQR-linux-x64.deb`
- `dist/Mac/AirQR-macos.zip`
- `dist/flutter-manifest.json`

Flutter:

- `python build/flutter_bundle.py` builds the Flutter targets supported by the current host machine and copies the final artifacts into `dist/<Platform>`
- on Windows, it also produces `dist/Windows/AirQR-windows-x64.zip` and an Inno Setup installer at `dist/Windows/AirQR-windows-x64-setup.exe`
- on Linux, the bundle also produces `dist/Linux/AirQR-linux-x64.tar.gz` and
  `dist/Linux/AirQR-linux-x64.deb`
- on macOS, the bundle also produces `dist/Mac/AirQR-macos.zip`
- `python build/flutter_bundle.py --only android-apk windows`
- `python build/flutter_bundle.py --collect-only` only re-syncs artifacts that were already built

`python build/all.py` rebuilds the web app, all HTML exports, and the Python bundle, then re-syncs the public assets in `apps/web/public`.
Add `--with-flutter` to also include Flutter artifacts under `dist/<Platform>`.
