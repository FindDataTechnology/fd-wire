# entity-layer Specification

## Purpose
定义轻量实体语义层：实体（业务名+数据集+主键列）与关系（实体列 → 目标实体主键）
为客户域一等元数据；图谱（实体+关系）注入 AI 构建上下文使 AI 带业务语义用数；
控制台提供声明与管理面。为 v1 语义物化 join（引擎 link 工具）与本体深化打地基
——不做全量本体。

## Requirements

### Requirement: 实体声明

实体为客户域一等元数据：业务名（客户内唯一）+ 绑定本企业数据集（每数据集至多
一个实体）+ 主键列（非空列表、去重、⊆ 数据集列快照）+ 可选描述；CRUD 客户域
隔离（他企 404 不泄露）；删除实体级联删除其两端关系；校验失败 422 如实逐条
且零半写。

#### Scenario: 声明实体
- **WHEN** 客户对本企业数据集声明实体（业务名+主键列 ⊆ 该集列）
- **THEN** 实体落库可跨会话访问，图谱端点立即可见该节点

#### Scenario: 主键列校验
- **WHEN** 声明的主键列不存在于绑定数据集的列快照，或为空/重复
- **THEN** 422 如实指明（列名级），不落实体行

#### Scenario: 唯一性与隔离
- **WHEN** 重复业务名、重复绑定同一数据集，或访问他企实体
- **THEN** 前两者 422/409 如实，后者 404 不泄露存在性

### Requirement: 关系声明与纪律

关系为有向声明：源实体列 → 目标实体**主键列**，kind ∈ {n:1, 1:1, 1:n, m:n}；源列须 ∈ 源实体数据集列、目标列须 ∈ 目标实体主键集合（关系指向身份的语义纪律）；两端实体须同属本企业；同四元组（源实体/源列/目标实体/目标列）唯一；删除任一实体级联删其关系；非法 422 如实且零半写。`1:n` SHALL 为 `n:1` 的反向声明——同一（源列,目标列）四元组的反向视角，不新增存储；同一四元组的正向与反向 SHALL NOT 同时声明（409）。`m:n` SHALL 经**中间数据集**声明：额外指定中间数据集与两列，两列 MUST 分别 ∈ 两端实体绑定数据集的列快照且语义上指向两端实体主键（值域校验沿列快照存在性）；`m:n` 关系 SHALL 可声明、可在图谱与遍历中使用、**可经关系物化展开为关系对数据集**（物化语义见「关系物化——数据集间语义连接」；本要求 MUST NOT 再声明物化端点对 m:n 拒绝）。存量 n:1/1:1 关系行为零迁移。

#### Scenario: 声明关系

- **WHEN** 客户声明「订单.customer_id →(n:1) 客户.主键」且两实体在场、列合法
- **THEN** 关系落库，图谱端点出现该边

#### Scenario: 反向声明互斥

- **WHEN** 对已存在 n:1 关系的同一四元组声明 1:n 反向关系
- **THEN** 409 如实（同一指向不重复声明），已有关系不受影响

#### Scenario: m:n 经中间数据集

- **WHEN** 客户以中间数据集「订单标签」（含订单 id 列与标签 id 列）声明
    订单 ↔ 标签 的 m:n 关系
- **THEN** 关系落库，图谱出现该边（kind=m:n），遍历端点可经中间集取关联对象

#### Scenario: m:n 可物化

- **WHEN** 对已声明的 m:n 关系调用关系物化
- **THEN** 不再按「v0 不支持」拒绝，按「关系物化」要求经中间数据集展开关系对
    （档位/漂移/护栏路径同该要求）

#### Scenario: m:n 物化不支持如实

- **WHEN** 对 m:n 关系调用物化而目标 cell 引擎不支持中间集（旧镜像 link 无
    junction 参数）
- **THEN** 返回可读错误（引擎不支持中间集），如实说明，不伪造成功、不落子集行

#### Scenario: 目标列纪律

- **WHEN** 关系的目标列不在目标实体的主键集合内
- **THEN** 422 指明「关系目标必须是目标实体的主键列」，不落关系行

