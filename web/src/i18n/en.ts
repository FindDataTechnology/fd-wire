import type { Translation } from "./zh";

const en: Translation = {
  brand: {
    name: "Wire",
    tagline: "B2B data platform",
  },
  nav: {
    home: "Home",
    pricing: "Pricing",
    docs: "Docs",
    catalog: "Catalog",
    console: "Console",
    login: "Sign in",
  },
  home: {
    heroTitle: "Wire · B2B Data Platform",
    heroSubtitle:
      "A direct lane from indicator discovery to data in your ledger — metered by the row, presented as it is: exploration is free of charge, only materialization bills.",
    ctaCatalog: "Browse the catalog",
    ctaContact: "Contact us to get started",
    valueTitle: "Three value propositions",
    value1Title: "57,000+ indicator catalog",
    value1Desc:
      "The unified indicator registry, fully searchable without signing in — verified indicators read directly, registered ones on demand.",
    value2Title: "Data over MCP",
    value2Desc:
      "MCP protocol wires data straight into your toolchain and agents — rows flow in, no manual hauling.",
    value3Title: "AI-built analytics + crawler demand loop",
    value3Desc:
      "Build analytical artifacts by conversation; file a demand for anything missing and the crawler pipeline delivers into your private scope (console in rollout).",
    lineNote:
      "One of five FindData lines — Yizuo aggregates, Wanxing shines; Wire settles by the row, straight into decisions.",
  },
  pricing: {
    title: "Pricing",
    subtitle:
      "Monthly fee with included quota, tiered overage per row, metered by the row — plan figures are backend-configurable; below is the currently effective schedule.",
    perMonth: "/mo",
    recommended: "Recommended",
    cta: "Contact us to get started",
    featCatalog: "Full access to the 57,000+ indicator catalog",
    featMcp: "Data reads over MCP",
    featDemand: "Data demands (quoted separately)",
    starter: {
      name: "Starter",
      price: "¥1,999",
      rows: "500K rows/mo included",
      overage: "Overage ¥0.004/row",
      desc: "For small teams validating data value.",
    },
    pro: {
      name: "Professional",
      price: "¥6,999",
      rows: "3M rows/mo included",
      overage: "Overage ¥0.003/row",
      desc: "The usual fit for growing teams.",
    },
    enterprise: {
      name: "Enterprise",
      price: "¥19,999",
      rows: "12M rows/mo included",
      overage: "Overage ¥0.002/row",
      desc: "For high-volume, at-scale usage.",
    },
    fnDemand: "* Data demands are quoted separately and do not count against the plan's row quota.",
    fnLegal: "* Legal-domain data is enquiry-gated by default and not directly readable in the public catalog.",
  },
  docs: {
    title: "Docs",
    subtitle: "A concise guide to using and being billed on the platform; operational detail lives in the console.",
    quickStart: {
      title: "Quick start",
      mcpTitle: "MCP endpoint",
      mcpDesc:
        "Platform data is served over MCP: add the platform endpoint in your MCP client to discover and invoke the data tools enabled for you.",
      mcpEndpointLabel: "Endpoint",
      keyTitle: "API key",
      keyDesc:
        "Data calls require a platform key; keys are created, rotated and quota-managed under Console → Key management.",
      keyExampleLabel: "Call sketch",
      consoleLink: "Open the console →",
    },
    metering: {
      title: "Metering & billing",
      rowsTitle: "Metered by the row",
      rowsDesc:
        "Data reads are metered by returned rows; only results materialized into your scope count toward usage.",
      exploreTitle: "AI exploration is free",
      exploreDesc:
        "Calls made while exploring with AI are not billed — only materialized artifacts count. Exploration has no gate.",
      alertTitle: "Two-stage alerts",
      alertDesc:
        "When monthly rows reach 80% and 95% of the quota, alerts go to the account owner; service is not interrupted.",
      hardStopTitle: "Hard-stop semantics",
      hardStopDesc:
        "Once the quota is exhausted, data reads fail closed (including scheduled artifact refresh); they resume after a top-up or plan change.",
      pricingNote: "See the pricing page for plans and overage rates →",
    },
    demands: {
      title: "Demand workflow",
      intro:
        "Missing an indicator? File a data demand — an eight-state machine keeps the timeline visible end to end, with delivery into your private scope (cell).",
      stepsTitle: "The eight states",
      step1: "Submitted",
      step2: "Evaluating",
      step3: "Quoted",
      step4: "Awaiting confirm",
      step5: "Building",
      step6: "Delivery acceptance",
      step7: "Delivered",
      rejectedNote:
        "Any evaluation-stage state may move to “Rejected” (reason archived and visible to the customer); a failed build stays in “Building” with issues shown as they are.",
      cellLabel: "Cell provisioning (private-scope delivery)",
    },
    statusTitle: "Rollout status",
    statusConsoleLabel: "Console analytics building",
    statusDemandLabel: "Demand submission",
  },
  badge: {
    comingSoon: "In rollout · coming soon",
    comingSoonShort: "Coming soon",
  },
  catalog: {
    title: "Indicator catalog",
    subtitle:
      "Search the full catalog without signing in — verified indicators read directly, registered ones on demand.",
    searchLabel: "Search",
    searchPlaceholder: "Search name, description or code",
    domainLabel: "Domain",
    domainAll: "All domains",
    statusLabel: "Status",
    statusAll: "All statuses",
    statusVerified: "Direct read",
    statusRegistered: "On demand",
    colIndicator: "Indicator",
    colDomain: "Domain",
    colFrequency: "Frequency",
    colStatus: "Status",
    loading: "Loading…",
    emptyTitle: "No matching indicators",
    emptyHint: "Try a different keyword, or clear the domain / status filters.",
    errorTitle: "Catalog service unavailable",
    errorHint: "Please retry in a moment; contact support if it persists.",
    retry: "Retry",
    paginationSummary: "{{total}} indicators · page {{page}} of {{pages}}",
    prevPage: "Previous",
    nextPage: "Next",
    detail: {
      back: "Back to catalog",
      nameZh: "Name (Chinese)",
      nameEn: "Name (English)",
      descriptionZh: "Description (Chinese)",
      descriptionEn: "Description (English)",
      domain: "Domain",
      frequency: "Frequency",
      timeSpan: "Time span",
      timeSpanRange: "{{start}} – {{end}}",
      entityCoverage: "Entity coverage",
      entities: "{{n}} entities",
      sampleValue: "Sample value",
      status: "Status",
      syncedAt: "Synced at",
      notFoundTitle: "Indicator not found",
      notFoundHint: "It may have been retired, or the identifier is wrong.",
      registeredBanner:
        "This indicator is registered: it must be enabled on demand, and no data-read entry is provided here.",
      enableOnDemand: "Request access (file a demand)",
      verifiedNote:
        "This indicator is verified: sign in to read it directly in the console. No observation values are shown on this page.",
      readData: "Read data",
      readDataHint: "You will be guided to sign in / get access",
    },
  },
  demandNew: {
    title: "File a data demand",
    placeholder:
      "Demand submission is under construction — the console will file the demand with this indicator prefilled, with a fully visible timeline; delivery lands in your private scope.",
    prefilled: "Prefilled indicator",
    back: "Back to catalog",
  },
  console: {
    title: "Console",
    chartTitle: "Dashboard placeholder",
    chartEmpty: "No data yet",
    nav: {
      chat: "AI builder",
      artifacts: "Artifacts",
      demands: "Demands",
      usage: "Usage",
    },
    topbar: {
      org: "Enterprise (placeholder)",
      customerLabel: "X-Customer-Id",
      customerHint:
        "Development placeholder, dev use only — replaced by real sign-in once auth lands",
      save: "Save",
      login: "Sign in (placeholder)",
    },
    chat: {
      conversations: "Conversations",
      newConversation: "New conversation",
      conversationsLoading: "Loading conversations…",
      conversationsEmpty:
        "No conversations yet — send the first message to start one.",
      listErrorTitle: "Failed to load conversations",
      messagesLoading: "Loading messages…",
      messagesEmpty: "No messages in this conversation yet.",
      messagesErrorTitle: "Failed to load messages",
      retry: "Retry",
      startTitle: "Start a new conversation",
      startHint:
        "Your first message creates the conversation and runs one build loop (subject to the daily creation limit).",
      inputLabel: "Message input",
      inputPlaceholder: "Describe what to build next…",
      inputPlaceholderNew:
        "Describe the analysis you want — sending starts a new conversation…",
      send: "Send",
      sending: "Sending…",
      errorTitle: "Send failed",
      error429: "Daily conversation creation limit reached",
      error429Hint:
        "Try again tomorrow, or contact the platform to adjust the limit.",
      errorNetwork: "Network error — the console service is unreachable.",
      toolTrace: "Tool call",
      toolTraceArgs: "Arguments",
      toolTraceResult: "Result",
      resultOk: "OK",
      resultFail: "Failed",
    },
    artifacts: {
      title: "Artifact drafts",
      subtitle:
        "Draft artifacts staged by the AI build loop — grouped per conversation, with a link back to the source.",
      draftBadge: "Draft",
      draftNote:
        "All artifacts below are drafts — materialization in rollout: not yet landed in your enterprise cell, no metering incurred.",
      loading: "Loading artifacts…",
      errorTitle: "Failed to load artifacts",
      retry: "Retry",
      empty: "No artifact drafts",
      emptyHint:
        "Drafts generated in the AI builder will appear here.",
      kindFilterLabel: "Artifact kind",
      kindAll: "All kinds",
      kinds: {
        dashboard: "Dashboard",
        composite_indicator: "Composite indicator",
        research_report: "Research workflow",
        alert_rule: "Alert rule",
        refresh_schedule: "Refresh schedule",
      },
      source: "Source conversation",
      viewSpec: "View spec",
      viewer: {
        title: "Spec viewer",
        note: "Edits are saved only to this browser (localStorage) — real persistence and materialization are upcoming work.",
        localDraft: "Local draft",
        saveLocal: "Save locally",
        saved: "Saved to this browser (real persistence is upcoming work)",
        restoreOriginal: "Restore original spec",
        invalidJson: "Not valid JSON — fix before saving.",
      },
    },
    demandsPlaceholder: {
      title: "Demands",
      body: "Demand management is under construction — filing demands for indicators outside the catalog, with the eight-state timeline, will land here (today a placeholder filing can be started from a catalog detail page).",
    },
    usagePlaceholder: {
      title: "Usage",
      body: "Usage views are under construction — row-level metering, quota alerts and dual-track usage will land here.",
    },
  },
  login: {
    title: "Sign in",
    placeholder: "Customer sign-in under construction — enter the console with an enterprise account (owner / member).",
    cta: "Contact us to get started",
  },
  footer: "© FindData · Wire · FindData Tech wire line",
};

export default en;
