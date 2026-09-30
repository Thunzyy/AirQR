from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "apps" / "get-airqr"


def test_download_platform_order_and_release_links() -> None:
    html = (SITE / "index.html").read_text(encoding="utf-8")

    expected_order = [
        'data-platform="android"',
        'data-platform="ios"',
        'data-platform="windows"',
        'data-platform="linux"',
        'data-platform="macos"',
        'data-platform="offline"',
    ]
    positions = [html.index(marker) for marker in expected_order]
    assert positions == sorted(positions)

    expected_assets = [
        "AirQR.apk",
        "AirQR-windows-x64-setup.exe",
        "AirQR-windows-x64.zip",
        "AirQR-linux-x64.deb",
        "airqr-portable.html",
    ]
    for asset in expected_assets:
        assert (
            f"https://github.com/Thunzyy/AirQR/releases/download/v1.0/{asset}"
            in html
        )

    assert "https://play.google.com/store/apps/details?id=com.airqr.mobile" in html
    assert html.index("<h3>Android</h3>") < html.index("<h3>iPhone</h3>")
    assert html.index("<h3>Debian / Ubuntu</h3>") < html.index("<h3>macOS</h3>")


def test_static_site_has_no_inline_code_and_all_local_assets_exist() -> None:
    html = (SITE / "index.html").read_text(encoding="utf-8")

    assert "<style" not in html
    assert "<script>" not in html
    assert 'src="./main.js?v=' in html
    assert 'href="./styles.css?v=' in html

    local_assets = [
        "logo.svg",
        "phone-encoder.png",
        "pc-screen.png",
        "feature-graphic.png",
        "google-play-badge.png",
        "app-store-badge.svg",
        "how-choose-file.png",
        "how-qr-animation.png",
        "how-scan-rebuild.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "android-chrome-192x192.png",
        "android-chrome-512x512.png",
    ]
    for asset in local_assets:
        assert (SITE / "assets" / asset).is_file(), asset


def test_privacy_policy_page_is_static_ascii_html() -> None:
    html = (SITE / "privacy.html").read_text(encoding="utf-8")
    index = (SITE / "index.html").read_text(encoding="utf-8")
    sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
    headers = (SITE / "_headers").read_text(encoding="utf-8")
    redirects = (SITE / "_redirects").read_text(encoding="utf-8")

    assert "<style" not in html
    assert "<script>" not in html
    assert "<script " not in html
    assert 'href="./styles.css"' in html
    assert "Privacy Policy" in html
    assert "Politique de confidentialité" in html
    assert "SenTent" in html
    assert "Poignard.lucas@gmail.com" in html
    assert "+33620606243" in html
    assert "Saint-Maur-des-Fossés" in html
    assert "Move files through light." not in html
    assert 'href="./privacy"' in index
    assert "https://get-airqr.pgnrd.fr/privacy" in sitemap
    assert "/privacy" in headers
    assert "/privacy /privacy.html 200" not in redirects


def test_cloudflare_headers_are_fail_closed() -> None:
    headers = (SITE / "_headers").read_text(encoding="utf-8")

    assert "Content-Security-Policy:" in headers
    assert "frame-ancestors 'none'" in headers
    assert "object-src 'none'" in headers
    assert "X-Content-Type-Options: nosniff" in headers
    assert "Permissions-Policy:" in headers
    assert "Cache-Control: no-cache" in headers
