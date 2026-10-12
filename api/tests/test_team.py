"""团队空间 API 测试（wire-team-spaces 任务 4：邀请全环 + 门禁矩阵）。

覆盖：
- 邀请全环：owner 生成（``wsi-``+24hex、24h）→ 新 sub 携码 session 兑换
  入队（共享邀请方客户、key_once=null、不动 sub2api/不建新客户）→ 码置
  used（再兑拒）→ team_events('member.joined') 留痕；
- 兑换拒绝面：已归属身份（owner/成员）携码 502、码不存在、码过期
  （expires_at 手改）、码已被使用；
- 门禁矩阵：viewer 变更类 403（POST /api/v1/entities）+ 读面 200；editor
  实体变更 201；密钥物面（/api/v1/data-plane-keys 全方法 +
  /api/v1/connectors/pairing-tokens）editor/viewer 403、owner 200/201；
- 团队管理 owner-only：成员 GET /api/console/team 403、生成邀请 403；
  撤 owner 409、未知成员 404、成员自撤允许、成员撤他人 403；
- 撤销即失效：被撤成员下一次请求 401（解析不到归属）；
- 无码首登零回归：不携码的 session 行为照旧（sub2api 代建 + caller-map +
  铸 key，key_once 非 null）。

环境：平台库（admin/billing/console 同一临时文件库，console_fixture）+
 entities/datasets 内存库依赖覆写（照 test_entities 先例——门禁矩阵需要
 既有变更端点 POST /api/v1/entities 与密钥物面真路由）；sub2api/ceremony
 外部通道假件（test_billing_common.FakeSub2Api + FakeRegistryFace/
 FakeMintChannel），绝不打真网。
"""

from __future__ import annotations

import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm.session import Session
from sqlalchemy.pool import StaticPool

from fd_wire_api.app import app
from fd_wire_api.billing.models import Customer as BillingCustomer
from fd_wire_api.console.models import CustomerInvite, CustomerMember, TeamEvent
from fd_wire_api.console.onboarding import onboard_console_customer  # noqa: F401 —— 覆写锚
from fd_wire_api.console.routes import get_console_sub2api
from fd_wire_api.datasets.db import DatasetsBase, get_db as get_datasets_db
from fd_wire_api.datasets.models import Dataset
from fd_wire_api.entities.db import EntitiesBase, get_db as get_entities_db
from fd_wire_api.entities.models import Entity

import fd_wire_api.console.onboarding as onboarding
from console_fixture import (
    FakeMintChannel,
    FakeRegistryFace,
    bearer,
    install_fake_jwks,
    make_console_env,
    mint_id_token,
)
from test_billing_common import FakeSub2Api

SUB_OWNER = "sub-team-owner"
SUB_OTHER = "sub-other-owner"
SUB_EDITOR = "sub-team-editor"
SUB_VIEWER = "sub-team-viewer"
SUB_NEW = "sub-team-newcomer"

CUST_NAME = "team-cust"  # Customer.name = 客户面命名空间键（entities/keys）

OWNER = bearer(mint_id_token(SUB_OWNER))
OTHER = bearer(mint_id_token(SUB_OTHER))
EDITOR = bearer(mint_id_token(SUB_EDITOR))
VIEWER = bearer(mint_id_token(SUB_VIEWER))
NEWCOMER = bearer(mint_id_token(SUB_NEW))

ORDER_COLUMNS = [
    {"name": "order_id", "type": "TEXT"},
    {"name": "amount", "type": "REAL"},
]

CODE_RE = re.compile(r"^wsi-[0-9a-f]{24}$")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """平台库（团队三表 + 双客户种子）+ entities/datasets 内存库覆写 +
    sub2api/ceremony 外部通道假件的 TestClient。"""
    install_fake_jwks(monkeypatch)
    console_env = make_console_env(
        tmp_path,
        monkeypatch,
        customers=[(SUB_OWNER, CUST_NAME), (SUB_OTHER, "other-cust")],
    )

    # entities + datasets 内存库（门禁矩阵的既有变更端点 / 密钥物面路由）
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    EntitiesBase.metadata.create_all(bind=engine)
    DatasetsBase.metadata.create_all(bind=engine)
    from sqlalchemy.orm import sessionmaker

    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db_session = TestingSession()
    seed_dataset(db_session, key="orders")
    seed_dataset(db_session, key="shipments", name="物流数据源")

    def override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_entities_db] = override_db
    app.dependency_overrides[get_datasets_db] = override_db

    # sub2api / ceremony 外部通道假件（无码首登零回归 + 兑换不触外部通道断言）
    fake_sub2api = FakeSub2Api()
    sub2api_client = fake_sub2api.client()

    def override_sub2api():
        yield sub2api_client

    app.dependency_overrides[get_console_sub2api] = override_sub2api
    registry_face = FakeRegistryFace()
    mint_channel = FakeMintChannel()
    monkeypatch.setattr(onboarding, "default_registry_face", lambda: registry_face)
    monkeypatch.setattr(onboarding, "default_mint_channel", lambda: mint_channel)

    client = TestClient(app)
    try:
        yield SimpleNamespaceShim(
            platform=console_env,
            client=client,
            sub2api=fake_sub2api,
            face=registry_face,
            mint=mint_channel,
            meta=db_session,
        )
    finally:
        app.dependency_overrides.pop(get_entities_db, None)
        app.dependency_overrides.pop(get_datasets_db, None)
        app.dependency_overrides.pop(get_console_sub2api, None)
        db_session.close()
        client.close()
        console_env.engine.dispose()


