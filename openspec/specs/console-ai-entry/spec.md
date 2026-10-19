# console-ai-entry Specification

## Purpose

定义控制台"AI 构建"入口的过渡形态：客户面的对话 UI 由壹座试用引导卡承接（对话能力本体在壹座），后端对话服务保留为内部能力并为将来客户直连生成（萬星闭环）预留骨架。含 token 网关可达性修复的行为契约。

## Requirements

### Requirement: 控制台 SHALL 默认落地"我的数据"

进入 #/console 未指定子页时，MUST默认落在"我的数据"页而非对话页。

#### Scenario: 默认 tab 切换
- **WHEN** 客户登录后进入 #/console（无子路径）
- **THEN** 直接呈现"我的数据"页内容

### Requirement: AI 构建页 SHALL 呈现可对话的助手界面

控制台侧栏的"AI 构建"页 MUST 呈现可直接对话的助手界面，提供与浮层一致的问答与
构建能力（见 `assistant-panel` 能力）：客户可在页内输入并获得回答，产物构建入口
对具备数据处理引擎的档位可用。

该页 SHALL 保留前往壹座平台的深链入口（platform.finddatatech.cloud），供深度分析
场景使用，新标签页打开；SHALL NOT 再以纯跳转引导卡作为页面主体。页面文案 SHALL NOT
复述任何测试账号的邮箱或口令明文。

#### Scenario: 页内可对话
- **WHEN** 客户打开"AI 构建"页并输入一句话
- **THEN** 页面内直接给出回答，不发生整站跳转

#### Scenario: 保留壹座深链
- **WHEN** 客户打开"AI 构建"页
- **THEN** 页面上存在前往 platform.finddatatech.cloud 的链接，且在新标签页打开

#### Scenario: 不复述账号
- **WHEN** "AI 构建"页渲染
- **THEN** 页面文案不含测试账号的邮箱或口令明文

### Requirement: 对话后端 SHALL 保留且按能力分轨

后端对话服务（`/api/v1/ai/*` 会话、消息、产物端点）MUST 保留可用：LLM 调用经
token 网关（token.finddatatech.cloud）可达，不出现 404。

对话服务 SHALL 分为两轨并各自独立校验：

- **问答轨**：不依赖数据处理引擎，任意档位可用，不执行工具、不写产物。
- **构建轨**：依赖数据处理引擎，引擎未就绪时如实返回说明，不执行任何工具调用。

消息查询 SHALL 支持按已读位置增量获取，使长耗时构建过程可被客户端观察到进展。

#### Scenario: 免费档问答可用
- **WHEN** 无数据处理引擎的客户调用问答轨
- **THEN** 返回自然语言回答，不返回引擎未开通类错误

#### Scenario: 构建轨如实拒绝
- **WHEN** 无数据处理引擎的客户调用构建轨
- **THEN** 返回档位说明，且未发生任何工具调用

#### Scenario: 增量取消息
- **WHEN** 客户端以已读消息位置为起点查询消息
- **THEN** 只返回该位置之后新增的消息，用于展示构建进展

#### Scenario: 网关可达
- **WHEN** 持有效会话凭据发起一轮问答
- **THEN** LLM 调用经 token 网关返回成功，不出现"token 网关返回 404"类错误
