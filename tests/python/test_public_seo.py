"""Check the discovery documents and HTML delivered before JavaScript runs."""

from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


class Head(HTMLParser):
    def __init__(self, html: str):
        super().__init__()
        self.canonicals = []
        self.meta = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and attrs.get("rel") == "canonical":
            self.canonicals.append(attrs.get("href"))
        if tag == "meta":
            self.meta[attrs.get("name", attrs.get("property"))] = attrs.get("content")


def test_public_pages_have_consistent_canonicals_and_discovery_files():
    for folder, base, public in [
        ("apps/get-airqr", "https://get-airqr.pgnrd.fr/", ""),
        ("apps/web", "https://airqr-demo.pgnrd.fr/", "public"),
    ]:
        site = ROOT / folder
        html = (site / "index.html").read_text(encoding="utf-8")
        head = Head(html)
        assert head.canonicals == [base]
        assert head.meta["og:url"] == base
        assert "noindex" not in head.meta["robots"]
        assert head.meta["og:image"].startswith("https://")
        assert head.meta["description"]
        robots = (site / public / "robots.txt").read_text(encoding="utf-8")
        assert f"Sitemap: {base}sitemap.xml" in robots
        assert "Disallow: /" not in robots
        sitemap = ET.parse(site / public / "sitemap.xml")
        urls = [node.text for node in sitemap.findall(".//{*}loc")]
        assert base in urls
        assert all(url.startswith(base) and not url.endswith(".html") for url in urls)


def test_demo_initial_html_explains_the_app_and_links_to_downloads():
    html = (ROOT / "apps/web/index.html").read_text(encoding="utf-8")
    assert '<div id="root"></div>' not in html
    assert '<main id="main-content"' in html
    assert "animated QR file transfer</h1>" in html
    assert 'href="https://get-airqr.pgnrd.fr/"' in html
    assert 'href="https://lucas.pgnrd.fr/en/blog/airqr"' in html
