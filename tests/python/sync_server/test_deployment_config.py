from pathlib import Path

import pytest

from server import build_parser


def test_docker_compose_allows_local_dev_browser_origins() -> None:
    root = Path(__file__).resolve().parents[3]
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")

    assert "--allow-origin https://localhost:5174" in compose
    assert "--allow-origin https://127.0.0.1:5174" in compose


def test_docker_compose_passes_through_optional_bootstrap_credentials() -> None:
    root = Path(__file__).resolve().parents[3]
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")

    assert "AIRQR_BOOTSTRAP_USERNAME=${AIRQR_BOOTSTRAP_USERNAME:-}" in compose
    assert "AIRQR_BOOTSTRAP_PASSWORD=${AIRQR_BOOTSTRAP_PASSWORD:-}" in compose
    assert "--allow-unauthenticated" not in compose


def test_cli_exposes_explicit_unauthenticated_opt_out() -> None:
    args = build_parser().parse_args(["--allow-unauthenticated"])

    assert args.allow_unauthenticated is True


def test_cli_rejects_removed_first_user_http_setup_flag() -> None:
    with pytest.raises(SystemExit) as error:
        build_parser().parse_args(["--allow-first-user-setup"])

    assert error.value.code == 2
