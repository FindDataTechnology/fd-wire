import type { Translation } from "./zh";

const en: Translation = {
  brand: {
    name: "Wire",
    tagline: "B2B data platform",
  },
  nav: {
    home: "Home",
    catalog: "Catalog",
    console: "Console",
    login: "Sign in",
  },
  home: {
    heroTitle: "Enterprise data, self-served",
    heroSubtitle:
      "Browse the indicator catalog, build analytics with AI, file data demands — metered by the row: exploration is free of charge, only materialization bills.",
    featuresTitle: "Three things the platform does",
    featureCatalogTitle: "Indicator catalog",
    featureCatalogDesc:
      "Full catalog searchable without signing in — verified indicators read directly, registered ones on demand.",
    featureConsoleTitle: "Analysis console",
    featureConsoleDesc:
      "Dashboards, composite indicators, research workflows, alerts and scheduled refresh — built by conversation.",
    featureDemandTitle: "Data demands",
    featureDemandDesc:
      "Missing an indicator? File a demand ticket — the timeline is visible end to end, delivery lands in your private scope.",
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
    placeholder:
      "Console under construction — the five artifact kinds (dashboards, composite indicators, research workflows, alerts, scheduled refresh) and AI-assisted building will land here.",
    chartTitle: "Dashboard placeholder",
    chartEmpty: "No data yet",
  },
  login: {
    title: "Sign in",
    placeholder: "Customer sign-in under construction — enter the console with an enterprise account (owner / member).",
    cta: "Contact us to get started",
  },
  footer: "Wire · Xunshu wire line · FindData Tech",
};

export default en;
