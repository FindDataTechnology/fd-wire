# form-apps Specification

## Purpose
定义表单产物（kind=form）：以数据集为底的录入面——console 内构建（选数据集、
勾列配字段）与运行时提交（corrections insert，审计可回滚、永不写回客户源），
以及 published 表单的免登录分享与公开提交（令牌机器复用 dashboard-share，
提交按钉死版本 spec 校验+令牌级限流）。让客户把「记录/收集数据」做成一个
成熟 web 表单直接分享给别人填——方向 B 应用平台的第三支柱。

## Requirements

### Requirement: 表单产物契约

form 产物 spec 信封为 `{title, spec:{datasetId, fields[], submitLabel?,
successMessage?}}`；field 为 `{column, label, input: text|number|date|select,
required, options?}`（select 须带非空 options；column 在表单内唯一）。空白
创建生成最小空表单 spec（零字段、datasetId 为空）；spec 保存走产物既有版本链
（append-only）；datasetId 非空时必须指向本企业现存数据集（他企/不存在 422，
零半写）；列名是否仍在数据集中不在保存时裁决（构建器呈现实时列，提交时如实
校验）。

#### Scenario: 空白创建
- **WHEN** 客户以 kind=form 空白创建表单并起标题
- **THEN** 生成 draft 产物（v1=零字段未绑数据集的最小 spec），可进构建器

#### Scenario: spec 结构校验
- **WHEN** 保存的 form spec 缺 title、字段 input 越枚举、column 重复或
  select 无 options
- **THEN** 422 如实拒绝且零半写（不追加版本行）

#### Scenario: 数据集属主校验
- **WHEN** 保存的 spec.datasetId 指向不存在或他企数据集
- **THEN** 422 如实拒绝，不落版本

### Requirement: 表单构建器

console 产物页提供「新建表单」入口与 form 构建器：数据集选择（本企业列表，
含 tier/行数提示）→ 按数据集实时列勾选生成字段（默认 label=列名、input 按列
类型建议）→ 逐字段改 label/input/required/select 选项 → 提交按钮与成功文案
可配 → 保存追加新版本；未绑数据集保存允许（构建中间态），提交面在此态不可用
并如实提示。

#### Scenario: 勾列成字段
- **WHEN** 客户选数据集并勾选若干列保存
- **THEN** 生成对应字段的新版本，字段顺序=勾选时数据集列序

#### Scenario: 未绑数据集中间态
- **WHEN** 客户保存尚未绑定数据集的表单
- **THEN** 保存成功（版本追加），运行时显示「未绑定数据集」而非可提交表单

### Requirement: 表单运行时提交

console 内 form 详情内嵌运行时：渲染钉在当前版本的字段、必填校验、提交即
`POST /api/v1/datasets/{id}/corrections`（op=insert，整行 values）——api 档
走本地修正层（零引擎调用，免费档行数闸照常 429 如实）、cell 档透传引擎覆盖
层，actor 沿用 corrections 既有口径（`customer:<customer_id>`）；成功显示 successMessage，失败逐字段如实
呈现，不做静默丢弃。

#### Scenario: 提交落审计
- **WHEN** 客户在运行时填必填项并提交
- **THEN** 数据集落一条 insert 修正（actor=console 身份），有效视图立即可见
  该行，修正历史可回滚

#### Scenario: 免费档行数闸
- **WHEN** 免费档数据集行数已达上限时提交
- **THEN** 429 如实拒绝（配额原因），表单显示可读错误而非静默失败

### Requirement: 表单分享与公开提交

published 表单可生成签名分享链接（令牌机器/TTL/禁用语义与 dashboard-share
一致）；公开 GET 返回钉死版本 spec（仅字段定义与文案，零行数据）；公开
`POST /submit` 接收 `{values}` 并按钉死版本 spec 校验——未知列 422、必填
缺失 422、number/date/select 类型不符 422（number 收数值或数字串、date 须
YYYY-MM-DD、select 须在 options 内）——通过后按目标数据集 tier 走与运行时
相同的 insert 修正路径，actor=`share-form:{artifact_id}`（审计可归因到具体
表单）；令牌级滑动窗限流（缺省 60 次/小时，env FD_WIRE_SHARE_SUBMIT_RATE_
PER_HOUR 可调，超限 429 带 Retry-After）；令牌/发布态/版本行任一不满足统一
404；公开提交面零行数据读路径（写-only）。

#### Scenario: 公开提交成功
- **WHEN** 持有效令牌者按字段填写并提交
- **THEN** 201 返回成功文案，数据集落 insert 修正（actor=share-form:{id}），
    所有者可在修正历史看到该条并可回滚

#### Scenario: 钉死版本校验
- **WHEN** 表单改版出新版本后，旧令牌提交
- **THEN** 校验与写入仍按令牌钉死版本的字段定义执行（旧字段集）

#### Scenario: 字段校验拒绝
- **WHEN** 提交含未定义列、缺必填或类型不符的 values
- **THEN** 422 如实指明原因，数据集零写入