#### Scenario: 级联删除

- **WHEN** 删除实体「客户」
- **THEN** 其为端点的所有关系一并删除（留痕于删除响应），图谱同步消失

### Requirement: 实体图谱端点

`GET /api/v1/entities/graph`（console 身份）返回同源图谱：nodes（实体 id/业务名/
数据集 id+key+名称+行数+tier/主键列）+ edges（关系四元组+kind+label）；无实体
返回空集而非 404；图谱是控制台页与 AI 上下文注入的唯一同源。

#### Scenario: 图谱同源
- **WHEN** 声明两个实体与一条关系后调图谱端点
- **THEN** nodes 含两实体（带数据集摘要与主键），edges 含该关系（kind 如实）

#### Scenario: 空图谱
- **WHEN** 企业未声明任何实体
- **THEN** 图谱端点返回 `{nodes: [], edges: []}`（200）

### Requirement: AI 构建上下文注入

AI 构建对话的 system prompt SHALL 在固定文案之后追加实体图谱紧凑文本块（实体
「名」=数据集（主键…、显示列）、关系指向含 kind 与 m:n 中间集）；实体携带
属性元数据时注入块 SHALL 含显示列与单位注记；仅当图谱非空；注入有界（≤50 实体/≤100
关系，超限截断并如实标注「仅列前 N」）；图谱为空时 prompt 与现状逐字一致
（零漂移）；注入 SHALL NOT 改动工具 schema 与既有消息流。

#### Scenario: 图谱进上下文

- **WHEN** 企业声明实体与关系后发起 AI 构建对话
- **THEN** 模型收到的 system prompt 含实体名/主键/显示列/关系指向的文本块

#### Scenario: 空图谱零漂移

- **WHEN** 企业未声明实体发起对话
- **THEN** system prompt 与未上线本能力时逐字一致

#### Scenario: 有界注入

- **WHEN** 图谱超限（>50 实体或 >100 关系）
- **THEN** 注入块截断到界并标注截断，不撑爆上下文

### Requirement: 控制台实体页

控制台侧栏「实体」入口 SHALL 保留既有能力：实体列表（业务名/数据集/主键徽标）+
创建表单 + 实体关系管理 + SVG 小图谱。本能力 SHALL 扩展：①声明表单增**属性元数据**
（显示列下拉 ∈ 数据集列、可选单位/格式注记）与 **m:n 中间数据集配置**（中间集
下拉 + 两列下拉）；②**对象浏览**节（cell 档专属，免费档不出现且如实说明）：
实体卡进入实例列表（关键字/筛选/排序/分页，沿数据集列事实构建）→ 对象详情
（属性按元数据渲染 + 关联对象页签沿关系遍历）；i18n zh/en 同步。

#### Scenario: 声明全流程

- **WHEN** 客户在实体页选数据集、勾主键列、起业务名、选显示列保存
- **THEN** 实体入列并出现在小图谱，对象列表以显示列呈现对象名

#### Scenario: 对象浏览付费档

- **WHEN** cell 档客户点入实体对象列表并打开某对象详情
- **THEN** 看到属性值与按关系分组的关联对象；免费档客户不出现该入口

#### Scenario: 关系表单纪律

- **WHEN** 客户在某实体上添加关系
- **THEN** 目标实体下拉仅本企业其他实体，目标列下拉仅该目标实体主键列，
    源列下拉为源实体数据集列；m:n 须选中间数据集与两列

### Requirement: 文档与红线

web 文档页「实体」章节 SHALL 更新为 v2 口径：属性元数据、1:n/m:n 关系、对象
浏览、MCP 对象工具的用法与边界（m:n 物化不支持、对象浏览 cell 档专属、
自有对象搜索在 wire 入口而非 business-mcp）如实说明，随代码同批上线
（能力上线同批配文档红线）；公开面（未登录）不暴露任何实体图谱与对象数据
（图谱与对象端点 console 身份专属）。

#### Scenario: 教程同批

