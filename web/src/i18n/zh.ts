const zh = {
  brand: {
    name: "柏讯",
    tagline: "B2B 数据平台",
  },
  nav: {
    home: "官网",
    pricing: "定价",
    docs: "文档",
    catalog: "指标目录",
    console: "控制台",
    login: "登录",
  },
  home: {
    heroTitle: "柏讯 Wire · B2B 数据平台",
    heroSubtitle:
      "从指标发现到数据入账的直通道——按行计量、如实呈现，探索不设门槛，物化才计费。",
    ctaCatalog: "浏览指标目录",
    ctaContact: "联系开通",
    valueTitle: "三条价值主张",
    value1Title: "57,000+ 指标目录",
    value1Desc:
      "统一指标注册目录全量可搜（无需登录）——verified 直读、registered 按需开通。",
    value2Title: "MCP 直连数据",
    value2Desc:
      "以 MCP 协议把数据直连进你的工具链与 Agent，行级回流，不做人工搬运。",
    value3Title: "AI 构建分析与爬虫需求闭环",
    value3Desc:
      "AI 对话构建分析产物；目录没有的指标提需求单，爬虫流水线构建后交付私有范围（控制台上线中）。",
    lineNote: "寻数五线并进：壹座之上、萬星闪耀——Wire 以数据行讫，直连商业决策。",
  },
  pricing: {
    title: "定价",
    subtitle:
      "月费含额度、超额阶梯单价、按行计量——档位数字后台可配，如下为当前生效口径。",
    perMonth: "/月",
    recommended: "推荐",
    cta: "联系开通",
    featCatalog: "57,000+ 指标目录全量浏览",
    featMcp: "MCP 直连数据读取",
    featDemand: "数据需求单（独立报价）",
    starter: {
      name: "入门版",
      price: "¥1,999",
      rows: "含 50 万行/月",
      overage: "超额 ¥0.004/行",
      desc: "小团队起步，验证数据价值。",
    },
    pro: {
      name: "专业版",
      price: "¥6,999",
      rows: "含 300 万行/月",
      overage: "超额 ¥0.003/行",
      desc: "成长期团队的常用档位。",
    },
    enterprise: {
      name: "企业版",
      price: "¥19,999",
      rows: "含 1,200 万行/月",
      overage: "超额 ¥0.002/行",
      desc: "高强度用量的规模档位。",
    },
    fnDemand: "* 数据需求单独立报价，不计入套餐行数额度。",
    fnLegal: "* 法律域数据默认询价开通，不进入公开目录直读。",
  },
  docs: {
    title: "文档",
    subtitle: "平台使用与计费的简明说明；操作细节以控制台为准。",
    quickStart: {
      title: "快速开始",
      mcpTitle: "MCP 端点",
      mcpDesc:
        "平台数据经 MCP 协议提供：在 MCP 客户端添加平台端点，即可发现并调用已开通的数据工具。",
      mcpEndpointLabel: "端点地址",
      keyTitle: "密钥（API Key）",
      keyDesc:
        "数据调用需携带平台密钥；密钥的创建、轮换与额度管理在控制台「密钥管理」进行。",
      keyExampleLabel: "调用示意",
      consoleLink: "前往控制台 →",
    },
    metering: {
      title: "计量与计费",
      rowsTitle: "按行计量",
      rowsDesc:
        "数据读取按返回行数计量；只有物化到客户范围的结果才计入用量。",
      exploreTitle: "AI 探索不计费",
      exploreDesc:
        "AI 探索阶段的调用不产生费用，产物物化后才计费——探索不设门槛。",
      alertTitle: "两档预警",
      alertDesc:
        "当月行数达到额度的 80% 与 95% 时，分别向客户负责人发送预警，服务不中断。",
      hardStopTitle: "硬停语义",
      hardStopDesc:
        "额度耗尽后数据读取 fail-closed 硬停（含产物定时刷新）；补充额度或调整套餐后恢复。",
      pricingNote: "套餐档位与超额单价，详见定价页 →",
    },
    demands: {
      title: "需求单流程",
      intro:
        "目录里没有的指标，提交数据需求单——八态状态机全程可见，交付进入私有范围（cell）。",
      stepsTitle: "八态状态机",
      step1: "已提交",
      step2: "评估中",
      step3: "已报价",
      step4: "待确认",
      step5: "构建中",
      step6: "交付验收",
      step7: "已交付",
      rejectedNote:
        "评估各阶段均可转入「已拒绝」（理由留档、客户可见）；构建不达标将停留在「构建中」并如实展示问题。",
      cellLabel: "cell 开通（私有范围交付）",
    },
    statusTitle: "能力上线状态",
    statusConsoleLabel: "控制台分析构建",
    statusDemandLabel: "需求单提交",
  },
  badge: {
    comingSoon: "上线中 · 即将开放",
  },
  catalog: {
    title: "指标目录",
    subtitle: "全量指标可搜索——无需登录；verified 可直读，registered 按需开通。",
    searchLabel: "搜索",
    searchPlaceholder: "搜索名称 / 描述 / code",
    domainLabel: "所属域",
    domainAll: "全部域",
    statusLabel: "状态",
    statusAll: "全部状态",
    statusVerified: "可直读",
    statusRegistered: "按需开通",
    colIndicator: "指标",
    colDomain: "域",
    colFrequency: "频率",
    colStatus: "状态",
    loading: "加载中…",
    emptyTitle: "没有匹配的指标",
    emptyHint: "试试更换关键词，或清除域 / 状态筛选。",
    errorTitle: "目录服务暂时不可用",
    errorHint: "请稍后重试；若持续失败请联系支持。",
    retry: "重试",
    paginationSummary: "共 {{total}} 条 · 第 {{page}} / {{pages}} 页",
    prevPage: "上一页",
    nextPage: "下一页",
    detail: {
      back: "返回目录",
      nameZh: "名称（中文）",
      nameEn: "名称（英文）",
      descriptionZh: "描述（中文）",
      descriptionEn: "描述（英文）",
      domain: "所属域",
      frequency: "频率",
      timeSpan: "时间跨度",
      timeSpanRange: "{{start}} – {{end}}",
      entityCoverage: "实体覆盖",
      entities: "{{n}} 个实体",
      sampleValue: "示例值",
      status: "状态",
      syncedAt: "同步时间",
      notFoundTitle: "指标不存在",
      notFoundHint: "该指标可能已下线或标识有误。",
      registeredBanner:
        "该指标为 registered 状态：需按需开通后才可使用，此处不提供任何数据读取入口。",
      enableOnDemand: "按需开通（提交需求单）",
      verifiedNote:
        "该指标为 verified 状态：登录后即可在控制台直接读取，本页不展示观测数值。",
      readData: "读取数据",
      readDataHint: "将引导你登录 / 开通",
    },
  },
  demandNew: {
    title: "提交数据需求单",
    placeholder:
      "需求单提交建设中——控制台上线后，此处将以预填指标提交需求单，状态全程可见，交付进入私有 scope。",
    prefilled: "预填指标",
    back: "返回目录",
  },
  console: {
    title: "控制台",
    placeholder:
      "控制台建设中——五类产物（仪表盘/组合指标/研究工作流/告警/定时刷新）与 AI 对话构建将在此上线。",
    chartTitle: "仪表盘占位",
    chartEmpty: "暂无数据",
  },
  login: {
    title: "登录",
    placeholder: "客户登录建设中——将以企业账户（owner / member）进入控制台。",
    cta: "联系我们开通",
  },
  footer: "© FindData · 柏讯 Wire · 寻数科技 wire 线",
};

export default zh;
export type Translation = typeof zh;