#### Scenario: 令牌限流
- **WHEN** 同一令牌提交频率超过限流窗
- **THEN** 429 带 Retry-After，超限提交不落库

#### Scenario: 统一 404
- **WHEN** 令牌无效/过期/产物非 published/kind 非 form
- **THEN** 一律 404 且错误形态一致，不泄露差异原因

### Requirement: 字段联动（条件显隐）

form 字段MUST支持可选单条件显隐规则 ``visibleWhen = {field, op, value?}``：
``op`` MUST ∈ ``eq|neq|gt|gte|lt|lte|contains|empty|notEmpty``（empty/notEmpty
不带 value，其余算子 MUST带标量 value——对象/数组拒）；``field`` MUST引用同
表单内**另一字段**的 column（自引用拒）。保存校验（前端体验层+后端裁决面双端
同规）MUST对非法形状如实拒（400/错误码定位到字段）。

求值语义（运行时与提交校验MUST逐字同规）：以当前 values 原样求值，控制字段
缺列/null/纯空白按空值参与；eq/neq/contains 双方 trim 后字符串比较；
gt/gte/lt/lte 双方可解析为有限数则数值比较、否则字典序字符串比较；条件为真
或无 visibleWhen = 可见。运行时隐藏字段MUST不渲染、值不进提交载荷、required
不强制。服务端提交校验MUST用同规求值：隐藏必填跳过校验；隐藏字段在 values
中携带值MUST 422 如实拒（不做静默丢弃）。无 visibleWhen 的存量 spec 行为
MUST零变化。

#### Scenario: 条件显隐往返
- **WHEN** 客户给字段配「当 类型=其他 时显示」，运行时选「其他」
- **THEN** 该字段出现且必填生效；改选其他选项后该字段隐藏、值不提交、
  提交成功（其必填不再拦截）

#### Scenario: 服务端防篡改
- **WHEN** 提交载荷对当前条件判定为隐藏的字段携带了值
- **THEN** 422，文案定位该字段（字段当前不可见，不能携带值）

#### Scenario: 非法条件拒
- **WHEN** visibleWhen 引用不存在的字段/自引用/算子越枚举/该带 value 未带
- **THEN** 保存被拒，错误定位到具体字段

#### Scenario: 存量零回归
- **WHEN** 加载/保存/提交无 visibleWhen 的既有表单
- **THEN** 行为与联动上线前逐字节一致

### Requirement: 多条件组合显隐

字段显隐规则 SHALL 支持多条件组合：可选键 ``visibleWhenGroup`` 为
``{mode: "all"|"any", conditions: [单条件, ...]}``（conditions 1..10 条，每条
即单条件显隐的冻结形状与算子枚举）。保存校验：与 visibleWhen 并存拒（422
定位字段）；组内条件的引用存在性/自引用二趟裁决（前向引用支持同现行）。
求值（双端逐字同规）：all=全部条件真才可见、any=至少一真可见；控制字段值
在提交 raw values 中即参与比较（组内不递归）；任一隐藏路径沿用既有纪律
（隐藏字段携带非空值拒、required 不检查、空值跳过不写键、web 侧清值）。

#### Scenario: all 组合

- **WHEN** 字段带 visibleWhenGroup{mode:"all", conditions:[{eq A}, {gt 金额}]} 且两条件均真
- **THEN** 字段可见可填；任一假即隐藏（携带值被 422 拒）

#### Scenario: any 组合与空组防御

- **WHEN** mode:"any" 且全部条件为假
- **THEN** 字段隐藏；conditions 为空数组或超过 10 条在保存时被 422 拒

#### Scenario: 与单条件互斥

- **WHEN** 字段同时携带 visibleWhen 与 visibleWhenGroup
- **THEN** 保存被拒，文案定位字段与互斥原因

### Requirement: 联动改选项

select 字段 SHALL 支持选项联动：可选键 ``optionsFrom`` 为
``{field, cases: {控制值: [选项...]}, fallback?: [选项...]}`（与静态 options
互斥，select 必须恰有其一；field 引用同表单另一字段，自引用/不存在拒）。
求值（双端逐字同规）：按 raw values 解析控制值（trim 字符串口径）命中 cases
取其列表，未命中/空值取 fallback，无 fallback 为空列表；**解析后选项为空的
字段按隐藏同规**（不可填即不可见）；提交时 select 值必须 ∈ 解析后选项
（公开提交端点以 raw values 重解析，防篡改同规 422）；web 运行时在选项变化
且现值不在新选项集时清值（不进载荷）。

#### Scenario: 级联选项

- **WHEN** select 带 optionsFrom（省→市映射）且控制字段值为命中的省
- **THEN** 运行时呈现该省选项列表；提交属于该列表的值通过、伪造不属于的值被 422 拒

#### Scenario: 空选项按隐藏

- **WHEN** 控制字段未填（无 fallback）→ 解析选项为空
- **THEN** 该字段视同隐藏：携带非空值被拒、required 不检查、空值跳过不写键

#### Scenario: 与静态选项互斥

- **WHEN** select 同时携带 options 与 optionsFrom
- **THEN** 保存被拒，文案定位字段与互斥原因
