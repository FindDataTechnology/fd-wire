# dashboard-renderer Specification

## Purpose
定义仪表盘产物的 v1 契约与控制台渲染/编辑：dashboard spec 从自由 JSON 升级为
可渲染结构（面板×快照数据），客户在产物页直接看见仪表盘并进行基础编辑（增删
面板/改标题/调布局），保存复用产物版本链——使 AI 生成的仪表盘从"JSON 文件"
变成"看得见的看板"，为方向 B（自定义看板与分享）铺第一块可视地基。

## Requirements

### Requirement: 仪表盘 spec v1 契约

dashboard 产物 spec 采用 v1 结构：标题 + 面板数组；每个面板含类型
（kpi/line/bar/table）、标题、栅格跨度、来源标注与**内嵌快照数据**
（columns+rows），可选携带**查询契约引用**（query，见「面板查询契约」）；
前端提供宽容校验——结构不合法的面板跳过并标注，不拒绝
整个看板；无 v1 结构的旧自由 JSON 显示为旧版格式只读视图。

#### Scenario: 合法看板渲染
- **WHEN** 打开含 kpi/line/bar/table 四类面板的 dashboard 产物
- **THEN** 四类面板按栅格布局渲染，数据来自面板快照

#### Scenario: 坏面板隔离
- **WHEN** 看板中某面板 snapshot 形状不合法
- **THEN** 该面板显示问题标注，其余面板正常渲染

### Requirement: 快照渲染

渲染以面板内嵌快照为数据源：kpi 呈现大数卡（值/单位/副标题），line/bar 以
echarts 渲染（x/y 轴依快照列推断），table 呈现列表（长表滚动）；空快照如实
显示无数据占位；渲染器标注快照口径（实时刷新属后续物化能力）。

#### Scenario: 空数据诚实呈现
- **WHEN** 面板快照为空
- **THEN** 显示无数据占位而非空白或报错

### Requirement: 基础编辑器

客户可对面板做增/删/改标题/移序/调跨度操作，kpi 面板可编辑值/单位/副标题；
编辑实时预览；保存走既有产物 PUT 端点产生新版本；未保存离开有提示。
v2 扩展：**图表类型互转**（line↔bar↔table 保 snapshot 零数据损失；kpi 与图表类
互转需确认——kpi 只取首值有信息取舍）、**面板复制**（新 id+副本标题+深拷贝）、
**source 与 config 编辑**（source 文本提示"填指标 code/数据集名，刷新依赖此标
注"；config 表单按 type 展开：kpi=单位/副标题，line/bar=x 轴名/y 轴名）、
未保存变更计数展示。

#### Scenario: 编辑即版本
- **WHEN** 客户编辑面板标题并保存
- **THEN** 产生新版本号，重新打开看到新标题，历史版本仍可查

#### Scenario: 类型互转保数据
- **WHEN** 客户把折线面板转为表格
- **THEN** snapshot 原样保留，表格呈现同一数据，保存后新版本生效

#### Scenario: 面板复制
- **WHEN** 客户复制某面板
- **THEN** 出现新面板（副本标题、独立 id、相同数据），可独立编辑

### Requirement: 产物页入口

产物页对 dashboard kind 提供「查看看板」入口（渲染态）并可切换编辑态；其他
kind 的产物页行为不变。

#### Scenario: 入口按 kind 分发
- **WHEN** 客户在产物页打开 dashboard 产物
- **THEN** 呈现看板视图入口；composite_indicator 等其他 kind 不出现该入口

### Requirement: 面板查询契约

面板新增可选 `query` 引用（与数据面 query 端点入参同形同界）：
`{dataset_id, filters?, sort?, limit?, columns?}`——filters 算子集合
eq/in/gt/gte/lt/lte/contains/startswith、sort 方向 asc/desc、limit 1..1000、
columns 投影列序即快照列序。前端宽容归一：非法 query 整体丢弃（面板仍按
快照渲染，不受影响）；编辑器增删/移序/复制/类型互转一律保留 query 不抹掉，
面板详情区显示「已绑定查询」徽标（含 dataset_id）；渲染数据源仍是快照
（query 是刷新契约，不是渲染输入）。

#### Scenario: 契约面板渲染
- **WHEN** 打开带 query 引用与快照的面板
- **THEN** 渲染使用快照数据（契约不参与渲染），面板显示已绑定查询徽标

#### Scenario: 非法契约宽容降级
- **WHEN** 面板 query 形状不合法（如算子不在白名单、dataset_id 缺失）
- **THEN** 该 query 被丢弃，面板按快照正常渲染，看板不整板失败

#### Scenario: 编辑保留契约
- **WHEN** 客户对带 query 的面板改标题/调跨度/复制/类型互转后保存
- **THEN** 新版本面板的 query 原样保留

### Requirement: AI 生成侧契约产出

`dashboard_spec_create` 工具指令要求：面板数据取自数据集查询工具时，面板
必须同时携带 `query` 引用（所用 dataset_id 与查询形参如实落盘）；kpi 面板
取单值采用 rows 模式约定（sort 到最近一行 + limit 1 + columns 投影到值列）；
`source` 仍作展示标注保留。

#### Scenario: 生成即带契约
- **WHEN** AI 经数据集查询工具取数生成看板面板
- **THEN** 该面板 spec 同时含 query 引用与展示用 source

### Requirement: 契约表单化绑定

编辑器面板详情区提供「绑定查询」段（未绑定的面板显示未绑定态）：数据集
选择（本企业数据集列表，呈现 tier 与行数）、投影列勾选（按数据集列序）、
过滤行（列 + 算子白名单 + 值）、排序（列 + asc/desc）、limit（1..1000）；
「试取数据」把试取结果写入面板本地快照（预览即所得，不自动保存）；「解绑」
清除面板 query；kpi 面板给「最近一期 + limit 1 + 投影值列」约定提示；保存
走既有版本链（query 随面板落盘）；已有 query 的面板表单回填原值。

#### Scenario: 人工绑定即契约
- **WHEN** 客户在编辑器选数据集、勾两列、加一条过滤并保存
- **THEN** 新版本面板 query 含该 dataset_id/列投影/过滤，刷新徽标仍呈现

#### Scenario: 试取预览
- **WHEN** 客户填好绑定条件点「试取数据」
- **THEN** 面板本地快照更新为试取结果（预览呈现），未保存离开仍提示

#### Scenario: 解绑
- **WHEN** 客户对已绑定面板点「解绑」并保存
- **THEN** 新版本面板不再携带 query，后续刷新按无契约面板处理