- **WHEN** 本能力上产
- **THEN** 文档页「实体」章节为 v2 内容（zh/en），覆盖声明→关系→对象浏览→工具面

#### Scenario: 图谱不外泄

- **WHEN** 未登录调用图谱或对象端点
- **THEN** 401（console 身份门兜底）

### Requirement: 关系物化——数据集间语义连接

引擎提供 `customer_dataset_link` 工具：按（左集, 左列, 右集, 右列）把两个
cell 数据集连接为新派生数据集——LEFT JOIN 语义（左表行全保留，右列未命中
置 NULL，绝不取邻值）；右列与左列撞名时以 `right_` 前缀命名，未撞名右列保留
原名；子集主键=左集主键；行数超上限整批拒绝（子集保持原状）；血缘记录
kind="link"（parent=左集，spec 含右集与两侧列），`derive_refresh` 按记录
spec 重连。**m:n 关系物化 SHALL 走同一工具的中间集路径（不建第二工具/第二
物化实现）**：按（源集, 目标集, 中间集, 中间集两列）以桥行驱动展开**关系对**
——INNER 语义（一条桥行一行结果；无桥关联的端点行不入结果，不得产出全 NULL
伪行）；结果列＝源/目标两侧列（目标撞名列沿 `right_` 前缀），中间集列不进
结果（纯路径）；桥行引用的端点主键值失存（孤儿桥）SHALL 丢弃并计数如实上报
（响应/台账区分估算与实数）；子集主键＝两端主键成对键；物化前 SHALL 按桥行数
估算展开规模，估算超上限 422 如实给数、零写、子集不登记（闸值读既有 link
行数上限单一真源，配置不硬编码），展开实数仍受引擎行数闸整批拒绝；三端
（源/目标/中间数据集）均须 cell 档，任一免费档 403 档位闸如实。console 侧
`POST /api/v1/entities/{id}/relationships/{rel_id}/materialize` 按关系声明
一键执行（kind=m:n 走中间集路径）：子集登记为 derived（source_ref=左集），
列与体量回填；血缘 spec SHALL 含中间集三要素（junction 数据集与两列），
`derive_refresh` 按 spec 重连三端最新数据；n:1/1:1 spec 无 junction 键时
重放逐字等价（向后兼容）；关系或数据集失存 404、列漂移 4xx 如实、引擎不可达
502、旧引擎 cell（无 link 工具或不支持中间集参数）如实报错不伪造成功；
零半写（失败不落子集行）。

#### Scenario: 一键物化
- **WHEN** 客户对 cell 档两端的关系点「物化连接」
- **THEN** 生成连接数据集（左行全保留、命中行带右列值、未命中右列为空），
    出现在「我的数据」并挂上管线图（左父边）

#### Scenario: 撞名前缀
- **WHEN** 右集列名与左集列名冲突
- **THEN** 连接结果中该右列以 `right_` 前缀呈现，无冲突右列保留原名

#### Scenario: 档位闸
- **WHEN** 关系任一端数据集为免费档（api 档）
- **THEN** 403 档位闸如实（PLAN_TIER_REQUIRED 语义），零半写

#### Scenario: 重物化
- **WHEN** 对连接结果执行重派生（derive_refresh / 既有重派生入口）
- **THEN** 按血缘 spec 重连两侧最新数据，行数/列如实更新

#### Scenario: 旧引擎如实报错
- **WHEN** 目标 cell 引擎未含 link 工具（未滚动新 cell 镜像）
- **THEN** 物化端点返回可读错误（工具不存在），不伪造成功

#### Scenario: m:n 桥展开关系对
- **WHEN** 客户对经中间集「订单标签」声明的 m:n 关系「订单↔标签」执行物化，
    桥表含若干有效行与引用失存的孤儿桥行
- **THEN** 生成派生数据集：每有效桥行一行（订单列+标签列，无桥关联的订单/标签
    不成行、无全 NULL 伪行），孤儿桥行不入结果且响应如实上报「展开 N 对、
    孤儿桥丢弃 M 行」，中间集列不出现在结果中

