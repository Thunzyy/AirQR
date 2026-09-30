import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Icon from "../../components/ui/Icon";
import { globalHas } from "../../parse/wire";
import type { HistoryItem, IncompleteScanItem } from "../../types";
import { resolveIncompleteScanName } from "../../utils/format";
import {
  isHistoryItemPreviewable,
  resolveHistoryItemSortTimestamp,
} from "../../utils/history";

export type { HistoryItem, IncompleteScanItem };

type SortOption = "date-desc" | "date-asc" | "size-desc" | "size-asc" | "name-asc" | "name-desc";
type HistoryFilter = "all" | "scanned" | "generated";
type HistoryItemsByCategory = {
  [category: string]: HistoryItem[];
};

function isSortOption(value: string | null): value is SortOption {
  return (
    value === "date-desc" ||
    value === "date-asc" ||
    value === "size-desc" ||
    value === "size-asc" ||
    value === "name-asc" ||
    value === "name-desc"
  );
}

const SORT_OPTIONS: { value: SortOption; labelKey: string; icon: string }[] = [
  { value: "date-desc", labelKey: "history.sortOptions.dateDesc", icon: "arrow_downward" },
  { value: "date-asc", labelKey: "history.sortOptions.dateAsc", icon: "arrow_upward" },
  { value: "size-desc", labelKey: "history.sortOptions.sizeDesc", icon: "arrow_downward" },
  { value: "size-asc", labelKey: "history.sortOptions.sizeAsc", icon: "arrow_upward" },
  { value: "name-asc", labelKey: "history.sortOptions.nameAsc", icon: "arrow_upward" },
  { value: "name-desc", labelKey: "history.sortOptions.nameDesc", icon: "arrow_downward" },
];

const ITEM_VISIBILITY_STYLE: React.CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "88px",
};

const compareHistoryItemsByTitle = (a: HistoryItem, b: HistoryItem): number =>
  (a.title || "").localeCompare(b.title || "") || a.id.localeCompare(b.id);

const normalizeIncompleteProgressPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const bounded = Math.min(99.9, Math.max(0, value));
  return Number((Math.floor(bounded * 10) / 10).toFixed(1));
};

const formatProgressPercent = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);

interface HistoryProps {
  items: HistoryItem[];
  incompleteItems?: IncompleteScanItem[];
  onDownload?: (item: HistoryItem) => void;
  onDelete?: (item: HistoryItem) => void;
  onResume?: (item: IncompleteScanItem) => void;
  onDeleteIncomplete?: (item: IncompleteScanItem) => void;
  onSyncIncomplete?: (item: IncompleteScanItem) => void;
  onKeepLocalIncomplete?: (item: IncompleteScanItem) => void;
  onView?: (item: HistoryItem) => void;
  onKeepLocal?: (item: HistoryItem) => void;
  onSyncItem?: (item: HistoryItem) => void;
  onSyncToServer?: () => void;
  onRefresh?: () => void;
  onClearHistory?: () => void;
  isSyncing?: boolean;
  isClearingHistory?: boolean;
  syncEnabled?: boolean;
  syncAuthRequired?: boolean;
  syncStatusLabel?: string;
  syncStatusClassName?: string;
  onOpenSyncSettings?: () => void;
}