class SimpleNamespaceShim:
    """fixture 产物打包（避免 dataclass 字段与 fixture 局部重名噪音）。"""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def seed_dataset(session: Session, *, customer_id: str = CUST_NAME, key: str = "orders", name: str | None = None) -> str:
    dataset = Dataset(
        customer_id=customer_id,
        key=key,
        name=name or f"{key} 数据源",
        source_kind="upload",
        storage_tier="api",
        columns_json=ORDER_COLUMNS,
        row_count=10,
    )
    session.add(dataset)
    session.commit()
    return dataset.id


def owner_headers() -> dict:
    return dict(OWNER)


def make_invite(client: TestClient, *, role: str = "editor", headers: dict | None = None) -> dict:
    resp = client.post(
        "/api/console/team/invites", json={"role": role}, headers=headers or OWNER
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def redeem(client: TestClient, sub: str, code: str):
    return client.post(
        "/api/console/session",
        json={"id_token": mint_id_token(sub), "invite_code": code},
    )


def seed_member(env, sub: str, role: str, *, customer: str = CUST_NAME) -> None:
    """直插成员行（门禁矩阵聚焦门禁本身；兑换入队另有全环测试）。"""
    customer_id = env.platform.subs[SUB_OWNER if customer == CUST_NAME else SUB_OTHER]
    with env.platform.session() as sess:
        sess.add(
            CustomerMember(
                customer_id=customer_id,
                logto_sub=sub,
                role=role,
                invited_by_sub=SUB_OWNER,
            )
        )
        sess.commit()


def create_entity(client: TestClient, headers: dict, dataset_id: str, name: str = "订单"):
    return client.post(
        "/api/v1/entities",
        json={"name": name, "dataset_id": dataset_id, "pk_columns": ["order_id"]},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# 邀请全环：生成 → 兑换入队 → 码失效 → 再兑拒
# ---------------------------------------------------------------------------


def test_invite_full_loop(env):
    invite = make_invite(env.client, role="editor")
    assert CODE_RE.match(invite["code"]), invite["code"]
    assert invite["role"] == "editor"
    expires_at = invite["expires_at"]
    assert expires_at  # 24h 窗口（形状断言：ISO 时间串）

    # 兑换前 sub2api 零调用基线
    users_before = len(env.sub2api.users)

    resp = redeem(env.client, SUB_NEW, invite["code"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    # 客户 = 邀请方（不建新客户）；key_once 恒 null（不铸 key）
    assert body["customer"]["name"] == CUST_NAME
    assert body["customer"]["id"] == env.platform.subs[SUB_OWNER]
    assert body["key_once"] is None
    # 不动 sub2api、不写 caller-map、不铸 key（成员共享邀请方面）
    assert len(env.sub2api.users) == users_before
    assert env.face.caller_map == {}
    assert env.mint.mint_count == 0

    # 落库断言：成员行（角色=码角色、invited_by=码生成者）+ 码置 used + 留痕
    with env.platform.session() as sess:
        member = sess.execute(
            select(CustomerMember).where(CustomerMember.logto_sub == SUB_NEW)
        ).scalar_one()
        assert member.customer_id == env.platform.subs[SUB_OWNER]
        assert member.role == "editor"
        assert member.invited_by_sub == SUB_OWNER
        used = sess.execute(
            select(CustomerInvite).where(CustomerInvite.code == invite["code"])
        ).scalar_one()
        assert used.used_by_sub == SUB_NEW
        assert used.used_at is not None
        events = (
            sess.execute(
                select(TeamEvent).where(TeamEvent.action == "member.joined")
            )
            .scalars()
            .all()
        )
        assert [(e.actor_sub, e.target) for e in events] == [(SUB_NEW, SUB_NEW)]
        assert events[0].detail["role"] == "editor"

    # 码已用：另一新身份再兑 → 502 failed 带原因
    resp2 = redeem(env.client, "sub-team-late", invite["code"])
    assert resp2.status_code == 502
    assert resp2.json() == {"status": "failed", "reason": "邀请码已被使用"}

    # 成员视角：GET /api/console/team 403（团队管理 owner-only）
    assert env.client.get("/api/console/team", headers=NEWCOMER).status_code == 403


def test_get_team_lists_owner_row_and_invites(env):
    invite = make_invite(env.client, role="viewer")
    resp = env.client.get("/api/console/team", headers=OWNER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["me"] == {"sub": SUB_OWNER, "role": "owner"}
    members = body["members"]
    # 隐含 owner 行：logto_sub=Customer.logto_sub
    assert members[0]["logto_sub"] == SUB_OWNER
    assert members[0]["role"] == "owner"
    assert [i["id"] for i in body["invites"]] == [invite["id"]]
    assert body["invites"][0]["code"] == invite["code"]
    assert body["invites"][0]["role"] == "viewer"


def test_get_team_lists_only_pending_invites(env):
    """待用邀请列表：已用/过期码不回（spec「待用邀请列表」；历史在 team_events）。"""
    pending = make_invite(env.client, role="viewer")
    used = make_invite(env.client, role="editor")
    expired = make_invite(env.client, role="editor")
    # used：新身份真实兑换入队（走全环路径置 used）
    assert redeem(env.client, SUB_NEW, used["code"]).status_code == 200
    # expired：expires_at 手改到过去（库面直改，免时钟 monkeypatch）
    with env.platform.session() as sess:
        row = sess.execute(
            select(CustomerInvite).where(CustomerInvite.code == expired["code"])
        ).scalar_one()
        row.expires_at = row.created_at.replace(tzinfo=None) - timedelta(seconds=1)
        sess.commit()

    body = env.client.get("/api/console/team", headers=OWNER).json()
    assert [i["id"] for i in body["invites"]] == [pending["id"]]


# ---------------------------------------------------------------------------
# 兑换拒绝面：已归属 / 码不存在 / 码过期
# ---------------------------------------------------------------------------


def test_redeem_rejects_identity_with_existing_customer(env):
    invite = make_invite(env.client)
    # owner 本人携码：诚实拒（不静默忽略码）
    resp = redeem(env.client, SUB_OWNER, invite["code"])
    assert resp.status_code == 502
    assert resp.json() == {"status": "failed", "reason": "该身份已有客户归属，邀请码仅限新身份"}
    # 已是成员的身份携另一码：同样拒（一人一队）
    seed_member(env, SUB_EDITOR, "editor")
    invite2 = make_invite(env.client)
    resp2 = redeem(env.client, SUB_EDITOR, invite2["code"])
    assert resp2.status_code == 502
    assert resp2.json()["reason"] == "该身份已有客户归属，邀请码仅限新身份"


def test_redeem_unknown_code(env):
    resp = redeem(env.client, SUB_NEW, "wsi-" + "0" * 24)
    assert resp.status_code == 502
    assert resp.json() == {"status": "failed", "reason": "邀请码不存在"}


def test_redeem_expired_code(env):
    invite = make_invite(env.client)
    # 时钟注入替代：expires_at 手改到过去（库面直改，免时钟 monkeypatch）
    with env.platform.session() as sess:
        row = sess.execute(
            select(CustomerInvite).where(CustomerInvite.code == invite["code"])
        ).scalar_one()
        row.expires_at = row.created_at.replace(tzinfo=None) - timedelta(seconds=1)
        sess.commit()
    resp = redeem(env.client, SUB_NEW, invite["code"])
    assert resp.status_code == 502
    assert resp.json() == {"status": "failed", "reason": "邀请码已过期"}
    # 过期码不入队、不置 used
    with env.platform.session() as sess:
        assert (
            sess.execute(
                select(CustomerMember).where(CustomerMember.logto_sub == SUB_NEW)
            ).scalar_one_or_none()
            is None
        )


# ---------------------------------------------------------------------------
# 门禁矩阵：viewer 只读 / editor 变更通 / 密钥物 owner-only / owner 全通
# ---------------------------------------------------------------------------


@pytest.fixture()
def matrix(env):
    """团队三席就位 + 两个种子数据集 id（owner/editor 各建一体，一集一体）。"""
    seed_member(env, SUB_EDITOR, "editor")
    seed_member(env, SUB_VIEWER, "viewer")
    datasets = env.meta.execute(select(Dataset).order_by(Dataset.key)).scalars().all()
    return SimpleNamespaceShim(env=env, dataset_id=datasets[0].id, dataset2_id=datasets[1].id)


def test_gate_viewer_read_ok_write_403(matrix):
    env, dataset_id = matrix.env, matrix.dataset_id
    # 读面与成员一致
    assert env.client.get("/api/v1/entities", headers=VIEWER).status_code == 200
    # 变更类一律 403（统一依赖内，角色判定只来自服务端解析）
    resp = env.client.post(
        "/api/v1/entities",
        json={"name": "订单", "dataset_id": dataset_id, "pk_columns": ["order_id"]},
        headers=VIEWER,
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "团队成员权限不足（viewer 只读）"
    # PUT/DELETE 同拒（用既有实体端点形态：先由 owner 建一个实体）
    created = create_entity(env.client, OWNER, dataset_id)
    assert created.status_code == 201, created.text
    entity_id = created.json()["id"]
    put = env.client.put(
        f"/api/v1/entities/{entity_id}",
        json={"name": "订单改名", "dataset_id": dataset_id, "pk_columns": ["order_id"]},
        headers=VIEWER,
    )
    assert put.status_code == 403
    assert env.client.delete(f"/api/v1/entities/{entity_id}", headers=VIEWER).status_code == 403


def test_gate_key_surface_owner_only(matrix):
    env = matrix.env
    # owner：密钥物面全通（GET 列表 200 / POST 铸造 201 / 配对令牌 201）
    assert env.client.get("/api/v1/data-plane-keys", headers=OWNER).status_code == 200
    minted = env.client.post(
        "/api/v1/data-plane-keys", json={"label": "生产"}, headers=OWNER
    )
    assert minted.status_code == 201, minted.text
    assert (
        env.client.post("/api/v1/connectors/pairing-tokens", headers=OWNER).status_code == 201
    )
    # editor：密钥物面一律 403（含读面——密钥管理仅 owner）
    for method, path in (
        ("get", "/api/v1/data-plane-keys"),
        ("post", "/api/v1/data-plane-keys"),
        ("delete", f"/api/v1/data-plane-keys/{minted.json()['id']}"),
        ("post", "/api/v1/connectors/pairing-tokens"),
    ):
        resp = getattr(env.client, method)(path, headers=EDITOR)
        assert resp.status_code == 403, (method, path, resp.text)
        assert resp.json()["detail"] == "团队成员权限不足（密钥管理仅 owner）"
    # viewer 同拒（GET 也拒：密钥物面 owner-only 盖过 viewer 读面）
    resp = env.client.get("/api/v1/data-plane-keys", headers=VIEWER)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "团队成员权限不足（密钥管理仅 owner）"


def test_gate_editor_mutations_allowed(matrix):
    env, dataset_id = matrix.env, matrix.dataset_id
    # editor 实体变更通（editor=除团队管理与密钥物外全权）
    resp = create_entity(env.client, EDITOR, dataset_id, name="编辑者实体")
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "编辑者实体"
    # editor 团队管理仍 403
    assert (
        env.client.post(
            "/api/console/team/invites", json={"role": "viewer"}, headers=EDITOR
        ).status_code
        == 403
    )
    # owner 全通：实体变更（一集一体——owner 用第二个数据集）
    assert (
        create_entity(env.client, OWNER, matrix.dataset2_id, name="owner 实体").status_code
        == 201
    )


def test_gate_rejects_bad_invite_role(env):
    resp = env.client.post(
        "/api/console/team/invites", json={"role": "owner"}, headers=OWNER
    )
    assert resp.status_code == 422  # role 只 editor|viewer（pydantic pattern）


# ---------------------------------------------------------------------------
# 成员撤销：撤即 401 / 撤 owner 409 / 未知 404 / 自撤允许 / 成员撤他人 403
# ---------------------------------------------------------------------------


def test_member_revoked_next_request_401(env):
    seed_member(env, SUB_EDITOR, "editor")
    headers = EDITOR
    assert env.client.get("/api/v1/entities", headers=headers).status_code == 200
    resp = env.client.delete(f"/api/console/team/members/{SUB_EDITOR}", headers=OWNER)
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    # 撤销即失效：下一次请求 401（解析不到归属）
    assert env.client.get("/api/v1/entities", headers=headers).status_code == 401
    # 留痕
    with env.platform.session() as sess:
        events = (
            sess.execute(
                select(TeamEvent).where(
                    TeamEvent.action == "member.removed", TeamEvent.target == SUB_EDITOR
                )
            )
            .scalars()
            .all()
        )
        assert len(events) == 1
        assert events[0].actor_sub == SUB_OWNER


def test_remove_owner_409_and_unknown_404(env):
    resp = env.client.delete(f"/api/console/team/members/{SUB_OWNER}", headers=OWNER)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "owner 不可被撤销"
    assert (
        env.client.delete("/api/console/team/members/sub-ghost", headers=OWNER).status_code
        == 404
    )


def test_member_self_removal_allowed(env):
    seed_member(env, SUB_EDITOR, "editor")
    seed_member(env, SUB_VIEWER, "viewer")
    # 成员撤他人 403（viewer 不能撤 editor——团队管理仅 owner）
    resp = env.client.delete(f"/api/console/team/members/{SUB_EDITOR}", headers=VIEWER)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "团队成员权限不足（团队管理仅 owner）"
    # 成员自撤允许（团队管理 owner-only 的唯一例外）
    resp2 = env.client.delete(f"/api/console/team/members/{SUB_EDITOR}", headers=EDITOR)
    assert resp2.status_code == 200
    assert resp2.json() == {"deleted": True}
    assert env.client.get("/api/v1/entities", headers=EDITOR).status_code == 401
    # 留痕：自撤事件 actor=本人
    with env.platform.session() as sess:
        events = (
            sess.execute(
                select(TeamEvent).where(TeamEvent.action == "member.removed")
            )
            .scalars()
            .all()
        )
        assert [(e.actor_sub, e.target, e.detail) for e in events] == [
            (SUB_EDITOR, SUB_EDITOR, {"self": True})
        ]


def test_invite_revocation(env):
    invite = make_invite(env.client)
    resp = env.client.delete(f"/api/console/team/invites/{invite['id']}", headers=OWNER)
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    # 再删 404；兑换按不存在拒
    assert (
        env.client.delete(f"/api/console/team/invites/{invite['id']}", headers=OWNER).status_code
        == 404
    )
    assert redeem(env.client, SUB_NEW, invite["code"]).status_code == 502
    # 他企 owner 不可见/不可删本队邀请（客户维度隔离 → 404 不泄露）
    invite2 = make_invite(env.client)
    assert (
        env.client.delete(
            f"/api/console/team/invites/{invite2['id']}", headers=OTHER
        ).status_code
        == 404
    )
    # 留痕
    with env.platform.session() as sess:
        actions = [
            e.action
            for e in sess.execute(select(TeamEvent)).scalars().all()
        ]
        assert "invite.created" in actions
        assert "invite.revoked" in actions


# ---------------------------------------------------------------------------
# 无码首登零回归
# ---------------------------------------------------------------------------


def test_no_code_first_login_unchanged(env):
    """无码路径与现状逐字节一致：sub2api 代建 + caller-map + 铸 key。"""
    users_before = len(env.sub2api.users)
    resp = env.client.post(
        "/api/console/session", json={"id_token": mint_id_token("sub-fresh-login")}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["key_once"] is not None  # 首登完成开户：明文 key 一次性交付
    assert len(env.sub2api.users) == users_before + 1  # 代建发生
    assert "sub-fresh-login" in env.face.caller_map  # registry 授权束写入
    assert env.mint.mint_count == 1
    with env.platform.session() as sess:
        customer = sess.execute(
            select(BillingCustomer).where(
                BillingCustomer.logto_sub == "sub-fresh-login"
            )
        ).scalar_one()
        assert customer.name == "sub-fresh-login"  # display_name=email 缺省=sub


def test_member_shares_owner_customer_namespace(env):
    """成员与 owner 同一客户命名空间（require_console_customer_id 返回
    Customer.name——成员读写落在邀请方空间）。"""
    seed_member(env, SUB_VIEWER, "viewer")
    seeded = env.meta.execute(select(Dataset)).scalars().first()
    # viewer 只读：列表可见 owner 客户的实体空间（空但 200）
    assert env.client.get("/api/v1/entities", headers=VIEWER).json() == {"entities": []}
    # owner 建实体后 viewer 可见（同空间）
    created = create_entity(env.client, OWNER, seeded.id)
    assert created.status_code == 201
    listing = env.client.get("/api/v1/entities", headers=VIEWER).json()
    assert [e["id"] for e in listing["entities"]] == [created.json()["id"]]
    # 实体表落行断言：customer_id = 邀请方命名空间
    row = env.meta.execute(select(Entity)).scalar_one()
    assert row.customer_id == CUST_NAME