#### Scenario: m:n 三端档位闸
- **WHEN** m:n 关系的中间数据集为免费档（源/目标均 cell 档）
- **THEN** 403 档位闸如实（三端任一免费档即拦），零半写

#### Scenario: m:n 估算超上限拒绝
- **WHEN** 桥行数估算超既有 link 行数上限时调用物化
- **THEN** 422 如实给估算值，子集不登记、零写

#### Scenario: m:n 重物化走最新桥
- **WHEN** 对 m:n 物化结果执行重派生，桥表在首次物化后新增了行
- **THEN** 按血缘 spec（含 junction 三要素）重连，新增关系对进入结果，
    行数/列如实更新

#### Scenario: 旧引擎不支持中间集如实报错
- **WHEN** 目标 cell 引擎的 link 工具不支持中间集参数（旧镜像）
- **THEN** 物化端点返回可读错误（参数不支持），不伪造成功、不落子集行

### Requirement: 实体属性元数据

实体 SHALL 支持可选属性元数据：`display_column`（∈ 绑定数据集列快照；对象
列表/详情与 AI 上下文的对象展示名）与可选 `column_notes`（`{column: 注记}`
字典，注记为单位/格式等纯描述文本，≤50 字/列）。保存 SHALL 校验列存在于
数据集列快照（422 字段级）；数据集列漂移不追改（沿实体主键同口径，漂移在
使用处如实）。不携带新键的存量实体行为与读取形状逐字不变（零迁移）。

#### Scenario: 设置显示列

- **WHEN** owner 为实体「客户」设置 display_column=客户名称
- **THEN** 保存成功，对象列表以客户名称呈现各行

#### Scenario: 列不存在拒绝

- **WHEN** display_column 指向数据集中不存在的列
- **THEN** 422 字段级指明，零半写

#### Scenario: 存量零漂移

- **WHEN** 读取未设置属性元数据的 v0 实体
- **THEN** 响应形状与 v0 逐字一致（新键缺省省略或空）

### Requirement: 对象实例浏览端点

console 身份 SHALL 提供对象浏览三端点：①`GET /api/v1/entities/{id}/objects`
（实例列表：关键字/列筛选/排序/分页，limit 钳制，列表按数据集查询执行）；
②`GET /api/v1/entities/{id}/objects/{key}`（单对象：主键等值取行 + 属性元数据
渲染信息，零行命中返回结构化「无此对象」态不泄露历史存在性）；③
`GET /api/v1/entities/{id}/objects/{key}/relations/{rel_id}`（关系遍历：n:1 反查
目标行、1:n 按声明列过滤目标集、m:n 经中间集两段查询，分页）。三端点 SHALL
只执行实体声明所含查询（读边界沿 record-view 纪律——不开放任意查询/任意列/
任意数据集）；列漂移在取数时如实标注；引擎不可达 502、免费档 403 档位闸
如实（沿关系物化先例）；跨企业实体 404 不泄露。

#### Scenario: 列表到详情到遍历

- **WHEN** 客户在对象列表搜索某客户并打开详情，再查看其「订单」关联对象
- **THEN** 三次请求分别返回行列表、单对象属性、按关系过滤的订单行

#### Scenario: 声明外查询拒

- **WHEN** 任何试图以非声明列/任意过滤形态调用对象端点
- **THEN** 无此端点形态可用（404/422 如实），读边界不因新能力扩大

#### Scenario: 免费档档位闸

- **WHEN** 免费档客户调用对象浏览端点
- **THEN** 403 档位闸如实（PLAN_TIER_REQUIRED 语义），声明与图谱不受影响

### Requirement: MCP 对象工具

wire-ops-mcp SHALL 新增三个只读客户面工具：`wire_object_search`（entity_id +
关键字/筛选/limit → 对象列表，含显示列与主键）、`wire_object_get`（entity_id +
主键值 → 单对象属性）、`wire_object_relations`（entity_id + 主键值 + rel_id →
关联对象列表，分页钳制）。进站 Bearer 原样转发（双轨鉴权沿既有）；跨企业
entity_id 一律 404 不泄露；limit 钳制沿工具面纪律；工具命名 verb_noun，
`tool-surface.json` 同批更新。MUST NOT 提供任何对象写工具（对象修改沿
修正层既有通道与 wire-domain-actions 动作闸，工具面结构性无写）。

