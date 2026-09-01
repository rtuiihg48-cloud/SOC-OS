export const languageOptions = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
  { value: "de", label: "Deutsch" },
  { value: "pl", label: "Polski" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "vi", label: "Tiếng Việt" },
] as const;

export type Language = (typeof languageOptions)[number]["value"];

type MenuCopy = {
  sections: {
    operations: string;
    intelligence: string;
    response: string;
    platform: string;
  };
  items: {
    dashboard: string;
    incidents: string;
    alerts: string;
    events: string;
    simulation: string;
    threatGraph: string;
    virusDb: string;
    rules: string;
    correlations: string;
    quarantine: string;
    selfHealing: string;
    patches: string;
    playbooks: string;
    runtime: string;
    readinessReview: string;
    nodeExchange: string;
    trafficAnalysis: string;
    auditTrail: string;
    tenants: string;
    billing: string;
  };
  ui: {
    systemStatus: string;
    live: string;
    search: string;
    shortcut: string;
    threatLevel: string;
    searchPlaceholder: string;
    close: string;
    noMatches: string;
    expandNavigation: string;
    collapseNavigation: string;
    language: string;
  };
};

export const menuCopy: Record<Language, MenuCopy> = {
  en: {
    sections: { operations: "Operations", intelligence: "Intelligence", response: "Response", platform: "Platform" },
    items: {
      dashboard: "Dashboard", incidents: "Incident Center", alerts: "Alerts", events: "Event Log", simulation: "Simulation",
      threatGraph: "Threat Graph", virusDb: "Virus DB", rules: "Rules Engine", correlations: "Correlations",
      quarantine: "Quarantine", selfHealing: "Self-Healing", patches: "Patches", playbooks: "Playbooks",
      runtime: "Runtime", readinessReview: "Readiness Review", nodeExchange: "Node Exchange", trafficAnalysis: "Traffic Analysis",
      auditTrail: "Audit Trail", tenants: "Tenants", billing: "Billing",
    },
    ui: {
      systemStatus: "System Status", live: "live", search: "SEARCH", shortcut: "CTRL K", threatLevel: "THREAT_LEVEL:",
      searchPlaceholder: "Search control surfaces...", close: "ESC", noMatches: "NO CONTROL SURFACE MATCHES",
      expandNavigation: "Expand navigation", collapseNavigation: "Collapse navigation", language: "Language",
    },
  },
  uk: {
    sections: { operations: "Операції", intelligence: "Розвідка", response: "Реагування", platform: "Платформа" },
    items: {
      dashboard: "Панель", incidents: "Центр інцидентів", alerts: "Сповіщення", events: "Журнал подій", simulation: "Симуляція",
      threatGraph: "Граф загроз", virusDb: "База вірусів", rules: "Рушій правил", correlations: "Кореляції",
      quarantine: "Карантин", selfHealing: "Самовідновлення", patches: "Патчі", playbooks: "Сценарії",
      runtime: "Runtime", readinessReview: "Перевірка готовності", nodeExchange: "Обмін вузлами", trafficAnalysis: "Аналіз трафіку",
      auditTrail: "Аудит", tenants: "Тенанти", billing: "Оплата",
    },
    ui: {
      systemStatus: "Стан системи", live: "онлайн", search: "ПОШУК", shortcut: "CTRL K", threatLevel: "РІВЕНЬ_ЗАГРОЗИ:",
      searchPlaceholder: "Пошук у розділах...", close: "ESC", noMatches: "ЗБІГІВ НЕ ЗНАЙДЕНО",
      expandNavigation: "Розгорнути навігацію", collapseNavigation: "Згорнути навігацію", language: "Мова",
    },
  },
  de: {
    sections: { operations: "Betrieb", intelligence: "Analyse", response: "Reaktion", platform: "Plattform" },
    items: {
      dashboard: "Dashboard", incidents: "Incident Center", alerts: "Warnungen", events: "Ereignisprotokoll", simulation: "Simulation",
      threatGraph: "Bedrohungsgraph", virusDb: "Virusdatenbank", rules: "Regel-Engine", correlations: "Korrelationen",
      quarantine: "Quarantäne", selfHealing: "Selbstheilung", patches: "Patches", playbooks: "Playbooks",
      runtime: "Laufzeit", readinessReview: "Bereitschaftsprüfung", nodeExchange: "Knotenaustausch", trafficAnalysis: "Verkehrsanalyse",
      auditTrail: "Audit-Protokoll", tenants: "Mandanten", billing: "Abrechnung",
    },
    ui: {
      systemStatus: "Systemstatus", live: "live", search: "SUCHEN", shortcut: "CTRL K", threatLevel: "BEDROHUNGSSTUFE:",
      searchPlaceholder: "Steuerflächen durchsuchen...", close: "ESC", noMatches: "KEINE TREFFER",
      expandNavigation: "Navigation erweitern", collapseNavigation: "Navigation einklappen", language: "Sprache",
    },
  },
  pl: {
    sections: { operations: "Operacje", intelligence: "Rozpoznanie", response: "Reakcja", platform: "Platforma" },
    items: {
      dashboard: "Panel", incidents: "Centrum incydentów", alerts: "Alerty", events: "Dziennik zdarzeń", simulation: "Symulacja",
      threatGraph: "Graf zagrożeń", virusDb: "Baza wirusów", rules: "Silnik reguł", correlations: "Korelacje",
      quarantine: "Kwarantanna", selfHealing: "Samonaprawa", patches: "Łatki", playbooks: "Procedury",
      runtime: "Runtime", readinessReview: "Przegląd gotowości", nodeExchange: "Wymiana węzłów", trafficAnalysis: "Analiza ruchu",
      auditTrail: "Ślad audytowy", tenants: "Dzierżawcy", billing: "Rozliczenia",
    },
    ui: {
      systemStatus: "Stan systemu", live: "na żywo", search: "SZUKAJ", shortcut: "CTRL K", threatLevel: "POZIOM_ZAGROŻENIA:",
      searchPlaceholder: "Szukaj w panelach...", close: "ESC", noMatches: "BRAK DOPASOWAŃ",
      expandNavigation: "Rozwiń nawigację", collapseNavigation: "Zwiń nawigację", language: "Język",
    },
  },
  "zh-CN": {
    sections: { operations: "运营", intelligence: "情报", response: "响应", platform: "平台" },
    items: {
      dashboard: "仪表盘", incidents: "事件中心", alerts: "警报", events: "事件日志", simulation: "模拟",
      threatGraph: "威胁图谱", virusDb: "病毒数据库", rules: "规则引擎", correlations: "关联分析",
      quarantine: "隔离区", selfHealing: "自愈", patches: "补丁", playbooks: "操作手册",
      runtime: "运行时", readinessReview: "就绪审查", nodeExchange: "节点交换", trafficAnalysis: "流量分析",
      auditTrail: "审计追踪", tenants: "租户", billing: "账单",
    },
    ui: {
      systemStatus: "系统状态", live: "在线", search: "搜索", shortcut: "CTRL K", threatLevel: "威胁等级：",
      searchPlaceholder: "搜索控制页面...", close: "ESC", noMatches: "没有匹配的控制页面",
      expandNavigation: "展开导航", collapseNavigation: "收起导航", language: "语言",
    },
  },
  "zh-TW": {
    sections: { operations: "營運", intelligence: "情報", response: "回應", platform: "平台" },
    items: {
      dashboard: "儀表板", incidents: "事件中心", alerts: "警示", events: "事件記錄", simulation: "模擬",
      threatGraph: "威脅圖譜", virusDb: "病毒資料庫", rules: "規則引擎", correlations: "關聯分析",
      quarantine: "隔離區", selfHealing: "自我修復", patches: "修補程式", playbooks: "操作手冊",
      runtime: "執行環境", readinessReview: "就緒審查", nodeExchange: "節點交換", trafficAnalysis: "流量分析",
      auditTrail: "稽核軌跡", tenants: "租戶", billing: "帳單",
    },
    ui: {
      systemStatus: "系統狀態", live: "線上", search: "搜尋", shortcut: "CTRL K", threatLevel: "威脅等級：",
      searchPlaceholder: "搜尋控制頁面...", close: "ESC", noMatches: "沒有符合的控制頁面",
      expandNavigation: "展開導覽", collapseNavigation: "收合導覽", language: "語言",
    },
  },
  ja: {
    sections: { operations: "運用", intelligence: "インテリジェンス", response: "対応", platform: "プラットフォーム" },
    items: {
      dashboard: "ダッシュボード", incidents: "インシデントセンター", alerts: "アラート", events: "イベントログ", simulation: "シミュレーション",
      threatGraph: "脅威グラフ", virusDb: "ウイルスDB", rules: "ルールエンジン", correlations: "相関分析",
      quarantine: "隔離", selfHealing: "自己修復", patches: "パッチ", playbooks: "プレイブック",
      runtime: "ランタイム", readinessReview: "準備状況レビュー", nodeExchange: "ノード交換", trafficAnalysis: "トラフィック分析",
      auditTrail: "監査証跡", tenants: "テナント", billing: "請求",
    },
    ui: {
      systemStatus: "システム状態", live: "稼働中", search: "検索", shortcut: "CTRL K", threatLevel: "脅威レベル：",
      searchPlaceholder: "コントロール画面を検索...", close: "ESC", noMatches: "一致する画面がありません",
      expandNavigation: "ナビゲーションを展開", collapseNavigation: "ナビゲーションを折りたたむ", language: "言語",
    },
  },
  ko: {
    sections: { operations: "운영", intelligence: "인텔리전스", response: "대응", platform: "플랫폼" },
    items: {
      dashboard: "대시보드", incidents: "인시던트 센터", alerts: "알림", events: "이벤트 로그", simulation: "시뮬레이션",
      threatGraph: "위협 그래프", virusDb: "바이러스 DB", rules: "규칙 엔진", correlations: "상관관계",
      quarantine: "격리", selfHealing: "자동 복구", patches: "패치", playbooks: "플레이북",
      runtime: "런타임", readinessReview: "준비 상태 검토", nodeExchange: "노드 교환", trafficAnalysis: "트래픽 분석",
      auditTrail: "감사 추적", tenants: "테넌트", billing: "결제",
    },
    ui: {
      systemStatus: "시스템 상태", live: "실시간", search: "검색", shortcut: "CTRL K", threatLevel: "위협 수준:",
      searchPlaceholder: "제어 화면 검색...", close: "ESC", noMatches: "일치하는 제어 화면 없음",
      expandNavigation: "탐색 확장", collapseNavigation: "탐색 축소", language: "언어",
    },
  },
  vi: {
    sections: { operations: "Vận hành", intelligence: "Tình báo", response: "Ứng phó", platform: "Nền tảng" },
    items: {
      dashboard: "Bảng điều khiển", incidents: "Trung tâm sự cố", alerts: "Cảnh báo", events: "Nhật ký sự kiện", simulation: "Mô phỏng",
      threatGraph: "Đồ thị mối đe dọa", virusDb: "CSDL virus", rules: "Công cụ luật", correlations: "Tương quan",
      quarantine: "Cách ly", selfHealing: "Tự phục hồi", patches: "Bản vá", playbooks: "Quy trình",
      runtime: "Thời gian chạy", readinessReview: "Đánh giá sẵn sàng", nodeExchange: "Trao đổi nút", trafficAnalysis: "Phân tích lưu lượng",
      auditTrail: "Dấu vết kiểm toán", tenants: "Tenant", billing: "Thanh toán",
    },
    ui: {
      systemStatus: "Trạng thái hệ thống", live: "trực tuyến", search: "TÌM KIẾM", shortcut: "CTRL K", threatLevel: "MỨC ĐE DỌA:",
      searchPlaceholder: "Tìm kiếm bảng điều khiển...", close: "ESC", noMatches: "KHÔNG CÓ KẾT QUẢ",
      expandNavigation: "Mở rộng điều hướng", collapseNavigation: "Thu gọn điều hướng", language: "Ngôn ngữ",
    },
  },
};

export function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem("soc-os-language");
  return languageOptions.some((option) => option.value === stored) ? stored as Language : "en";
}