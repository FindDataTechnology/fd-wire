"""subjects 切片的请求/响应 schema（wire-subject-tracking）。

形状校验（kind 词表、ref.source 词表、通道必备参数）在此与 service 层双写：
pydantic 在入口挡住明显非法（422），service 层再做跨字段/跨记录校验。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .models import CHANNEL_TYPES, REF_SOURCES, SUBJECT_KINDS


class RefIn(BaseModel):
    """主体引用：来源 + 该来源内标识。"""

    source: Literal[
        "stock_code", "industry_code", "country_code", "region_code", "chain_spec", "custom_label"
    ]
    code: str | None = None
    #: chain_spec 用：名称 + 段（industry ref 列表）；其余 source 用 code
    name: str | None = None
    segments: list[dict[str, Any]] | None = None

    @field_validator("code")
    @classmethod
    def _code_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("code 不能为空串")
        return v


class ChannelIn(BaseModel):
    """一个通道声明。"""

    type: Literal["indicators", "announcements", "registry", "graph", "context"]
    spec: dict[str, Any] = Field(default_factory=dict)


class SubjectCreateIn(BaseModel):
    kind: Literal["company", "industry", "chain", "country", "region"]
    ref: RefIn
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    channels: list[ChannelIn] = Field(default_factory=list)


class ChannelOut(BaseModel):
    id: int
    type: str
    spec: dict[str, Any]


class SubjectOut(BaseModel):
    id: int
    kind: str
    ref: dict[str, Any]
    title: str
    description: str | None
    snapshot_dataset_id: str | None
    channels: list[ChannelOut]


#: 供 service/model 层复用（避免重复列出词表）
__all__ = [
    "CHANNEL_TYPES",
    "REF_SOURCES",
    "SUBJECT_KINDS",
    "ChannelIn",
    "ChannelOut",
    "RefIn",
    "SubjectCreateIn",
    "SubjectOut",
]