#### Scenario: 集群搜自有对象

- **WHEN** 舰队岗位调 `wire_object_search` 按关键字搜客户实体
- **THEN** 返回对象列表（显示列+主键），计量按调用方凭据沿 wire 入口口径

#### Scenario: 遍历关联对象

- **WHEN** agent 调 `wire_object_relations` 取某客户的订单（n:1 反向遍历）
- **THEN** 返回订单实体对象列表（分页钳制），只含声明关系可达的数据

#### Scenario: 工具面无写

- **WHEN** 检查 wire-ops-mcp 对象工具面
- **THEN** 只有三个只读工具，不存在对象写工具

### Requirement: 经提案的声明写入通道

实体与关系 SHALL 可经「内置声明动作」的确认提议落库（通道语义见 `wire-domain-actions`
「效果执行落修正层」metadata 段）：执行 MUST 复用控制台直接声明的同一 service 路径与
同一校验器（业务名唯一性、主键列 ⊆ 数据集列快照、关系目标 ∈ 目标实体主键集合、m:n
中间集两列值域、他企 404 隔离），落库结果与控制台直接声明逐字段同构，SHALL NOT 引入
第二套声明语义或第二份校验实现。免费档 SHALL 同等可用（声明本身非付费能力，与对象
浏览的付费闸无关）。提议即时返回 pending（沿既有「提议立即返回」纪律），执行结果由
实例台账如实承载（成功含实体/关系 id 引用，失败含原因且零半写）。本通道 MUST NOT
改变既有 CRUD 端点、图谱端点、AI 注入、物化端点的任何语义——经本通道落的实体与经
控制台落的实体，在所有读面上不可区分。

#### Scenario: 提案落的实体与控制台落的同构

- **WHEN** 一个 `entity-declare` 内置动作经确认执行成功，随后调图谱端点
- **THEN** 该实体出现在图谱 nodes 中，字段（业务名/数据集/主键/显示列）与控制台
    直接声明的实体逐字段同构，无任何「来源」差异暴露

#### Scenario: 提案与控制台声明校验同源

- **WHEN** 提议的实体主键列不在绑定数据集列快照（或关系目标列不在主键集合）
- **THEN** 与控制台声明同样 422 字段级拒绝，提议不进 pending，不落任何行

#### Scenario: 免费档可用

- **WHEN** 免费档客户经控制台或经确认提议声明实体
- **THEN** 声明成功、图谱可见（付费闸只作用于对象浏览，与本通道无关）

#### Scenario: 跨企业隔离

- **WHEN** 甲企业岗位试图提议引用乙企业实体作关系目标
- **THEN** 按既有 404 不泄露语义拒绝，两端不同属本企业不落关系行

#### Scenario: 读面零漂移

- **WHEN** 仅经本通道声明实体、全程不动控制台声明端点
- **THEN** 既有 CRUD 端点、图谱端点、AI 构建上下文注入、物化端点的响应语义与
    未上线本能力时逐字一致（新通道只增写入入口，不改任何读面契约）

### Requirement: 本体变更事件流

系统 SHALL 为每一次本体变更（实体或关系的创建/更新/删除）追加一条不可变事件，落 `ontology_events`：字段 SHALL 含客户的顺序号、customer_id、op（create|update|delete）、target_kind（entity|relationship）、target_id、变更前全量（before，创建时为 null）、变更后全量（after，删除时为 null）、actor、via（action_gate|console|rollback）、舰队血缘（source_ref，经动作闸执行时原样带入；控制台路径为 null）、来源动作实例 id（经闸时）。事件写入 SHALL 与本体写入在同一数据库事务内——事件写入失败 SHALL 使整个变更失败（不产生"本体变了但没有事件"的窗口）。写面 SHALL 收敛到实体 service 单点：控制台 CRUD、动作闸执行器、回滚执行器三条路径 MUST 走同一收口。事件表 SHALL 只允许追加，系统 MUST NOT 提供修改或删除事件的接口。任一已声明实体/关系的变更 MUST NOT 逃逸事件流（绕过 service 的直改不在本要求保障范围，由运维纪律与完整性自检负责）。

