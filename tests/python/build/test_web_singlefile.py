from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


module_path = Path(__file__).resolve().parents[3] / "build" / "web_singlefile.py"
spec = importlib.util.spec_from_file_location("web_singlefile_tests", module_path)
singlefile = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = singlefile
spec.loader.exec_module(singlefile)


@pytest.mark.parametrize(
    "code, expected",
    [
        (
            'const X0 = "modulepreload", Z0 = function(l) {\n return "/" + l;\n }, cache = {};',
            'return globalThis.__airqr_asset_url("/" + l);',
        ),
        (
            "const a='modulepreload',g1=function(x){return '/'+x},b={};",
            'return globalThis.__airqr_asset_url("/" + x)',
        ),
    ],
)
def test_lazy_route_preloads_resolve_embedded_assets_regardless_of_minified_names(code, expected):
    patched = singlefile.patch_js_module(code, "/assets/index.js", [], {})
    assert expected in patched


def test_unrelated_path_builders_are_unchanged():
    code = 'const g1 = function(path) { return "/" + path; };'
    assert singlefile.patch_js_module(code, "/assets/index.js", [], {}) == code
