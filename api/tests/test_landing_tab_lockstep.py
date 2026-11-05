"""landing_tab 值域对拍（fix-landing-tab-market-drift）。

api `LANDING_TABS` 与 web `ConsoleTab` 联合类型必须同集——两处各自演化已
两次咬生产（workbench、market 切页签写回被 422 静默吞）。本测试把
preferences.py 注释里「冻结对表」变成可执行断言：读
web/src/console/ConsoleLayout.tsx 的 ConsoleTab 类型字面量与 api 枚举比对。
"""

import re
from pathlib import Path

from fd_wire_api.console.preferences import LANDING_TABS

LAYOUT = (
    Path(__file__).resolve().parents[2]
    / "web"
    / "src"
    / "console"
    / "ConsoleLayout.tsx"
)


def test_landing_tabs_lockstep_with_web_console_tab():
    assert LAYOUT.exists(), f"web ConsoleLayout 不在场：{LAYOUT}"
    union = re.search(
        r"export type ConsoleTab =\s*((?:[ \t]*\|[^\n]+\n)+)",
        LAYOUT.read_text(encoding="utf-8"),
    )
    assert union, "ConsoleTab 联合类型未找到——ConsoleLayout.tsx 结构变了须同步本测试"
    web_tabs = set(re.findall(r'"([a-z_]+)"', union.group(1)))
    assert web_tabs == set(LANDING_TABS), (
        "api/web landing_tab 值域漂移："
        f"api 独有={sorted(set(LANDING_TABS) - web_tabs)} "
        f"web 独有={sorted(web_tabs - set(LANDING_TABS))}"
    )