#### Scenario: 控制台改实体留事件

- **WHEN** 客户在控制台把实体「订单」的显示列从 order_id 改为 order_no
- **THEN** 落一条 op=update、via=console 的事件，before 含旧显示列、after 含新显示列，其余字段完整

#### Scenario: 删除留事件

- **WHEN** 客户删除一条关系
- **THEN** 落一条 op=delete、target_kind=relationship 的事件，after 为 null、before 为该关系的全量字段

#### Scenario: 经闸声明带血缘

- **WHEN** 舰队岗位提议的实体声明经 owner 确认执行成功
- **THEN** 对应事件 via=action_gate，source_ref 与 source_instance_id 与动作实例一致

#### Scenario: 事件写失败整体失败

- **WHEN** 本体写入过程中事件插入失败（如事件表不可写）
- **THEN** 整个事务回滚，本体保持变更前状态，接口如实返回错误

#### Scenario: 无改事件接口

- **WHEN** 检查本体版本相关端点集合
- **THEN** 不存在任何修改或删除已有事件的端点（只读与追加）

### Requirement: 本体版本快照与发布

系统 SHALL 支持为本体打版本快照，落 `ontology_snapshots`：每客户版本号 SHALL 从 1 单调递增；每条快照 SHALL 含全量 manifest（entities[] + relationships[] 的当前态）、digest（规范 JSON 的 sha256）、trigger（daily|manual）、label（手动版可带）、创建人、时间。日快照 SHALL 在每日 03:30 UTC 由后台循环自动创建，当日无变更（无新事件）时 SHALL 静默跳过并不落快照；同 digest 的快照 SHALL NOT 重复创建。owner SHALL 可随时手动打发布版并附 label（同日已有日版仍照打）。快照 SHALL 不改变本体当前态（纯读后落档）。无本体的客户 SHALL NOT 产生快照。

#### Scenario: 日快照静默跳过

- **WHEN** 某客户近 24 小时无本体变更，日快照任务到点
- **THEN** 不创建快照、不增版本号，记一条跳过日志

#### Scenario: 手动发布版

- **WHEN** owner 打发布版并填 label「冒烟本体定稿」
- **THEN** 落一条 trigger=manual 的快照，版本号 +1，label 原样保存，响应返回版本号与 digest

#### Scenario: 同 digest 不重复

- **WHEN** 手动打发布版时当前态与最近快照 digest 相同
- **THEN** 不新增快照，响应如实说明「与 vN 内容一致」，版本号不变

#### Scenario: 首版即基线

- **WHEN** 系统性启用版本机制后首次打快照（日或手动），客户此前已有存量本体
- **THEN** 该快照版本号为 1，manifest 为该时刻当前态；系统 MUST NOT 虚构启用前的历史事件

#### Scenario: 无本体不出快照

- **WHEN** 客户没有任何实体与关系
- **THEN** 日任务不为该客户落快照

### Requirement: 本体版本导出

系统 SHALL 提供本体导出口 `GET /api/v1/ontology/export`：支持 `version=<n>` 导出指定版本快照的 manifest、缺省导出当前态（`current`）；支持 `format=json|yaml`（缺省 json）；支持 `provenance=true` 时为每条实体/关系附最近一次变更的舰队血缘出处。导出文档 SHALL 含 `schema_version`、`exported_at`、`customer_id`、`version`（或 "current"）、`digest`、`entities[]`、`relationships[]`。导出 SHALL 沿 console 身份与客户域隔离（他企与不存在的版本一律 404）。导出 MUST NOT 触发任何本体写入或快照创建。

#### Scenario: 导出当前态

- **WHEN** 客户导出当前本体为 YAML
- **THEN** 下载内容为规范 YAML，含 schema_version 与 digest，实体/关系逐条完整

