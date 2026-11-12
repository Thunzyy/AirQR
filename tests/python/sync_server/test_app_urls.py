from __future__ import annotations

from sync_server.app import _build_access_urls


def test_build_access_urls_for_wildcard_host_prefers_localhost_and_valid_lan_ips() -> None:
    urls = _build_access_urls(
        "0.0.0.0",
        8081,
        "http",
        lan_hosts=["127.0.0.1", "169.254.10.20", "192.168.1.100"],
    )

    assert urls == [
        "http://localhost:8081",
        "http://192.168.1.100:8081",
    ]


def test_build_access_urls_for_explicit_host_keeps_that_host() -> None:
    urls = _build_access_urls("127.0.0.1", 8081, "http")

    assert urls == ["http://127.0.0.1:8081"]
