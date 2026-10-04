"""Env 可重指的借用契约端点（borrowed-contract endpoints）。

平台对不归本仓的能力（business-mcp / registry / sub2api / token 网关）
只经显式 HTTP 契约访问：每个端点都是占位默认值，可被同名环境变量
覆盖——这是跨线互联而不互相阻塞发布的纪律（README「借用契约」）。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """运行时配置：同名环境变量优先（如 REGISTRY_URL=...）。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 五库联邦数据读取工具（rows_returned 计量戳在此盖）
    business_mcp_url: str = "http://business-mcp.fd-prod.svc/execution"
    # 谦面 registry：wire 入口（鉴权/逐调用审计/转发）
    registry_url: str = "https://mcp.finddatatech.cloud"
    # sub2api 计费面：客户账户代管/余额/结算
    sub2api_base: str = "https://router.finddatatech.cloud"
    # token 网关：AI 构建循环
    token_gateway_url: str = "https://token.finddatatech.cloud"

    def borrowed_contracts(self) -> dict[str, str]:
        """全部借用契约端点一览（示例路由与健康检查消费）。"""
        return {
            "business_mcp_url": self.business_mcp_url,
            "registry_url": self.registry_url,
            "sub2api_base": self.sub2api_base,
            "token_gateway_url": self.token_gateway_url,
        }


settings = Settings()