#### Scenario: 导出历史版本

- **WHEN** 客户导出 version=2
- **THEN** 内容为 v2 快照的 manifest 原样（digest 与快照记录一致）

#### Scenario: 带出处导出

- **WHEN** 客户以 provenance=true 导出
- **THEN** 每条实体/关系附 source_ref（无经闸血缘的条目该键缺席，不写空串）

#### Scenario: 隔离与真实空态

- **WHEN** 请求他企版本、不存在版本，或本企业尚无任何本体
- **THEN** 前两者 404 不泄露；后者 200 返回空 manifest（entities/relationships 空数组）

### Requirement: 本体版本对比与回滚

系统 SHALL 提供本体 diff：①「当前 vs 最近快照」（即未发布变更）与②「任意两版本对比」，输出 SHALL 为实体/关系的逐条增（+1）/删（-1）/改（字段级 before→after）三组，改动条目 SHALL 可携带出处（source_ref）。系统 SHALL 提供回滚：对指定版本生成 plan（创建/更新/删除三组动作），plan SHALL 在执行前可预览；执行 SHALL 仅限 owner 确认后触发，且 MUST 经与常规写同一的 service 收口逐条执行，每条落 `via=rollback` 事件。回滚 MUST NOT 以直接覆盖表的方式实现（历史不得出现无事件的空洞），回滚本身 SHALL 可被再次回滚。回滚执行前 SHALL 重新校验（业务名唯一、主键列 ⊆ 列快照、目标列 ∈ 目标实体主键集合等既有校验器），任一失败 SHALL 如实报错并停止（已执行部分留事件，可再回滚）。跨企业访问 SHALL 404。

#### Scenario: 未发布变更可见

- **WHEN** 最近快照后发生过 2 条变更（+1 实体、1 条关系改动）
- **THEN** diff（当前 vs 最近快照）如实列出两组改动，并给出未发布变更计数 2

#### Scenario: 版本对比

- **WHEN** 客户对比 v2 与 v3
- **THEN** 返回逐条 +/-/改，字段级给出 before→after

#### Scenario: 回滚 plan 与执行

- **WHEN** owner 对 v2 生成回滚 plan 并确认执行
- **THEN** plan 预览先展示将创建/更新/删除的条目；执行后每条变更落 via=rollback 事件，当前态与 v2 manifest 等价（新快照 digest 与 v2 一致）

#### Scenario: 回滚校验失败如实停

- **WHEN** 回滚 plan 中某条更新因列快照漂移不可执行
- **THEN** 执行在该条如实报错并停止，已执行部分留事件，客户端可再次回滚修正

#### Scenario: 回滚再回滚

- **WHEN** 回滚执行后 owner 对回滚前版本再发起回滚
- **THEN** 允许执行（append-only 不变式下历史完整，回滚方向可逆）

### Requirement: 本体版本读面与控制台展示

console 身份 SHALL 提供版本读面：版本列表（版本号、digest、trigger、label、时间、规模计数）、未发布变更计数、diff 结果、完整性自检（当前态折叠 digest 与最近事件一致性）。控制台实体页 SHALL 展示版本区：版本时间线、未发布变更数、diff 入口、导出入口、打发布版入口、回滚入口（owner 可见）。任何新增读面 SHALL 沿客户域隔离且 MUST NOT 改变既有对象面/图谱/AI 上下文读面的响应形状。

#### Scenario: 版本时间线

- **WHEN** 客户打开控制台实体页
- **THEN** 版本区按时间倒序列出版本（含 digest 前 8 位与实体/关系计数），并展示未发布变更数

#### Scenario: 完整性自检发现逃逸写

- **WHEN** 本体曾被人以裸 SQL 直改（绕过 service，无事件）
- **THEN** 完整性自检报告当前态与事件折叠结果不一致，并指出差异条目

#### Scenario: 存量读面零变化

- **WHEN** 版本机制上产后调用实体列表/对象三端点/图谱端点
- **THEN** 响应形状与此前逐字节一致（新能力不渗入旧响应）
