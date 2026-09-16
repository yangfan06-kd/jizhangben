"""旧接口测试显式打开开发回退；生产默认值由应用保持为关闭。"""

import pytest


@pytest.fixture(autouse=True)
def enable_development_fallback_for_legacy_tests(monkeypatch):
    monkeypatch.setenv("JIZHANGBEN_ALLOW_DEV_FALLBACK", "1")
