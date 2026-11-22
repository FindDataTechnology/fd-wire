"""追踪主体表（wire-subject-tracking）。

两张表落 **datasets 库**（与 datasets 表同库，使快照物化——subject + 数据集
——能在同一事务提交）：

- ``subjects``：一个客户想持续追踪的对象（kind 闭集 / ref 解析来源 / 标题 /
  最近快照数据集 id）。客户隔离按 ``customer_id``。
- ``subject_channels``：主体绑定的信号通道（type 闭集 / spec JSON），
  ``subject_id`` → ``subjects.id`` 级联删除。

链位：单一迁移链线性追加（down_revision=0055 当前头）。生产对
``wire_datasets`` 库跑 ``upgrade head`` 即建出本两表（与 0011 datasets
表同库）；``AUTO_CREATE`` 在产关闭，靠本迁移。

Revision ID: 0056_subject_tracking
Revises: 0055_ontology_kernel_attrs
Create Date: 2026-11-22
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0056_subject_tracking"
down_revision: str | None = "0055_ontology_kernel_attrs"
branch_labels: str | (Sequence[str] | None) = None
depends_on: str | (Sequence[str] | None) = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table("subjects"):
        op.create_table(
            "subjects",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("customer_id", sa.String(length=64), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("ref", sa.JSON(), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("snapshot_dataset_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_subjects")),
        )
        op.create_index(op.f("ix_subjects_customer_id"), "subjects", ["customer_id"])

    if not _has_table("subject_channels"):
        op.create_table(
            "subject_channels",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("subject_id", sa.Integer(), nullable=False),
            sa.Column("type", sa.String(length=32), nullable=False),
            sa.Column("spec", sa.JSON(), nullable=False),
            sa.ForeignKeyConstraint(
                ["subject_id"], ["subjects.id"],
                name=op.f("fk_subject_channels_subject_id_subjects"),
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_subject_channels")),
        )
        op.create_index(
            op.f("ix_subject_channels_subject_id"), "subject_channels", ["subject_id"]
        )


def downgrade() -> None:
    if _has_table("subject_channels"):
        op.drop_index(op.f("ix_subject_channels_subject_id"), table_name="subject_channels")
        op.drop_table("subject_channels")
    if _has_table("subjects"):
        op.drop_index(op.f("ix_subjects_customer_id"), table_name="subjects")
        op.drop_table("subjects")