const History: React.FC<HistoryProps> = ({
  items,
  incompleteItems = [],
  onDownload,
  onDelete,
  onResume,
  onDeleteIncomplete,
  onSyncIncomplete,
  onKeepLocalIncomplete,
  onView,
  onKeepLocal,
  onSyncItem,
  onSyncToServer,
  onRefresh,
  onClearHistory,
  isSyncing = false,
  isClearingHistory = false,
  syncEnabled = false,
  syncAuthRequired = false,
  syncStatusLabel,
  syncStatusClassName,
  onOpenSyncSettings,
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>(() => {
    if (!globalHas("window")) {
      return "all";
    }
    const stored = window.localStorage.getItem("airqr_history_filter");
    return stored === "scanned" || stored === "generated" || stored === "all"
      ? stored
      : "all";
  });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    if (!globalHas("window")) return "date-desc";
    const stored = window.localStorage.getItem("airqr_history_sort");
    return isSortOption(stored) ? stored : "date-desc";
  });
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        event.target instanceof Node &&
        !sortDropdownRef.current.contains(event.target)
      ) {
        setSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!globalHas("window")) return;
    window.localStorage.setItem("airqr_history_sort", sortBy);
  }, [sortBy]);

  useEffect(() => {
    if (!globalHas("window")) return;
    window.localStorage.setItem("airqr_history_filter", filter);
  }, [filter]);

  // Filter items based on selected tab
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (value?: string) =>
    Boolean(
      normalizedQuery &&
        value?.toLowerCase().includes(normalizedQuery)
    );
  const matchesHistoryItem = (item: HistoryItem) =>
    normalizedQuery.length === 0 ||
    matchesQuery(item.title) ||
    matchesQuery(item.subtitle) ||
    matchesQuery(item.date) ||
    matchesQuery(item.mimeType);

  // Sort function
  const sortItems = (itemsToSort: HistoryItem[]): HistoryItem[] => {
    const timestampCache = new Map<string, number>();
    const getSortTime = (item: HistoryItem): number => {
      const cached = timestampCache.get(item.id);
      if (cached !== undefined) {
        return cached;
      }

      const resolved = Date.parse(resolveHistoryItemSortTimestamp(item));
      const timestamp = Number.isNaN(resolved) ? 0 : resolved;
      timestampCache.set(item.id, timestamp);
      return timestamp;
    };

    return [...itemsToSort].sort((a, b) => {
      switch (sortBy) {
        case "date-desc":
          return getSortTime(b) - getSortTime(a) || compareHistoryItemsByTitle(a, b);
        case "date-asc":
          return getSortTime(a) - getSortTime(b) || compareHistoryItemsByTitle(a, b);
        case "size-desc":
          return (b.size || 0) - (a.size || 0);
        case "size-asc":
          return (a.size || 0) - (b.size || 0);
        case "name-asc":
          return (a.title || "").localeCompare(b.title || "");
        case "name-desc":
          return (b.title || "").localeCompare(a.title || "");
        default:
          return 0;
      }
    });
  };

  const filteredItems = sortItems(
    items
      .filter((item) => filter === "all" || item.origin === filter)
      .filter(matchesHistoryItem)
  );
  const filteredIncompleteItems =
    filter !== "generated" && normalizedQuery.length > 0
      ? incompleteItems.filter(
          (item) =>
            matchesQuery(item.filename) ||
            matchesQuery(item.sessionId) ||
            matchesQuery(item.date)
        )
      : filter !== "generated"
        ? incompleteItems
        : [];
  const hasAnyHistory = items.length > 0 || incompleteItems.length > 0;

  // Group items by category for display
  // For "older" items, group by actual date instead
  const groupedItems = filteredItems.reduce<HistoryItemsByCategory>((acc, item) => {
    let cat: string = item.category || "older";
    // For older items, use the actual date as the category key
    if (cat === "older" && item.date) {
      cat = item.date; // Use date like "2025-01-25"
    }
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  // Get sorted date keys for older items (excluding today/yesterday)
  const olderDateKeys = Object.keys(groupedItems)
    .filter((key) => key !== "today" && key !== "yesterday")
    .sort((a, b) =>
      sortBy === "date-asc" ? a.localeCompare(b) : b.localeCompare(a)
    );

  const sectionKeys =
    sortBy === "date-asc"
      ? [
          ...olderDateKeys,
          ...(groupedItems["yesterday"] ? ["yesterday"] : []),
          ...(groupedItems["today"] ? ["today"] : []),
        ]
      : [
          ...(groupedItems["today"] ? ["today"] : []),
          ...(groupedItems["yesterday"] ? ["yesterday"] : []),
          ...olderDateKeys,
        ];

  const filterTabs = [
    ["all", t("history.all")],
    ["scanned", t("history.scanned")],
    ["generated", t("history.generated")],
  ] as const;
  const activeFilterIndex = Math.max(
    0,
    filterTabs.findIndex(([value]) => value === filter)
  );

  const getSectionLabel = (sectionKey: string) => {
    if (sectionKey === "today") {
      return t("common.today");
    }
    if (sectionKey === "yesterday") {
      return t("common.yesterday");
    }
    return sectionKey;
  };

  const getIcon = (item: HistoryItem) => {
    switch (item.type) {
      case "file":
        if (
          item.title.endsWith(".zip") ||
          item.mimeType === "application/zip"
        ) {
          return "folder_zip";
        }
        return "description"; // Standard file icon
      case "wifi":
        return "wifi";
      case "contact":
        return "person";
      case "payment":
        return "payments";
      default:
        return "text_fields";
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-[var(--airqr-text-primary)] animate-fade-in">
      <div className="relative z-40 shrink-0 px-4 pb-3 pt-5">
        <div className="flex items-center justify-end gap-2">
          {syncStatusLabel ? (
            <span
              className={`mr-auto inline-flex max-w-[128px] items-center truncate rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-wide ${
                syncStatusClassName ||
                "border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)]"
              }`}
            >
              {syncStatusLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (searchOpen) {
                setQuery("");
                setSearchOpen(false);
                return;
              }
              setSearchOpen(true);
            }}
            className={`flex size-12 items-center justify-center rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] shadow-[0_16px_44px_rgba(56,83,105,0.20)] transition-colors hover:bg-[var(--airqr-action-hover)] ${
              searchOpen || query ? "text-[var(--airqr-text-primary)]" : "text-[var(--airqr-text-secondary)]"
            }`}
            aria-label={t('history.searchHistory')}
            aria-expanded={searchOpen}
          >
            <Icon name={searchOpen ? "close" : "search"} className="text-[26px]" />
          </button>
          {/* Sort dropdown */}
          <div className="relative" ref={sortDropdownRef}>
            <button
              type="button"
              onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
              className="flex size-12 items-center justify-center rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)] transition-colors hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
              aria-label={t('history.sortTitle')}
              title={t('history.sortTitle')}
            >
              <Icon name="sort" className="text-xl" />
            </button>
            {sortDropdownOpen && (
              <div className="absolute right-0 top-14 z-[90] min-w-[170px] overflow-hidden rounded-2xl border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] shadow-2xl">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSortBy(option.value);
                      setSortDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                      sortBy === option.value
                        ? "bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]"
                        : "text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
                    }`}
                  >
                    <Icon name={option.icon} className="text-base" />
                    <span>{t(option.labelKey)}</span>
                    {sortBy === option.value && (
                      <Icon name="check" className="ml-auto text-base" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="flex size-12 items-center justify-center rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)] transition-colors hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
            >
              <Icon name="refresh" className="text-xl" />
            </button>
          )}
          {syncEnabled && onSyncToServer && (
            <button
              type="button"
              onClick={onSyncToServer}
              disabled={isSyncing}
              className={`flex size-12 items-center justify-center rounded-full border transition-colors ${
                isSyncing
                ? "airqr-action-button cursor-not-allowed"
                  : "airqr-action-button airqr-action-button-accent"
              }`}
              aria-label={t('history.syncToServer')}
              title={t('history.syncToServer')}
            >
              <Icon
                name={isSyncing ? "sync" : "cloud_upload"}
                className={`airqr-sync-icon text-xl ${isSyncing ? "animate-spin" : ""}`}
              />
            </button>
          )}
          {onClearHistory && (
            <button
              type="button"
              onClick={onClearHistory}
              disabled={isClearingHistory || !hasAnyHistory}
              className={`flex size-12 items-center justify-center rounded-full border transition-colors ${
                isClearingHistory || !hasAnyHistory
                  ? "airqr-action-button cursor-not-allowed"
                  : "airqr-action-button airqr-action-button-danger"
              }`}
              aria-label={t("history.clearHistory")}
              title={t("history.clearHistory")}
            >
              <Icon
                name={isClearingHistory ? "sync" : "delete"}
                className={`text-xl ${isClearingHistory ? "animate-spin" : ""}`}
              />
            </button>
          )}
        </div>

        {searchOpen ? (
          <div className="airqr-liquid-alert mt-4 flex min-h-14 items-center gap-3 px-4 py-3">
            <Icon name="search" className="text-[24px] text-[var(--airqr-text-muted)]" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('history.searchHistory')}
              aria-label={t('history.searchHistory')}
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-[var(--airqr-text-primary)] placeholder:text-[var(--airqr-text-muted)] outline-none"
            />
            {query ? (
              <button
                onClick={() => setQuery("")}
                className="flex items-center justify-center rounded-full text-[var(--airqr-text-muted)] transition-colors hover:text-[var(--airqr-text-primary)]"
                aria-label={t('history.clearSearch')}
              >
                <Icon name="close" className="text-base" />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="relative mt-5 grid h-[52px] grid-cols-3 rounded-[22px] bg-[var(--airqr-nav-surface)] p-1 shadow-[0_16px_44px_rgba(56,83,105,0.18)] backdrop-blur-2xl">
          <div
            aria-hidden="true"
            className="absolute inset-y-1 left-1 z-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{
              width: `calc((100% - 8px) / ${filterTabs.length})`,
              transform: `translateX(${activeFilterIndex * 100}%)`,
            }}
          >
            <div className="h-full rounded-[18px] bg-[var(--airqr-nav-active)] shadow-[0_10px_28px_rgba(56,83,105,0.16)]" />
          </div>
          {filterTabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`relative z-10 flex items-center justify-center rounded-[18px] text-[16px] font-bold transition-colors duration-200 ${
                filter === value
                  ? "text-[var(--airqr-text-primary)]"
                  : "text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-primary)]"
              }`}
            >
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* List Content */}
      <main className="relative z-10 flex-1 space-y-5 overflow-y-auto px-4 pb-28">
        {syncEnabled && syncAuthRequired && (
          <div className="airqr-liquid-alert airqr-status-warning px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-warning-surface)] text-[var(--airqr-warning-text)]">
                <Icon name="lock" className="text-lg" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  {t('history.syncAuthRequiredTitle')}
                </p>
                <p className="mt-1 text-sm text-[var(--airqr-text-secondary)]">
                  {t('history.syncAuthRequiredBody')}
                </p>
                {onOpenSyncSettings && (
                  <button
                    type="button"
                    onClick={onOpenSyncSettings}
                    className="airqr-primary-button mt-3 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                  >
                    <Icon name="settings" className="text-base" />
                    <span>{t('history.openSyncSettings')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Incomplete Scans */}
        {filter !== "generated" && filteredIncompleteItems.length > 0 && (
          <div>
            <h3 className="airqr-section-title mb-3 ml-1">
              {t('history.incompleteScans')}
            </h3>
            <div className="flex flex-col gap-3">
              {filteredIncompleteItems.map((item) => {
                const progress =
                  Number.isFinite(item.progressPercent)
                    ? normalizeIncompleteProgressPercent(
                        Number(item.progressPercent)
                      )
                    : item.total && item.total > 0
                      ? normalizeIncompleteProgressPercent(
                          ((item.totalIsEstimate
                            ? Math.min(item.received, item.total)
                            : item.received) /
                            item.total) *
                            100
                        )
                      : 0;
                const totalLabel =
                  item.total && item.total > 0
                    ? item.totalIsEstimate
                      ? `${item.total}`
                      : `${item.total}`
                    : "?";
                const showCloudIcon =
                  item.source === 'server' || Boolean(item.remoteSessionId);
                const serverReceived = Number(item.serverReceived);
                const serverTotal = Number(item.serverTotal ?? item.total);
                const showServerSyncProgress =
                  Number.isFinite(serverReceived) &&
                  serverReceived >= 0 &&
                  item.received > serverReceived;
                const serverTotalLabel =
                  Number.isFinite(serverTotal) && serverTotal > 0
                    ? `${serverTotal}`
                    : totalLabel;

                return (
                  <div
                    key={item.sessionId}
                    className="airqr-liquid-card group relative flex cursor-pointer flex-col overflow-hidden rounded-[30px] transition-all hover:bg-[var(--airqr-action-hover)]"
                    style={ITEM_VISIBILITY_STYLE}
                    onClick={() => onResume?.(item)}
                  >
                    <div className="flex items-center gap-4 p-3 pb-2">
                      <div className="relative">
                        <div className="airqr-liquid-icon flex h-12 w-12 shrink-0 text-[var(--airqr-text-primary)]">
                          <Icon name="autorenew" />
                        </div>
                        {showCloudIcon && (
                          <div className="airqr-sync-badge absolute -bottom-1 -right-1 h-5 w-5">
                            <Icon
                              name="cloud"
                              className="text-[12px]"
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-base font-bold text-[var(--airqr-text-primary)]">
                            {resolveIncompleteScanName(item.filename, item.sessionId)}
                          </p>
                          {item.deviceName && (
                            <span className="shrink-0 rounded-full bg-[var(--airqr-warning-surface)] px-2 py-0.5 text-xs font-bold text-[var(--airqr-warning-text)]">
                              {item.deviceName}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-[var(--airqr-text-muted)]">
                          <span className="font-bold text-[var(--airqr-warning-text)]">{formatProgressPercent(progress)}%</span>
                          {" • "}
                          {t('history.packetsProgress', {
                            received: item.received,
                            total: totalLabel,
                          })}
                          {showServerSyncProgress && (
                            <>
                              {" • "}
                              {t('history.serverSyncProgress', {
                                received: serverReceived,
                                total: serverTotalLabel,
                              })}
                            </>
                          )}
                          {" • "}
                          {item.date}
                        </p>
                      </div>
                <div className="flex items-center gap-1">
                  {/* Sync button - show when local (not from server) */}
                      {syncEnabled &&
                    item.source !== "server" &&
                    !item.remoteSessionId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSyncIncomplete?.(item);
                        }}
                        className="airqr-action-button flex size-10 shrink-0 items-center justify-center rounded-full transition-colors"
                        title={t('history.syncIncompleteToServer')}
                      >
                        <Icon
                          name="cloud_upload"
                          className="airqr-sync-icon"
                        />
                      </button>
                    )}
                  {/* Keep local button - show when synced */}
                      {syncEnabled &&
                    (item.source === "server" || item.remoteSessionId) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onKeepLocalIncomplete?.(item);
                        }}
                        className="airqr-action-button flex size-10 shrink-0 items-center justify-center rounded-full transition-colors"
                        title={t('history.keepLocalOnlyRemove')}
                      >
                        <Icon name="cloud_off" />
                      </button>
                    )}
                  <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onResume?.(item);
                          }}
                        data-testid={`history-resume-${item.sessionId}`}
                        className="airqr-action-button flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--airqr-text-primary)] transition-colors"
                        title={t('history.resumeScan')}
                      >
                        <Icon name="play_arrow" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteIncomplete?.(item);
                        }}
                        className="airqr-action-button airqr-action-button-danger flex size-10 shrink-0 items-center justify-center rounded-full transition-colors"
                        title={t('history.deleteIncomplete')}
                      >
                        <Icon name="delete" />
                      </button>
                    </div>
                  </div>
                    {/* Progress bar */}
                    <div className="airqr-progress-track h-1.5 w-full">
                      <div
                        className="airqr-progress-fill-warning h-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {sectionKeys.map((sectionKey) => (
          <div key={sectionKey}>
            <h3 className="mb-3 ml-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--airqr-text-muted)]">
              {getSectionLabel(sectionKey)}
            </h3>
            <div className="flex flex-col gap-3">
              {groupedItems[sectionKey].map((item) => (
                <HistoryListItem
                  key={item.id}
                  item={item}
                  getIcon={getIcon}
                  onDownload={onDownload}
                  onDelete={onDelete}
                  onView={onView}
                  onKeepLocal={onKeepLocal}
                  onSyncItem={onSyncItem}
                />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
};

const HistoryListItem: React.FC<{
  item: HistoryItem;
  getIcon: (item: HistoryItem) => string;
  onDownload?: (item: HistoryItem) => void;
  onDelete?: (item: HistoryItem) => void;
  onView?: (item: HistoryItem) => void;
  onKeepLocal?: (item: HistoryItem) => void;
  onSyncItem?: (item: HistoryItem) => void;
}> = ({ item, getIcon, onDownload, onDelete, onView, onKeepLocal, onSyncItem }) => {
  const { t } = useTranslation();
  const isViewable = isHistoryItemPreviewable(item);

  // Show cloud icon if synced with server (and not local-only)
  const showCloudIcon = item.isSynced && !item.isLocalOnly;
  // Show sync failed indicator
  const showSyncFailed = item.syncFailed && !item.isLocalOnly;
  // Show sync button if item is local-only (was detached from server) OR if sync failed (to retry)
  const showSyncButton = item.isLocalOnly || item.syncFailed;

  const handleRowClick = () => {
    if (isViewable && onView) {
      onView(item);
    }
  };

  return (
    <div
      className="airqr-liquid-card group relative flex cursor-pointer items-center gap-3 rounded-[28px] p-3 transition-all hover:bg-[var(--airqr-card-hover)]"
      style={ITEM_VISIBILITY_STYLE}
      onClick={handleRowClick}
    >
      <div className="relative">
        <div className="airqr-file-icon h-12 w-12">
          <Icon name={getIcon(item)} className="text-[22px]" />
        </div>
        {showCloudIcon && (
          <div className="airqr-sync-badge absolute -bottom-1 -right-1 h-5 w-5">
            <Icon
              name="cloud"
              className="text-[12px]"
            />
          </div>
        )}
        {showSyncFailed && (
          <div className="airqr-status-danger absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full shadow-sm" title={t('history.syncFailedRetry')}>
            <Icon name="cloud_off" className="text-[12px]" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <p className="truncate text-[15px] font-bold text-[var(--airqr-text-primary)]">
          {item.title}
        </p>
        <p className="truncate text-xs font-medium text-[var(--airqr-text-muted)]">
          {item.subtitle}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {isViewable && onView && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onView(item);
            }}
            className="airqr-action-button airqr-action-button-success flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
            aria-label={t('history.previewFile')}
            title={t('history.previewFile')}
          >
            <Icon name="visibility" />
          </button>
        )}
        {showCloudIcon && onKeepLocal && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onKeepLocal(item);
            }}
            className="airqr-action-button flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--airqr-warning-text)] transition-colors"
            title={t('history.keepLocalOnlyDetach')}
          >
            <Icon name="cloud_off" />
          </button>
        )}
        {showSyncButton && onSyncItem && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSyncItem(item);
            }}
            className={`airqr-action-button flex size-10 shrink-0 items-center justify-center rounded-full transition-colors ${
              item.syncFailed
                ? "airqr-action-button-danger"
                : "airqr-action-button-accent"
            }`}
            title={item.syncFailed ? t('history.retrySync') : t('history.syncToServerItem')}
          >
            <Icon
              name={item.syncFailed ? "sync" : "cloud_upload"}
              className="airqr-sync-icon"
            />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload?.(item);
          }}
          className="airqr-action-button airqr-action-button-accent flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
          aria-label={t('history.downloadFile')}
        >
          <Icon name="download" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(item);
          }}
          className="airqr-action-button airqr-action-button-danger flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
          aria-label={t('history.deleteFile')}
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  );
};

export default History;
