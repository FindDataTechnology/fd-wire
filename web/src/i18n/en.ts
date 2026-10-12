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
    admin: "Admin",
    login: "Sign in",
  },
  home: {
    heroTitle: "Wire · B2B Data Platform",
    heroSubtitle:
      "A direct lane from indicator discovery to data in your ledger — metered by the row, presented as it is: exploration is free of charge, only materialization bills.",
    ctaCatalog: "Browse the catalog",
    ctaContact: "Contact us to get started",
    valueTitle: "Three value propositions",
    // Catalog figure is fetched live: {{total}} is rendered from /v1/catalog/stats
    // (floored to thousands, e.g. 57,000); falls back to value1TitleNoCount when
    // the stats endpoint is unreachable — no hardcoded figures in copy.
    value1Title: "{{total}}+ indicator catalog",
    value1TitleNoCount: "Indicator catalog",
    value1Desc:
      "The unified indicator registry, fully searchable without signing in — verified indicators read directly, registered ones on demand.",
    value2Title: "Data over MCP",
    value2Desc:
      "MCP protocol wires data straight into your toolchain and agents — rows flow in, no manual hauling.",
    value3Title: "AI builder × My data",
    value3Desc:
      "Live in the console: build analytical artifacts through AI conversation with instant preview; upload over the public web or sync via connectors (My data) to materialize into your analysis — file a demand for anything missing, delivered into your private scope.",
    lineNote:
      "One of five FindData lines — Yizuo aggregates, Wanxing shines; Wire settles by the row, straight into decisions.",
  },
  pricing: {
    title: "Pricing",
    // Stop-at-quota wording (wire-self-serve-launch task 7.1): no overage rate on any tier.
    subtitle:
      "Monthly fee with included quota, metered by the row, stop at quota, restored next month — plan figures are backend-configurable; below is the currently effective schedule.",
    perMonth: "/mo",
    cta: "Contact us to get started",
    loading: "Loading plans…",
    // Live-fetch fallback: capability cards without figures (no hardcoded plan figures).
    loadFailedNote:
      "Plan figures are temporarily unavailable — showing capabilities only; retry later or contact us for quota details.",
    // {{count}} renders included_lines from GET /api/v1/plans (not a source literal).
    includedLines: "{{count}} rows/mo included",
    stopAtQuotaLine: "Stop at quota, restored next month — no overage rate.",
    customQuote: "Enquiry",
    // Custom card main CTA (wire-ux-consolidation task 4.4): in-app route to the
    // demand form; the mailto contact stays as a secondary small link.
    ctaCustom: "File a demand for a quote",
    ctaCustomMailto: "or email us",
    featCatalog: "Full access to the {{total}}+ indicator catalog",
    featCatalogNoCount: "Full access to the indicator catalog",
    featMcp: "Data reads over MCP",
    featDemand: "Data demands (quoted separately)",
    // Tier names/descriptions keyed by code (free/basic/standard/custom);
    // prices and included lines are always live-fetched.
    tiers: {
      free: {
        name: "Free",
        desc: "Self-serve sign-up, validate the value.",
      },
      basic: {
        name: "Basic",
        desc: "For small teams getting started, with My data.",
      },
      standard: {
        name: "Standard",
        desc: "The usual fit for growing teams.",
      },
      custom: {
        name: "Custom",
        desc: "Tailored quota settled case by case — contact us.",
      },
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
        "Once the quota is exhausted, data reads fail closed (including scheduled artifact refresh) — no action needed: the full quota is restored automatically at the start of next month; upgrade if you need more headroom sooner.",
      pricingNote:
        "Four tiers (Free / Basic / Standard / Custom) with monthly included quota, stop at quota, restored next month — see the pricing page →",
    },
    dataPlane: {
    title: "Data-Plane REST API",
    intro:
      "The REST service face for customer data (derived datasets included): the same engine as the MCP tools, zero semantic drift. Auth via data-plane keys (minted in the console); reads are unmetered, guarded by rate limits and storage quotas.",
    colMethod: "Method",
    colEndpoint: "Endpoint",
    colPurpose: "Purpose",
    purposeCreate: "Create dataset: file upload / connector / declared (columns + PK)",
    purposeQuery: "Structured query: filters (11 operators) / sort / paging / count / distinct",
    purposeAggregate: "Aggregate: multi-column group by × count/sum/avg/min/max",
    purposeWrite: "Batch write: single transaction ≤1,000 ops, all-or-nothing",
    purposeColumn: "Schema evolution: add a nullable column",
    purposeDerive: "Query derivation: materialize results into a new dataset (lineage kept)",
    purposeJoin: "Indicator-join derivation: customer data × platform indicators (misses join as null)",
    purposeLineage: "Lineage: own derivation source and derived children",
    keyTitle: "Data-plane keys & key discipline",
    keyDesc:
      "Data-plane keys (wdk- prefix) never expire, revoke instantly, and can be scoped to a dataset allowlist. They are server-side secrets:",
    rule1: "Server-side only — never in browser pages or client code;",
    rule2: "Browser frontends always go through a BFF (session + server-side forwarding; a reference BFF is open-sourced at fd-wire/bff-reference);",
    rule3: "The REST data plane ships with CORS disabled — browser direct calls are rejected by design;",
    rule4: "Platform indicator data never rides REST — use the MCP calling face (long-lived key) or materialize via indicator-join derivation.",
    consoleLink: "Manage data-plane keys in the console →",
    mcpNote:
      "Agents and automation should prefer the MCP calling face (wire entrance): same engine, metering built in. The REST data plane is for self-built frontends and business systems.",
  },
  localData: {
    // "My data & connectors" customer tutorial (wire-connector-distribution
    // task 4): customer-facing wording distilled from deploy/README.md;
    // ops-level detail stays out of the docs page.
    title: "My data & connectors",
    intro:
      "Two ways in: upload over the public web (CSV / Excel, preview before creating) or run a connector inside your network that syncs on schedule — the connector only makes outbound connections and source credentials never leave your machines.",
    uploadTitle: "Uploading in three steps",
    uploadStep1:
      "Drop or pick a file (CSV / Excel): column names and inferred types are previewed first, nothing is stored;",
    uploadStep2:
      "Confirm columns and types: adjust per column as needed; over-limit row counts are rejected honestly;",
    uploadStep3:
      "Name and create: upload datasets are created immediately and visible to your company only.",
    connectorTitle: "Installing a connector in three steps",
    connectorStep1:
      "Generate a one-time pairing token in Console → My data → Connectors → Pairing wizard (valid for 15 minutes, single use);",
    connectorStep2:
      "Download fd-wire-connector for your platform and run the pairing command (pair --token …) on a machine that can reach the local source — the connector key is written only to the local config file (0600);",
    connectorStep3:
      "Run it with `run`: heartbeat reporting plus syncs following the cloud-side allowlist and schedule (--once runs a single smoke pass). The default is a full snapshot; per dataset you can switch to incremental watermark mode in its detail page — the first sync takes a baseline, later syncs transfer only rows past the watermark and merge by primary key (source-side deletes are not propagated; reset the watermark to fall back to a full snapshot).",
    residencyTitle: "Keeping it running",
    residencyIntro:
      "The samples below are starting points; keep the config file owned by a dedicated account with 0600 permissions (the connector warns at startup when looser).",
    systemdTitle: "Linux · systemd",
    systemdNote:
      "Place the unit at /etc/systemd/system/fd-wire-connector.service, then systemctl daemon-reload && systemctl enable --now fd-wire-connector.",
    nssmTitle: "Windows · nssm",
    nssmNote:
      "Alternatively use Task Scheduler with an “At startup” trigger for fd-wire-connector.exe run.",
    launchdTitle: "macOS · launchd",
    launchdNote:
      "Place the plist at ~/Library/LaunchDaemons/com.finddata.fd-wire-connector.plist and launchctl load it; running in the foreground works too.",
    troubleshootTitle: "Troubleshooting",
    troubleshootWarnings:
      "Heartbeat warnings: an allowlisted source missing from the connector's local sources is skipped and reported in the console's connector block — check the local source name spelling.",
    troubleshootDrift:
      "Schema-drift pause: when the source drops a column or changes a type, the dataset pauses automatically (keeping the last valid snapshot); confirm the new structure in the console and resume.",
    troubleshootRows:
      "Row limit: 500,000 rows per dataset by default — over-limit syncs are rejected; split or clean the data and sync again, or ask for a higher quota.",
    troubleshootRevoked:
      "After revocation: revoking takes effect immediately (the connector gets a 401); generate a new pairing token and run pair again — datasets and allowlists are kept.",
    consoleLink: "Open Console → My data →",
  },
  forms: {
    // Form-artifact customer tutorial (wire-form-builder task 5.1): the full
    // flow of create → bind → configure fields → try it → publish → share →
    // submissions landing in the correction history (keyed like docs.localData).
    title: "Forms: bringing data in",
    intro:
      "Turn \"recording and collecting data\" into a mature web form you can share for others to fill in: build it on one of your datasets, configure the fields, try it yourself, then publish and share — every submission lands in the dataset through the correction layer (visible and revertable), never writing back to your source.",
    stepsTitle: "Five steps to a form",
    step1:
      "Create: Console → Artifacts → New form — a title is all it takes to get a draft (the cell-free, AI-free birth path);",
    step2:
      "Bind a dataset and configure fields: pick one of your datasets, check columns to become fields (labels default to column names with input types suggested from column types; adjust label, number, date, dropdown options or required as needed), and optionally set the submit button and success message — saving appends a new version;",
    step3:
      "Try it: the form's detail view is the live runtime — fill the required fields and submit; the row lands in the dataset immediately as an insert correction;",
    step4:
      "Publish and share: once published, generate a signed share link (7/30/90-day validity) and send it out — recipients open it without signing in and fill it per the version pinned to the link;",
    step5:
      "Collect and roll back: all submissions settle in the dataset's correction history (attributable to the console or the specific shared form) and can be reverted one by one; the customer source is never touched.",
    consoleLink: "Open Console → Artifacts →",
  },
  entities: {
    // Entity semantic layer tutorial (wire-entity-layer task 3.3): declare →
    // relate → AI build with the graph → the v1 boundary stated as it is
    // (keyed like docs.forms steps).
    title: "Entities: business semantics for your data",
    intro:
      "Promote “tables” to “entities”: declare business objects (business name + dataset + primary-key columns) and link them with relationships (pointing at the target entity's primary key), and AI build conversations automatically carry your entity graph — the AI knows “Order.customer_id is Customer.id”, so it picks columns, explains connections and uses indicator joins with your semantics. Declaring is pure metadata, available on the free plan.",
    stepsTitle: "Four steps into the semantic layer",
    step1:
      "Declare an entity: Console → Entities → Declare entity — pick one of your datasets, check the primary-key columns and give it a business name (e.g. “Customer”, “Order”); at most one entity per dataset;",
    step2:
      "Add relationships: expand “Relationships” on an entity card and declare a directed link source column →(n:1 / 1:1) target entity.target primary-key column (e.g. Order.customer_id →(n:1) Customer.id) — the target column can only be one of the target entity's primary keys;",
    step3:
      "Build with the graph: head to “AI Build” and start a conversation — e.g. ask “order amount by the customer's city”: the AI's system context now includes the entity graph, so it joins the customer table via customer_id to get the city instead of treating column names as noise;",
    step4:
      "Current boundary (stated as it is): declaring entities and graph injection work on the free plan; link materialization is a cell-tier capability (see “Materialize a link” below); multi-relationship joins and cross-chain auto-materialization are out of scope for v1 (chain by declaring an entity on the joined result and linking again); column drift does not rewrite declarations — it surfaces at use time.",
    // Materialize-link subsection (wire-entity-link task 3.3): relationship
    // materialization ships in v1 — two steps (preconditions, then LEFT JOIN
    // semantics / collision prefix / free-tier 403 / old-cell window, as-is).
    materializeTitle: "Materialize a link: turn a relationship into a queryable joined dataset",
    materializeStep1:
      "Preconditions: both datasets are engine-materialized (cell tier) and the relationship is declared — expand “Relationships” on an entity card and click “Materialize link” on the row to create the joined dataset per the declaration (the action does not appear when either end is a free-tier api dataset; the server answers a 403 tier gate as-is);",
    materializeStep2:
      "The join is LEFT JOIN semantics: all left rows are kept and unmatched right columns are NULL (never neighbor values); a right column colliding with a left one gets a right_ prefix; the result is registered as a derived dataset in “My data” and can be derived and re-materialized further. If the target cell has not rolled the new engine image yet, you get an honest “tool not found” error — it works once the cell is rolled.",
    consoleLink: "Open Console → Entities →",
  },
  demands: {
      title: "Demand workflow",
      // Three-state machine (wire-ux-consolidation task 3.5): submitted →
      // in_progress → delivered, plus rejected; old eight-state names are gone.
      intro:
        "Missing an indicator? File a data demand — three states keep the timeline visible end to end (Received / In progress / Delivered), with delivery into your private scope (cell).",
      stepsTitle: "The three states",
      step1: "Received",
      step2: "In progress",
      step3: "Delivered",
      rejectedNote:
        "Any pre-delivery state may move to “Rejected” (reason archived and visible to you); we respond within 1 business day of submission.",
      cellLabel: "Cell provisioning (private-scope delivery)",
    },
    statusTitle: "Rollout status",
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
    // Self-service analysis workspace (wire-daas-analysis-referral): a persistent
    // capability entry, not catalog data.
    daasReferralTitle: "Self-service analysis workspace",
    daasReferralNote:
      "Facet ships a ready-to-use self-service analysis workspace — data access, indicators, dashboards and research in one flow. Two ways in: subscribe to a preset pack on the Base market (zero install, instant), or install fd-daas-mcp locally (one-command private deployment via install.sh).",
    daasMarketCta: "Subscribe on the Base market",
    daasInstallCta: "Install fd-daas-mcp locally",
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
      lexReferralNote:
        "This entry belongs to the legal domain and is served by the Lex platform: it stays visible here, and activation goes through manual compliance review (never automated).",
      lexReferralCta: "Activate on the Lex platform",
      lexReferralHint: "Activation and data delivery both happen on Lex: lex.finddatatech.cloud",
    },
  },
  demandNew: {
    title: "File a data demand",
    intro:
      "Describe your data need in a sentence — the status stays visible end to end, and delivery lands in your private scope.",
    prefilled: "Catalog anchor",
    descriptionPrefill: "Indicator {{code}}: ",
    descriptionLabel: "Describe your need (required)",
    descriptionPlaceholder:
      "One or two sentences on the data you want: indicator caliber, coverage, update frequency…",
    descriptionRequired: "Please describe your need.",
    emailLabel: "Contact email (required)",
    emailPlaceholder: "name@company.com",
    emailRequired: "Please enter a contact email.",
    emailInvalid: "That email address doesn't look valid (name@domain.tld).",
    companyLabel: "Company (optional)",
    companyPlaceholder: "e.g. Acme Data",
    // Source URLs + public data declaration (wire-demand-generation-orchestration 4.1).
    sourceUrlsLabel: "Source URLs (required, one per line)",
    sourceUrlsPlaceholder: "https://example.com/prices\nhttps://example.org/reports",
    sourceUrlsHint:
      "Web addresses where the data lives (http/https, no embedded credentials); one per line, blank lines ignored.",
    sourceUrlsRequired: "Please provide at least one source URL.",
    assertTitle: "Public data declaration",
    assertText:
      "I confirm the requested data is publicly accessible; for non-public data, please contact us offline.",
    assertRequired: "Please confirm the public data declaration before submitting.",
    errorSourceUrlEntry:
      "Source URL #{{index}} is invalid (must be an http/https address without embedded credentials).",
    errorSourceUrls:
      "Source URLs are invalid (must be http/https addresses without embedded credentials).",
    errorValidationGeneric:
      "The submission failed server-side validation — please check and retry.",
    submit: "Submit demand",
    submitting: "Submitting…",
    errorTitle: "Submission failed — please retry in a moment.",
    signInRequired:
      "Filing a demand requires signing in to the console first — demands then belong to your enterprise, with progress under “My demands”.",
    signInCta: "Go to sign-in",
    successTitle: "Your demand has been received",
    successBody: "We will respond within 1 business day.",
    successCode: "Demand code: {{code}}",
    back: "Back to catalog",
    viewMine: "View my demands",
  },
  console: {
    // Boot-time loading indicator (wire-console-boot-ux): visible spinner + text.
    boot: {
      loading: "Entering the console…",
    },
    title: "Console",
    chartTitle: "Dashboard placeholder",
    chartEmpty: "No data yet",
    nav: {
      chat: "AI Build",
      artifacts: "Artifacts",
      datasets: "My data",
      entities: "Entities",
      packs: "Packs",
      demands: "Demands",
      usage: "Usage",
    keys: "Data-Plane Keys",
      team: "Team",
    },
    topbar: {
      org: "Customer",
      plan: "Plan",
      logout: "Sign out",
    },
    auth: {
      loading: "Starting the console…",
      anonymousTitle: "Sign in required",
      anonymousBody:
        "Sign in to enter the console: AI builder, My data, artifacts and usage.",
      signIn: "Go to sign-in",
      loginPageLink: "Open the sign-in page →",
      blockedTitle: "Sign-in not available yet",
      blockedBody:
        "The server has not published its sign-in configuration (configured=false) — console sign-in is unavailable for now. Please contact the platform administrator.",
      configErrorTitle: "Failed to load the sign-in configuration",
      sessionErrorTitle: "Failed to establish the session",
      upgradeHint:
        "Onboarding may be temporarily unavailable — retry later or contact us.",
      retry: "Retry",
    },
    callback: {
      processing: "Processing the sign-in callback…",
      success: "Signed in — entering the console…",
      errorTitle: "Sign-in failed",
      backToLogin: "Back to sign-in",
    },
    keyOnce: {
      title: "Your platform key (shown once only)",
      hint: "Copy and store it now — for security, the plaintext key is never queryable again.",
      copy: "Copy",
    },
    // AI build guide card (wire-ux-consolidation task 2.1): the old chat page
    // is retired; the chat tab shows a Base trial guide — no timing promises.
    chatGuide: {
      title: "AI Build",
      body:
        "Wire's conversational build capability will be provided through this entrance; data trials run on Base — the demo page carries the published test account and a guided tour.",
      tryCta: "Try it on Base",
      haveAccount: "Already have a Base account? Enter directly",
    },
    artifacts: {
      title: "Artifacts",
      subtitle:
        "Six artifact kinds persisted across conversations — every spec save appends a new version, with a draft/published/archived lifecycle.",
      loading: "Loading artifacts…",
      errorTitle: "Failed to load artifacts",
      retry: "Retry",
      empty: "No artifacts",
      emptyHint:
        "Import a draft generated in the AI builder and it will appear here.",
      kindFilterLabel: "Artifact kind",
      kindAll: "All kinds",
      kinds: {
        dashboard: "Dashboard",
        form: "Form",
        composite_indicator: "Composite indicator",
        research_report: "Research workflow",
        alert_rule: "Alert rule",
        refresh_schedule: "Refresh schedule",
      },
      statusFilterLabel: "Status",
      statusAll: "All statuses",
      statuses: {
        draft: "Draft",
        published: "Published",
        archived: "Archived",
      },
      versionLabel: "v{{version}}",
      updatedLabel: "Updated",
      source: "Source conversation",
      sourceNone: "Created directly",
      viewSpec: "View spec",
      history: "Version history",
      publish: "Publish",
      archive: "Archive",
      restore: "Restore",
      actionErrorTitle: "Action failed, please retry later.",
      // Blank dashboard creation (wire-dashboard-blank-create): title input →
      // create → jump straight into the editor.
      create: {
        button: "New dashboard",
        titleLabel: "Dashboard title",
        titlePlaceholder: "Name your new dashboard",
        submit: "Create",
        creating: "Creating…",
        cancel: "Cancel",
        titleRequired: "Please enter a dashboard title.",
        failed: "Creation failed, please retry later.",
      },
      // Blank form creation (wire-form-builder task 4.4): the birth entry
      // alongside new dashboards.
      createForm: {
        button: "New form",
        titleLabel: "Form title",
        titlePlaceholder: "Name your new form",
        submit: "Create",
        creating: "Creating…",
        cancel: "Cancel",
        titleRequired: "Please enter a form title.",
        failed: "Creation failed, please retry later.",
      },
      viewer: {
        title: "Spec editor",
        note: "Saving to the server appends a new version; unsaved edits are buffered in this browser only as a leave-warning buffer.",
        saveServer: "Save to server",
        saving: "Saving…",
        savedVersion: "Saved as version v{{version}}.",
        invalidJson: "Not valid JSON — fix before saving.",
        saveFailed: "Save failed, please retry later.",
        bufferBadge: "Unsaved local edits",
        discardBuffer: "Discard local edits",
        locked: "This artifact is archived — the spec is read-only. Restore it to draft before editing.",
        loadError: "Failed to load the spec.",
      },
      versions: {
        title: "Version history",
        loading: "Loading versions…",
        empty: "No versions",
        fetchError: "Failed to load version history.",
        entry: "Version v{{version}}",
        operatorLabel: "Operator",
        copy: "Copy spec",
        copied: "Copied to clipboard.",
        close: "Close",
      },
    },
    // Dashboard renderer + basic editor (wire-dashboard-renderer): the
    // dashboard-kind view entry, snapshot-caliber note, legacy compat and
    // editor form labels.
    dashboard: {
      viewButton: "View dashboard",
      editButton: "Edit dashboard",
      paneTitle: "Dashboard view",
      loading: "Loading the dashboard…",
      loadError: "Failed to load the dashboard.",
      lockedBadge: "Archived · read-only",
      // Whole-board CSV export (wire-dashboard-export): the view-mode toolbar
      // button — snapshots compose into one local file, zero requests; the
      // share view has no such entry.
      exportCsv: "Export CSV",
      snapshotNote:
        "Snapshot data — Refresh re-fetches per panel bindings and saves a new version.",
      emptyPanels: "No panels yet — add one to start.",
      noData: "No data",
      badPanel: "Panel #{{index}} could not be rendered: ",
      badPanelReason: {
        not_object: "a panel must be a JSON object",
        bad_type: "panel type must be one of kpi / line / bar / table",
      },
      type: {
        kpi: "KPI card",
        line: "Line chart",
        bar: "Bar chart",
        table: "Data table",
      },
      legacy: {
        badge: "Legacy free-form",
        note: "This dashboard comes from an early free-form JSON spec and cannot be rendered yet — the raw JSON is shown below.",
        noEditHint: "Legacy free-form specs do not support visual editing — switch to the v1 panel structure in the spec editor.",
      },
      editor: {
        titleLabel: "Dashboard title",
        panelListTitle: "Panels",
        addTypeLabel: "Panel type",
        addPanel: "Add panel",
        panelTitlePlaceholder: "Panel title",
        spanOption: "{{span}} col",
        moveUp: "Move up",
        moveDown: "Move down",
        remove: "Delete",
        duplicate: "Duplicate",
        duplicateSuffix: " (copy)",
        convertLabel: "Convert to…",
        convertTo: {
          kpi: "Convert to KPI card",
          line: "Convert to line chart",
          bar: "Convert to bar chart",
          table: "Convert to data table",
        },
        convertConfirm:
          "KPI cards and charts use different data calibers (a KPI card shows only the first value) — converting changes how this panel is presented. Convert anyway?",
        sourceLabel: "Source",
        sourcePlaceholder: "Indicator code / dataset name (refresh relies on this annotation)",
        // Query contract badge (wire-dashboard-query-contract): the badge in
        // the binding-form header (rendered inside the form section since
        // wire-panel-query-binding — see the queryForm group below).
        queryBadge: "Query bound",
        queryDataset: "Dataset {{id}}",
        // Binding form section (wire-panel-query-binding task 2.1): dataset
        // picker / column checkboxes / filters / sort / limit plus preview and
        // unbind copy; 422/404/400 surface the server detail verbatim
        // (apiErrorText).
        queryForm: {
          sectionLabel: "Bind query",
          unbound: "Not bound",
          bind: "Bind",
          unbind: "Unbind",
          boundHint:
            "This panel is bound to a dataset query; refresh executes this contract deterministically.",
          datasetLabel: "Dataset",
          datasetPlaceholder: "Select a dataset…",
          datasetOption: "{{name}} ({{tier}} · {{rows}} rows)",
          datasetOptionPlain: "{{name}} ({{rows}} rows)",
          missingDatasetOption: "{{id}} (not in the list — possibly deleted)",
          loadingDatasets: "Loading datasets…",
          datasetsLoadFailed: "Failed to load the dataset list, please retry later.",
          columnsLabel: "Columns",
          columnsHint: "dataset order; unchecked = all columns",
          filtersLabel: "Filters",
          addFilter: "Add filter",
          sortLabel: "Sort",
          addSort: "Add sort",
          dirAsc: "Ascending",
          dirDesc: "Descending",
          removeRow: "Remove",
          op: {
            eq: "equals",
            in: "in (comma-separated values)",
            gt: "greater than",
            gte: "greater than or equal",
            lt: "less than",
            lte: "less than or equal",
            contains: "contains",
            startswith: "starts with",
          },
          limitLabel: "Row limit (1..1000)",
          tryButton: "Preview data",
          trying: "Previewing…",
          previewOk: "Previewed {{rows}} row(s) into the local snapshot (not saved).",
          tryFailed: "Preview failed, please retry later.",
          needDataset: "Select a dataset before previewing.",
          kpiHint:
            "KPI convention: sort by the period column descending, set the row limit to 1, and project only the value column — the first snapshot value becomes the KPI after refresh.",
        },
        xNameLabel: "X axis name",
        yNameLabel: "Y axis name",
        unsavedCount: "{{n}} unsaved change(s)",
        unsavedTitle: "Panels differing from the last saved version",
        kpiValue: "Value",
        kpiUnit: "Unit",
        kpiSubtitle: "Subtitle",
        save: "Save as new version",
        saving: "Saving…",
        savedVersion: "Saved as version v{{version}}.",
        saveFailed: "Save failed, please retry later.",
        dirtyLeaveConfirm: "You have unsaved changes — leave the editor anyway?",
        backToView: "Back to view",
        preview: "Live preview",
      },
      // Manual refresh (wire-dashboard-refresh): view-mode button and status
      // copy; 403 tier guidance and 502 engine failures surface the server
      // detail verbatim (apiErrorText). Contract stats
      // (wire-dashboard-query-contract): mode=contract renders per-panel
      // counts and failure reasons; the ai path keeps the success copy.
      refresh: {
        button: "Refresh data",
        refreshing: "Refreshing…",
        success: "Refreshed as version v{{version}}.",
        inProgress: "A refresh is already running for this dashboard — please retry shortly.",
        failed: "Refresh failed, please retry later.",
        contractSummary:
          "Refreshed as version v{{version}} (contract): {{refreshed}} refreshed / {{kept}} kept / {{failed}} failed.",
        contractFailure: "{{title}}: {{error}}",
      },
      // Signed share links (wire-dashboard-share): the artifact-page entry and
      // the public share view (login-free read-only, noindex, branding from
      // wire-share-branding).
      share: {
        button: "Create share link",
        docTitle: "Shared · {{title}}",
        untitled: "Untitled dashboard",
        loading: "Loading the dashboard…",
        invalidTitle: "Link invalid or expired",
        invalidBody: "This share link does not exist, has expired, or the artifact is no longer published — ask the sender to generate a new one.",
        disabledTitle: "Sharing not enabled",
        disabledBody: "No share secret is configured on the server; share links are unavailable for now.",
        // Branding (wire-share-branding): bilingual lockup — the Chinese name
        // 寻数·柏讯 and English name Wire shown together, identical in both
        // locales (does not follow the UI language).
        brandNameZh: "寻数·柏讯",
        brandNameEn: "Wire",
        ogDescription:
          "Baixun data dashboards — enterprise data × macro indicators",
        ogSiteName: "寻数·柏讯 Wire",
        footer: "Provided by 寻数·柏讯",
        footerVersion:
          "{{title}} · Provided by 寻数·柏讯 · Version v{{version}}",
        dialogTitle: "Share link",
        generating: "Generating the share link…",
        generateFailed: "Failed to create the share link, please retry later.",
        urlLabel: "Public link (viewable without sign-in)",
        copy: "Copy link",
        copied: "Copied to clipboard.",
        expiresLabel: "Expires at",
        // Validity options (wire-share-ttl-options): 7/30/90-day enum,
        // default 30; changing it regenerates the link, with the expiry
        // preview following the selection (server response overrides it).
        ttlLabel: "Validity",
        ttlOptions: {
          "7": "7 days",
          "30": "30 days",
          "90": "90 days",
        },
        ttlNote: "Changing the validity regenerates the link.",
        versionNote: "The link pins the version snapshot at creation time (v{{version}}) — regenerate it after edits.",
        close: "Close",
      },
    },
    // Form artifacts (wire-form-builder tasks 4.2/4.3/4.4): the form-kind row
    // expansion view, the shared runtime (console submits via corrections,
    // public submits via the share endpoint) and the builder (dataset picker →
    // column checkboxes → field cards → copy) strings.
    form: {
      viewButton: "Open form",
      editButton: "Edit form",
      paneTitle: "Form view",
      loading: "Loading the form…",
      loadError: "Failed to load the form.",
      lockedBadge: "Archived · read-only",
      // Public share page fallback title (when the response omits one).
      untitled: "Untitled form",
      // Public share page og:description (link-preview card blurb).
      ogDescription: "A Baixun data form — submissions land safely in the ledger",
      runtime: {
        submitDefault: "Submit",
        submitting: "Submitting…",
        successDefault: "Submitted — thank you.",
        unboundTitle: "No dataset bound",
        unboundBody:
          "This form is not bound to a dataset yet — pick one in the editor and save before filling it in.",
        requiredMark: "Required",
        errors: {
          required: "This field is required.",
          number: "Enter a number (decimals allowed).",
          date: "The date must be in YYYY-MM-DD format.",
          select: "Pick one of the options.",
          text: "Enter text.",
        },
        submitFailed: "Submission failed, please retry later.",
      },
      editor: {
        titleLabel: "Form title",
        datasetLabel: "Dataset",
        datasetPlaceholder: "Select a dataset…",
        datasetOption: "{{name}} ({{tier}} · {{rows}} rows)",
        datasetOptionPlain: "{{name}} ({{rows}} rows)",
        loadingDatasets: "Loading datasets…",
        datasetsLoadFailed: "Failed to load the dataset list.",
        retry: "Retry",
        columnsLabel: "Field columns",
        columnsHint: "check columns to become fields, in dataset order",
        columnLabel: "Column",
        fieldLabelLabel: "Display label",
        fieldInputLabel: "Input type",
        fieldRequiredLabel: "Required",
        fieldOptionsLabel: "Options (comma-separated)",
        fieldMissingColumn: "This column is no longer in the dataset",
        inputTypes: {
          text: "Text",
          number: "Number",
          date: "Date",
          select: "Dropdown",
        },
        submitLabelLabel: "Submit button text",
        submitLabelPlaceholder: "Default “Submit”",
        successMessageLabel: "Success message",
        successMessagePlaceholder: "Default “Submitted — thank you.”",
        save: "Save as new version",
        saving: "Saving…",
        savedVersion: "Saved as version v{{version}}.",
        saveFailed: "Save failed, please retry later.",
        dirtyLeaveConfirm: "You have unsaved changes — leave the editor anyway?",
        backToView: "Back to view",
        errors: {
          titleRequired: "The form title cannot be empty.",
          titleTooLong: "The form title exceeds the length limit (200).",
          badField: "A field is structurally invalid (missing column or label).",
          inputInvalid:
            "A field carries an input type outside the enum (only text/number/date/select).",
          columnDuplicate: "Two fields share the same column.",
          selectOptions: "Dropdown fields need at least one non-empty option.",
          labelTooLong: "A field label exceeds the length limit (100).",
          submitLabelTooLong: "The submit button text exceeds the length limit (50).",
          successMessageTooLong: "The success message exceeds the length limit (200).",
        },
      },
    },
    // Scheduled refresh section (wire-refresh-scheduler task 4.1): shared by
    // the derived-dataset detail page and the dashboard view mode — create
    // (preset intervals) / pause / resume / delete plus status display.
    schedules: {
      title: "Scheduled refresh",
      hint: "Refresh this target automatically on a fixed interval — the background scheduler runs it when due; pause or delete at any time.",
      loading: "Loading the schedule…",
      loadError: "Failed to load the schedule.",
      retry: "Retry",
      intervalLabel: "Refresh interval",
      intervals: {
        "60": "Every 1 hour",
        "360": "Every 6 hours",
        "1440": "Every 24 hours",
        "10080": "Every 7 days",
      },
      createSubmit: "Create schedule",
      creating: "Creating…",
      opError: "Schedule operation failed, please retry later.",
      pausedBadge: "Paused",
      activeBadge: "Scheduled",
      nextRunLabel: "Next run",
      lastStatusLabel: "Last result",
      statuses: {
        pending: "Awaiting first run",
        running: "Refreshing",
        ok: "Succeeded",
        failed: "Failed",
      },
      lastErrorLabel: "Last error",
      pause: "Pause",
      resume: "Resume",
      delete: "Delete",
    },
    datasets: {
      title: "My data",
      subtitle:
        "Customer datasets uploaded or synced via a connector — visible to this enterprise only, reads never count against plan quota.",
      // Free-tier inline quota and upgrade guidance (wire-free-tier-data-gate
      // 4.1/4.4): the full-page wall is retired into inline hints on limit
      // hits; all numbers come from the quota endpoint (never hardcoded).
      quota: {
        bar: "Free-tier quota: {{used}} of {{max}} datasets used · ≤{{rows}} rows per dataset",
        exhausted:
          "You have reached the free-tier limit of {{max}} datasets — remove datasets you no longer need to free a slot, or upgrade for more.",
        hitTitle: "Free-tier limit reached",
        hintBody:
          "The free tier caps the number of datasets and rows per dataset — remove datasets you no longer need to free a slot, or upgrade for higher limits plus connector and derivation capabilities.",
        cta: "Contact us to upgrade",
      },
      // Storage-tier badges (api lightweight storage / cell engine materialized;
      // shown only when the response carries storage_tier).
      tierBadge: {
        api: "Lightweight storage",
        cell: "Engine materialized",
      },
      // Paid-surface annotations (wire-free-tier-data-gate 4.2: connector and
      // derivation entries stay visible but marked as paid).
      paidFeature: {
        badge: "Paid tier",
        connectorsTitle: "Connector sync is a paid-tier capability",
        connectorsBody:
          "Connectors read local sources inside your network and materialize snapshots into your enterprise cell via the engine — that path requires Basic or above. You are on the free tier; after upgrading you can pair connectors, scope sources and set schedules here.",
        connectorsShort:
          "Connector sync and allowlist dataset creation open after upgrading (current tier: free).",
      },
      loading: "Loading datasets…",
      errorTitle: "Failed to load datasets",
      retry: "Retry",
      empty: "No datasets yet",
      emptyHint:
        "Try uploading a CSV / Excel file — confirm the column and type preview and it becomes a dataset.",
      source: {
        upload: "Upload",
        connector: "Connector",
        declared: "Declared",
        derived: "Derived",
      },
      rowCount: "{{count}} rows",
      sizeLabel: "Size",
      updatedLabel: "Last updated",
      pausedReason: "Paused: {{reason}}",
      syncStatus: {
        idle: "Idle",
        syncing: "Syncing",
        ok: "In sync",
        failed: "Failed",
        paused_drift: "Paused · schema drift",
        paused_quota: "Paused · quota exceeded",
      },
      openDetail: "View detail",
      upload: {
        title: "Upload a file to create a dataset",
        hint: "CSV / Excel supported: drop or choose a file, review column names and inferred types, then name it.",
        dropzone: "Drop the file here",
        choose: "Choose file",
        parsing: "Parsing…",
        errorTitle: "Upload failed",
        previewTitle: "Column and type preview",
        colName: "Column",
        colType: "Inferred type",
        previewRows: "{{count}} rows",
        overLimit: "Row count exceeds the limit and was rejected — split or clean the file and retry.",
        nameLabel: "Dataset name",
        namePlaceholder: "e.g. Store sales",
        create: "Create dataset",
        creating: "Creating…",
        createErrorTitle: "Failed to create dataset",
        cancel: "Cancel",
        created: "Dataset created and added to the list above.",
      },
      connectors: {
        title: "Connectors",
        subtitle:
          "A connector reads local sources inside your network and pushes full snapshots on schedule; source credentials never leave your premises.",
        pairing: {
          title: "Pairing wizard",
          hint: "Generate a one-time pairing token and pair on the target machine; the token is shown once.",
          generate: "Generate pairing token",
          generating: "Generating…",
          errorTitle: "Failed to generate a pairing token",
          tokenLabel: "Pairing token",
          onceHint: "Shown once only: copy it now — it disappears when you leave or refresh.",
          countdown: "Valid for {{time}}",
          expired: "Token expired — generate a new one.",
          dismiss: "Copied, close",
          installTitle: "Install guide",
          // wire-connector-distribution task 3.1: step 1 rides the download
          // manifest — real per-platform links + version/sha256; honest
          // "temporarily unavailable" when the manifest is unreachable.
          downloadsTitle: "Step 1 · Download fd-wire-connector (version {{version}}):",
          manifestLoading: "Loading download manifest…",
          downloadUnavailable:
            "Downloads temporarily unavailable (release manifest unreachable) — keep the command-line guide below, or contact support for the binaries.",
          platformMissing: "File missing for this platform — temporarily unavailable",
          copySha: "Copy sha256",
          copied: "Copied",
          docsLink: "See the full tutorial in Docs — “My data & connectors” →",
          step2: "On a machine that can reach the local source, run the pairing command:",
          pairCommand: "fd-wire-connector pair --token {{token}} --api {{api}}",
        },
        list: {
          title: "Connector status",
          empty: "No connectors yet — pair your first one with the wizard above.",
          version: "Version",
          latest: "Latest",
          upgradeHint: "Outdated (latest {{version}}) — upgrade recommended",
          heartbeat: "Last heartbeat",
          online: "Online",
          offline: "Offline",
          revoked: "Revoked",
          unknown: "—",
          revoke: "Revoke",
          revoking: "Revoking…",
          errorTitle: "Failed to load connectors",
          revokeError: "Failed to revoke",
        },
        whitelist: {
          title: "Allowlist and schedule",
          hint: "Pick a connector → name the source → name the dataset → set the schedule; the connector syncs accordingly.",
          connectorLabel: "Connector",
          connectorPlaceholder: "Select a connector",
          sourceNameLabel: "Connector source name (source_name)",
          sourceNamePlaceholder: "e.g. erp_db",
          sourceNameHint:
            "The sources[].name in the connector's local config, e.g. erp_db.",
          sourceRefLabel: "Table / file in source (source_ref)",
          sourceRefPlaceholder: "e.g. public.orders or sales.csv",
          sourceRefHint:
            "For PostgreSQL / MySQL enter the table name (schema prefix allowed); for file sources the file name.",
          requiredHint:
            "Source name and table/file name are both required — submission is blocked while either is empty.",
          nameLabel: "Dataset name",
          namePlaceholder: "e.g. ERP orders",
          cronLabel: "Schedule (cron)",
          cronPlaceholder: "e.g. 0 3 * * *",
          cronHint: "Leave empty for no automatic sync.",
          submit: "Add to allowlist",
          submitting: "Submitting…",
          errorTitle: "Failed to configure",
          empty: "Pair a connector first, then configure the allowlist.",
          created: "Added to the allowlist and the dataset is created.",
        },
      },
      query: {
        column: "Column…",
        value: "Value",
        sort: "Sort…",
        apply: "Query",
        reset: "Reset",
        activeNote: "server-side filter active",
      },
      detail: {
        back: "Back to list",
        loading: "Loading detail…",
        errorTitle: "Failed to load detail",
        previewTitle: "Data preview",
        previewHint:
          "Read-only by default; click \"Edit\" to double-click cells, delete rows, or add rows — edits queue first, and saving writes them to the correction layer one by one, never back to the customer source.",
        previewLoading: "Loading preview…",
        previewEmpty: "No rows to preview yet.",
        pagination: "{{total}} rows · page {{page}} of {{pages}}",
        prev: "Previous",
        next: "Next",
        save: "Save correction",
        cancel: "Cancel",
        saving: "Submitting…",
        editStart: "Edit",
        editDone: "Exit editing",
        dirtyCount: "{{count}} unsaved change(s)",
        queueDiscard: "Discard edits",
        leaveTitle: "Unsaved changes",
        leaveHint:
          "Leaving edit mode discards {{count}} unsaved change(s); this cannot be undone.",
        leaveConfirm: "Discard and exit",
        leaveCancel: "Keep editing",
        saveResultTitle: "Save results",
        saveResultOk: "Applied",
        saveResultFailed: "Failed",
        deleteRow: "Delete row",
        addRow: "＋ Add row",
        addRowTitle: "Add a row",
        addRowEnqueue: "Add to edit queue",
        addRowCancel: "Cancel",
        correctionError: "Failed to submit the correction",
        correctionsTitle: "Correction history",
        correctionsLoading: "Loading corrections…",
        correctionsEmpty: "No corrections yet.",
        correctionOps: {
          update: "Edit",
          delete: "Delete row",
          insert: "Add row",
        },
        reverted: "Reverted",
        dangling: "Dangling",
        channel: {
          "data-key": "App write",
          agent: "Agent write",
        },
        revert: "Revert",
        reverting: "Reverting…",
        revertError: "Failed to revert",
        danglingTitle: "Dangling list",
        danglingHint:
          "These correction anchors no longer exist in the latest snapshot — revert them one by one.",
        danglingEmpty: "No dangling corrections.",
        syncsTitle: "Sync history",
        syncsLoading: "Loading sync history…",
        syncsEmpty: "No syncs yet.",
        syncStatuses: {
          ok: "OK",
          failed: "Failed",
          drift: "Drift rejected",
          quota: "Quota rejected",
        },
        syncRows: "{{count}} rows",
        resume: "Confirm columns and resume",
        resuming: "Resuming…",
        resumed: "Sync resumed under the new schema.",
        pauseBanner:
          "Sync is paused on this dataset because of schema drift — the last valid snapshot is kept until you resume.",
        pauseQuotaBanner:
          "Sync is paused on this dataset because the quota was exceeded — resume after adjusting the quota or cleaning up.",
        resumeTitle: "Confirm accepted columns",
        resumeHint:
          "These columns come from the latest rejected drift — check and confirm to resume syncing under the new schema.",
        resumeColumnsEmpty:
          "No concrete column names could be parsed from the pause reason; confirming resumes with an empty column set.",
        resumeConfirm: "Confirm resume",
        resumeCancel: "Cancel",
        resumeError: "Failed to resume sync",
        deleteDataset: "Delete dataset",
        deleteTitle: "Delete this dataset?",
        deleteWarning:
          "Deleting removes the platform copy of the data and all correction records (including dangling ones); this cannot be undone. The customer source data is never touched.",
        deleteConnectorWarning:
          "This dataset comes from a connector: deleting stops its sync; the connector-side source is unaffected.",
        deleteConfirm: "Confirm delete",
        deleting: "Deleting…",
        deleteError: "Failed to delete",
        // CSV export (wire-dataset-export task 2.2): disabled while downloading,
        // truncation reported honestly.
        exportCsv: "Export CSV",
        exporting: "Exporting…",
        exportError: "Failed to export",
        exportTruncated: "Export truncated to the first 10,000 rows.",
        // Incremental sync settings (wire-incremental-sync): connector-source
        // datasets only — mode switch (incremental requires a watermark column),
        // current watermark state, reset watermark (next sync rebuilds in full),
        // and an honest merge-semantics note (source deletes do not propagate).
        syncSettings: {
          title: "Incremental sync",
          modeLabel: "Sync mode",
          modes: {
            snapshot: "Full snapshot",
            incremental: "Incremental (watermark)",
          },
          watermarkLabel: "Watermark column",
          watermarkPlaceholder: "Pick a column…",
          notSynced: "Not synced yet (first run takes a full baseline)",
          statusModeLabel: "Mode",
          statusColumnLabel: "Watermark column",
          statusValueLabel: "Current watermark",
          statusNone: "—",
          save: "Save",
          saving: "Saving…",
          error: "Failed to save sync settings",
          reset: "Reset watermark",
          resetting: "Resetting…",
          resetTitle: "Reset the watermark?",
          resetWarning:
            "The next sync will rebuild with a full snapshot (incremental merge is abandoned).",
          resetConfirm: "Confirm reset",
          resetCancel: "Cancel",
          honestyNote:
            "Incremental sync merges by primary key; rows deleted at the source are not removed. Reset the watermark to rebuild with a full snapshot.",
        },
        // Re-derivation + scheduled re-derivation (wire-pipeline-actions task
        // 1.2): derived + cell tier only — per-level cascade results, honest
        // cron registration state, and an explicit UTC note.
        rederive: {
          title: "Re-derive",
          hint: "Recompute this dataset from the current effective state of its sources per the archived spec (joins re-pull indicators = re-metered); cascade refreshes every derived child in turn — a single failed hop does not block the rest.",
          cascadeLabel: "Cascade to derived children",
          submit: "Re-derive",
          submitting: "Re-deriving…",
          error: "Re-derivation failed",
          ok: "OK",
          failed: "Failed",
          depth: "Level {{depth}}",
          cascadeEmpty: "No cascade results (cascade disabled, or no derived children).",
          schedule: {
            title: "Scheduled re-derivation",
            hint: "Re-derive this dataset automatically on a cron schedule (five-field expression, e.g. */5 * * * * for every 5 minutes).",
            utcNote: "The cron expression is evaluated in Coordinated Universal Time (UTC) — convert your local time when registering.",
            cronLabel: "cron expression",
            cronPlaceholder: "*/5 * * * *",
            save: "Register schedule",
            update: "Update cron",
            saving: "Saving…",
            opError: "Scheduled re-derivation operation failed",
            loadError: "Failed to load schedule registration",
            retry: "Retry",
            loading: "Loading schedule registration…",
            registered: "Registered",
            disabled: "Disabled",
            lastRunLabel: "Last run",
            never: "Not run yet",
            lastStatusLabel: "Last result",
            lastErrorLabel: "Last error",
            lastRowsLabel: "Last rows {{count}}",
            delete: "Remove registration",
            deleting: "Removing…",
          },
        },
        provenance: {
          title: "Provenance",
          hint: "Append-only hash-chain ledger of this dataset's events — immutable once recorded; anchored epochs can be verified offline with the evidence package.",
          statusLoading: "Loading provenance status…",
          statusError: "Failed to load provenance status",
          retry: "Retry",
          tierLabel: "Provenance tier",
          tiers: {
            off: "Off (not recorded)",
            chain_only: "Chain only",
            anchored_batch: "Anchored (batch)",
            anchored_realtime: "Anchored (realtime)",
          },
          tierError: "Failed to change tier",
          integrityOk: "Chain intact",
          integrityBroken: "Chain broken",
          integrityChecked: "{{count}} events verified",
          anchoringLabel: "Anchoring",
          anchoringNone: "No anchoring backend configured",
          anchoringNotSealed: "no epoch sealed yet",
          anchoringEpoch: "sealed through epoch {{epoch}}",
          anchoringLag: "{{count}} events pending",
          firstEvent: "Provenance starts at: {{time}}",
          timelineTitle: "Event timeline",
          timelineLoading: "Loading events…",
          timelineError: "Failed to load events",
          timelineEmpty: "No ledger events yet.",
          loadEarlier: "Load earlier",
          loadingEarlier: "Loading…",
          evidenceDownload: "Download evidence package",
          evidenceDownloading: "Downloading…",
          evidenceError: "Failed to download evidence package",
          eventTypes: {
            uploadRegistered: "Upload registered",
            correctionAdded: "Correction",
            correctionReverted: "Correction reverted",
            snapshotRefreshed: "Snapshot refreshed",
            correctionDangling: "Correction dangling",
            datasetDeleted: "Dataset deleted",
            cellLifecycle: "Cell lifecycle",
            epochSealed: "Epoch sealed",
          },
        },
      },
      // Pipeline sub-view (wire-transform-pipeline-view tasks 2.1/2.2): the
      // data page offers a "Datasets / Pipeline" sub-view switch; pipeline is
      // the enterprise-wide derivation lineage graph (read-only v0).
      pipeline: {
        viewList: "Datasets",
        tab: "Pipeline",
        subtitle:
          "Derivation lineage of this enterprise's datasets — sources in the leftmost column, each derivation one column further right; click a node to open the dataset detail. The view is read-only; refresh and derive actions live on the dataset detail page.",
        loading: "Loading pipeline graph…",
        errorTitle: "Failed to load pipeline graph",
        retry: "Retry",
        emptyHint:
          "No derived datasets yet — start a derivation or indicator join from a dataset's detail page.",
        truncated:
          "More than 500 datasets — the graph is truncated, only some nodes are shown.",
        anomalies:
          "{{count}} lineage edges were skipped (cycle or missing parent).",
        columnLabel: "Depth {{depth}}",
        updatedLabel: "Updated",
        scheduled: "Scheduled",
        tier: {
          api: "Free tier",
          cell: "cell",
        },
      },
    },
    // My demands (wire-ux-consolidation task 4.3): read-only list, no
    // transition controls.
    demands: {
      title: "My demands",
      subtitle:
        "The data demands you filed — status visible end to end (Received / In progress / Delivered; declined demands show the reason); progress is advanced on the platform side.",
      newCta: "File a new demand",
      loading: "Loading demands…",
      errorTitle: "Failed to load demands",
      retry: "Retry",
      empty: "No demands yet",
      emptyHint:
        "File your first one from a catalog entry's “Request access” or the pricing page's “Custom” card.",
      submittedAt: "Submitted {{time}}",
      rejectedReason: "Declined: {{reason}}",
      statuses: {
        submitted: "Received",
        in_progress: "In progress",
        delivered: "Delivered",
        rejected: "Declined",
      },
      // Orchestration timeline (wire-demand-generation-orchestration 4.2,
      // customer-facing): rendered only when the demand carries the field.
      orchestration: {
        title: "Generation progress",
        prLink: "View PR",
        stages: {
          workorder_submitted: "Entered the generation pipeline",
          pr_open: "Crawler generated · pending human review",
          merged: "Review passed · deployment live",
          blocked: "Generation blocked · operations following up",
        },
      },
    },
    usage: {
      title: "Usage",
      subtitle:
        "This month's read usage and plan quota (rows_returned; the same source as the quota gate and billing).",
      periodLabel: "Period",
      planLabel: "Current plan",
      includedLabel: "Included rows",
      usedLabel: "Rows used",
      remainingLabel: "Remaining quota",
      stopNote:
        "Stop at quota, restored next month — reads beyond the included quota are rejected; no overage is ever billed.",
      lowWarning:
        "Less than 20% of this month's quota remains — pace your usage, or upgrade for more headroom.",
      exhaustedTitle: "This month's quota is used up",
      exhaustedBody:
        "The included quota is exhausted and data reads are paused — the full quota is restored automatically next month, no action needed; you can also upgrade for more quota now.",
      upgradeCta: "Contact us to upgrade",
      loading: "Loading usage…",
      errorTitle: "Failed to load usage",
      retry: "Retry",
    },
    keys: {
      title: "Data-Plane Keys",
      subtitle:
        "Credentials for the REST data plane (customer-data REST API): non-expiring, revocation is immediate. Server-side only — never in a browser.",
      mintTitle: "Mint a new key",
      labelPlaceholder: "Label (e.g. order-sync)",
      mintCta: "Mint",
      minting: "Minting…",
      allowlistLabel: "Dataset allowlist (none selected = all datasets)",
      allowlistScoped: "Scoped to {{count}} datasets",
      noDatasets: "No datasets yet",
      onceTitle: "Plaintext shown only once",
      copy: "Copy",
      copied: "Copied",
      onceDismiss: "Saved it",
      onceHint:
        "Only a hash is stored — the plaintext cannot be shown again. Store it in your server-side secret manager (BFF deploy env) now.",
      colLabel: "Label",
      colFingerprint: "Fingerprint",
      colScope: "Scope",
      colStatus: "Status",
      colLastUsed: "Last used",
      scopeAll: "All datasets",
      statusActive: "Active",
      statusRevoked: "Revoked",
      revokeCta: "Revoke",
      empty: "No data-plane keys yet.",
      loading: "Loading…",
      errorTitle: "Data-plane key operation failed",
      disciplineNote:
        "Key discipline: the key is a server-side secret. Browser frontends always reach the data plane through a BFF (session + server-side forwarding) — never embed the key in pages or client code.",
    },
    // Source packs (wire-source-packs task 3.3): themed pack card wall +
    // subscription toggling; browsing and subscribing are free (public catalog
    // channel, never through the metering track).
    packs: {
      title: "Packs",
      subtitle:
        "Themed slices of the indicator catalog — subscribe to track a whole pack; browsing and subscribing are free and available on every plan.",
      loading: "Loading packs…",
      errorTitle: "Failed to load packs",
      retry: "Retry",
      empty: "No packs yet",
      emptySubscribed:
        "You have not subscribed to any pack yet — hit “Subscribe” on a card to start.",
      indicatorCount: "{{count}} indicators",
      subscribedBadge: "Subscribed",
      onlySubscribed: "Subscribed only",
      expand: "View indicators",
      collapse: "Collapse",
      subscribe: "Subscribe",
      unsubscribe: "Unsubscribe",
      subscribing: "Subscribing…",
      unsubscribing: "Unsubscribing…",
      actionErrorTitle: "The subscription action failed — try again shortly.",
      loginHint: "Sign in to subscribe to packs — browsing stays open.",
      loginCta: "Go to sign-in",
      detail: {
        loading: "Loading indicators…",
        errorTitle: "Failed to load indicators",
        retry: "Retry",
        empty: "This pack has no indicators yet",
        colCode: "Code",
        colName: "Name",
        colDomain: "Domain",
        pageOf: "Page {{page}} of {{pages}} · {{total}} items",
        prev: "Previous",
        next: "Next",
      },
    },
    // Team (wire-team-spaces task 5): membership management, owner-only per
    // spec (team endpoints) — owner gets the roster, one-time invite codes and
    // revocation; editor/viewer get an honest 403 notice block.
    team: {
      title: "Team",
      subtitle:
        "Members and seats of your organization — the owner can generate one-time invite codes (invitees join on first sign-in and share the plan and quotas); member management is owner-only — editors and viewers cannot access this page.",
      loading: "Loading team…",
      errorTitle: "Failed to load team",
      retry: "Retry",
      forbiddenTitle: "Not allowed to view the team",
      forbiddenBody:
        "Your signed-in identity cannot view team information — contact the team owner to manage members.",
      myRole: "My seat",
      viewerNote: "Read-only seat: change operations are unavailable.",
      roleBadge: {
        owner: "Owner",
        editor: "Editor",
        viewer: "Viewer",
      },
      members: {
        title: "Members",
        joinedAt: "Joined {{at}}",
        remove: "Remove",
        removing: "Removing…",
        removeFailed: "Failed to remove member, please retry later.",
      },
      invite: {
        title: "Invite members",
        subtitle:
          "Generate a one-time invite code (valid for 24 hours, bound to a seat role) — the invitee joins your organization on first sign-in and the code is consumed.",
        roleLabel: "Seat role",
        submit: "Generate invite code",
        creating: "Generating…",
        failed: "Failed to generate the invite code, please retry later.",
        onceTitle: "Invite code (shown only once)",
        onceHint:
          "Shown only this once — it cannot be viewed again after leaving this page. Copy it and send it to the invitee now.",
        copy: "Copy",
      },
      invites: {
        title: "Pending invites",
        empty: "No pending invites.",
        revoke: "Revoke",
        revoking: "Revoking…",
        revokeFailed: "Failed to revoke the invite, please retry later.",
        expired: "Expired",
        remaining: "{{hours}}h {{minutes}}m left",
      },
    },
    // Entities (wire-entity-layer tasks 3.1/3.2): the lightweight entity
    // semantic layer — declarations, relationships and a mini SVG graph;
    // pure metadata with zero engine calls, available on the free plan.
    entities: {
      title: "Entities",
      subtitle:
        "Declare business objects as first-class metadata — an entity = business name + dataset + primary-key columns; relationships point at the target entity's primary key. The graph feeds the AI builder's context so it works with your business semantics (available on the free plan).",
      loading: "Loading entities…",
      errorTitle: "Failed to load entities",
      retry: "Retry",
      empty: "No entities declared yet",
      emptyHint:
        "Start with “Declare entity”: pick a dataset, check primary-key columns, give it a business name.",
      createOpen: "Declare entity",
      create: {
        title: "Declare entity",
        datasetLabel: "Bound dataset (at most one entity per dataset)",
        datasetPlaceholder: "Choose a dataset",
        noDatasets:
          "No datasets to choose from — upload or sync one under “My data” first.",
        pkLabel:
          "Primary-key columns (check at least one; must be among the dataset's columns)",
        pkEmpty: "Choose a dataset first — primary keys come from its columns.",
        nameLabel: "Business name (unique within your company)",
        namePlaceholder: "e.g. Customer / Order / Employee",
        descLabel: "Description (optional)",
        descPlaceholder: "One line about this business object",
        submit: "Create",
        creating: "Creating…",
        cancel: "Cancel",
        datasetRequired: "Choose a dataset first.",
        pkRequired: "Check at least one primary-key column.",
        nameRequired: "Enter a business name.",
        failed: "Creation failed — try again shortly.",
      },
      card: {
        delete: "Delete",
        deleteTitle: "Delete entity",
        deleteWarning:
          "Deleting entity “{{name}}” also deletes its {{count}} relationship(s) (every relationship it takes part in); the graph updates accordingly.",
        deleteWarningZero:
          "Delete entity “{{name}}”? It currently has no relationships.",
        deleteConfirm: "Delete",
        deleting: "Deleting…",
        cancel: "Cancel",
        deleteFailed: "Delete failed — try again shortly.",
      },
      relationships: {
        toggle: "Relationships ({{count}})",
        title: "Relationships",
        empty: "No relationships for this entity yet.",
        addTitle: "Add relationship",
        targetLabel: "Target entity",
        targetPlaceholder: "Choose a target entity",
        fromColumnLabel: "Source column (this entity's dataset column)",
        fromColumnPlaceholder: "Choose a source column",
        toColumnLabel: "Target column (target entity's primary keys only)",
        toColumnPlaceholder: "Choose a target column",
        kindLabel: "Cardinality",
        labelLabel: "Label (optional)",
        labelPlaceholder: "e.g. placing customer",
        submit: "Add",
        adding: "Adding…",
        targetRequired: "Choose a target entity.",
        fromRequired: "Choose a source column.",
        toRequired: "Choose a target column.",
        failed: "Failed to add the relationship — try again shortly.",
        removeFailed: "Failed to delete the relationship — try again shortly.",
        disciplineNote:
          "Relationships point at identity: the target column can only be one of the target entity's primary-key columns (e.g. Order.customer_id →(n:1) Customer.id).",
        kinds: {
          nTo1: "n:1 · many-to-one",
          oneToOne: "1:1 · one-to-one",
        },
      },
      // Materialize link (wire-entity-link task 3.2): the relationship-row
      // action — one-click LEFT JOIN into a linked dataset (rendered only
      // when both ends are cell tier; the 403 tier gate backs it up).
      materialize: {
        action: "Materialize link",
        working: "Materializing…",
        done:
          "Linked dataset “{{name}}” created — all left rows kept, unmatched right columns are NULL.",
        view: "View",
        failed: "Failed to materialize the link — try again shortly.",
        hint: "Join the two datasets per this relationship into a new derived dataset (LEFT JOIN: all left rows kept, unmatched right columns NULL; colliding right columns get a right_ prefix).",
      },
      graph: {
        title: "Entity graph",
        subtitle:
          "Nodes = entities, edges = relationships (with kind labels); click a node to jump to its card. This graph is the same source the AI builder's context draws from.",
        empty: "The graph is empty — declare entities to see them here.",
      },
    },
  },
  admin: {
    title: "Internal admin",
    nav: {
      customers: "Customers",
      ledger: "Ledger",
      demands: "Demands",
      catalog: "Catalog governance",
      usage: "Usage",
      localData: "Local data",
    },
    topbar: {
      identity: "Signed in as",
      gateNote:
        "Dual-gate channel: login role + server-side token (injected by the gateway, never visible to the browser).",
      exit: "Back to site",
    },
    roleGate: {
      title: "Internal admin access required",
      body: "This account does not carry the wire-admin role — ask an administrator to assign it in Logto if you need access.",
    },
    common: {
      loading: "Loading…",
      empty: "No data yet",
      working: "Working…",
    },
    error: {
      title: "Failed to load",
      authTitle: "Authentication failed",
      authHint:
        "The session is invalid or lacks the wire-admin role; the server-side second token gate is verified on the gateway.",
      retry: "Retry",
    },
    customers: {
      title: "Customer management",
      subtitle: "Onboarding (name + plan tier) and tier/status changes; the metering identity key is maintained here.",
      sub2apiNote: "Onboarding is local tier association only — sub2api payment account provisioning is upcoming work.",
      nameLabel: "Customer name",
      namePlaceholder: "e.g. Acme Data",
      planLabel: "Plan tier",
      callerLabel: "Metering identity (caller)",
      callerPlaceholder: "e.g. acme-caller",
      callerHint:
        "The metering identity is the caller username (v1 carried by sub2api_user_id) — usage joins attribute rows by this key.",
      create: "Create customer",
      createdNotice: "Customer created.",
      colName: "Name",
      colCaller: "Metering identity",
      colPlan: "Plan tier",
      colStatus: "Status",
      status: {
        active: "Active",
        suspended: "Suspended",
        closed: "Closed",
      },
    },
    ledger: {
      title: "Ledger",
      subtitle: "Authoritative ledger entries (read-only) — filter by customer and period, kinds color-coded.",
      customerFilter: "Customer",
      allCustomers: "All customers",
      periodFilter: "Period",
      usageOf: "{{name}} usage total",
      rowsUnit: "rows",
      callsUnit: "calls",
      noCallerMapping: "No metering identity mapped for this customer; usage cannot be attributed.",
      colKind: "Kind",
      colPeriod: "Period",
      colQuantity: "Quantity (rows)",
      colAmount: "Amount",
      colRef: "Key/Source",
      kindLegend: "Kind legend",
      kinds: {
        grant: "Plan grant",
        overage: "Overage",
        hardstop: "Hard stop",
        demand: "Demand billing",
        adjustment: "Adjustment",
      },
    },
    demands: {
      title: "Demand dispatch console",
      subtitle: "All-customer demand list with status filter and dispatch — transitions follow the three-state whitelist (submitted → in_progress → delivered, plus rejected with a reason); illegal options disabled.",
      statusFilter: "Status",
      statusAll: "All statuses",
      statuses: {
        submitted: "Received",
        in_progress: "In progress",
        delivered: "Delivered",
        rejected: "Rejected",
      },
      dispatch: "Dispatch",
      terminalHint: "Terminal demands have no legal transitions.",
      lastEvent: "Latest: {{status}} (by {{by}})",
      conflictDefault: "Transition rejected by the server (409) — whitelist or precondition not met.",
      targetLabel: "Target status",
      noteLabel: "Note",
      notePlaceholder: "Transition note, appended to the timeline",
      reasonLabel: "Rejection reason (required)",
      reasonPlaceholder: "Customer-visible, kept on file",
      submit: "Apply transition",
      illegalSuffix: "illegal",
      machineNote: "The client only disables illegal options; the server state machine is the single arbiter (409 shown as-is).",
      workorder: {
        title: "Generate workorder",
        hint: "Produce a health-loop generate workorder and queue it for the fleet puller (~every 30 min); exporting does not change demand status, re-export allowed with history preserved.",
        submit: "Generate workorder",
        pathLabel: "Ticket path",
        slugFree: "Slug confirmed free (target repo probe returned 404).",
        slugUnverified:
          "Slug probe unreachable — passed through honestly; occupancy is re-checked authoritatively against the puller's local checkout.",
        yamlSummary: "Full workorder YAML (manual-push fallback)",
        undelivered:
          "Queued but not delivered — awaiting the fleet puller (~30 min) or a manual push.",
        errorDefault: "Workorder export failed — see the server message above; retry later.",
      },
    },
    catalog: {
      title: "Catalog governance",
      subtitle: "registered (pending governance) and verified mirror list + review notes on file.",
      statusFilter: "Mirror status",
      registered: "registered · pending",
      verified: "verified",
      readonlyNote:
        "The mirror is writable only by the sync pipeline — status changes happen on the authority side; this page never edits mirror data, review notes are append-only.",
      notesToggle: "Review notes ({{count}})",
      noNotes: "No review notes yet.",
      notePlaceholder: "Enter a review note (caliber checks, extra hints…)",
      noteSubmit: "File note",
    },
    usage: {
      title: "Dual-track usage overview",
      subtitle: "Customer track (billable) and platform track (AI exploration, not billed) side by side, with source breakdown.",
      trackFilter: "Credential track",
      trackAll: "All tracks",
      trackCustomer: "Customer track",
      trackPlatform: "Platform track",
      trackCustomerHint: "billed to the customer",
      trackPlatformHint: "platform/AI exploration, not billed",
      startPlaceholder: "start ISO datetime (optional)",
      endPlaceholder: "end ISO datetime (optional)",
      bySourceTitle: "By source",
      colSource: "Source",
      colCalls: "Calls",
      colRows: "Rows",
      colRowsShare: "Row share",
      rowsUnit: "rows",
      callsUnit: "calls",
      sources: {
        yizuo: "Yizuo (yizuo)",
        wanxing: "Wanxing (wanxing)",
        platformInternal: "Platform internal",
        customer: "Customer-built",
      },
    },
    localData: {
      title: "Customer local data",
      subtitle:
        "Per-cell customer dataset storage usage and connector sync health (read-only) — part of the usage view remit; management actions stay self-service in the customer console.",
      readonlyNote: "Read-only page: no revoke / delete / whitelist management entry points.",
      colCustomer: "Customer (cell)",
      colDatasets: "Datasets",
      colStorage: "Storage usage",
      colConnectors: "Connectors (status / last heartbeat)",
      datasetsUnit: "datasets",
      noConnectors: "No connectors",
      connectorStatus: {
        online: "online",
        offline: "offline",
      },
    },
  },
  login: {
    title: "Sign in",
    loading: "Loading sign-in configuration…",
    subtitle:
      "Sign in to the Wire console — AI builder, My data, artifacts and usage in one place.",
    cta: "Sign in with Logto",
    blockedBody:
      "The server has not published its sign-in configuration (configured=false); sign-in is unavailable.",
    blockedHint: "This is not on you — please contact the platform administrator.",
    signedInAs: "Signed in as {{identity}}",
    goConsole: "Enter the console",
    signOut: "Sign out",
    errorTitle: "Failed to load the sign-in configuration",
    errorHint: "Retry in a moment; contact the platform administrator if it persists.",
  },
  // Footer (wire-ux-consolidation task 1.1): org/tagline wording mirrors the
  // fd-official-web footer.org / footer.line; filing numbers live in
  // components/footerConstants.ts.
  footer: {
    org: "FindData Technology",
    tagline: "Infrastructure and tools for text and data in the AI era.",
    github: "GitHub",
    servicesLabel: "FindData products",
    services: {
      official: "Website",
      base: "Base",
      lex: "Lex",
      more: "More products",
    },
  },
};

export default en;
