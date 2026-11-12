import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'history_item.dart';
import 'incomplete_scans.dart';

Duration _historyAnimationDuration(BuildContext context, Duration normal) =>
    MediaQuery.disableAnimationsOf(context) ? Duration.zero : normal;

Color _historyMutedText(BuildContext context) => AirQrTheme.isDark(context)
    ? const Color(0xADFFFFFF)
    : const Color(0xA6111820);

class HistoryFilterToggle extends StatelessWidget {
  final String selectedFilter;
  final Color cardColor;
  final Color selectedColor;
  final String allLabel;
  final String scannedLabel;
  final String generatedLabel;

  /// Optional per-filter item counts keyed by 'all' / 'scanned' /
  /// 'generated'; a missing key renders no badge for that tab.
  final Map<String, int>? counts;
  final ValueChanged<String> onChanged;

  const HistoryFilterToggle({
    super.key,
    required this.selectedFilter,
    required this.cardColor,
    required this.selectedColor,
    required this.allLabel,
    required this.scannedLabel,
    required this.generatedLabel,
    this.counts,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    const filters = ['all', 'scanned', 'generated'];
    final labels = [allLabel, scannedLabel, generatedLabel];
    final activeIndex = filters.indexOf(selectedFilter).clamp(0, 2);
    final scaledLabelHeight = MediaQuery.textScalerOf(context).scale(16);
    // Flat segmented track (mirrors web): 48dp tall, 1dp control border,
    // 4dp padding, so the thumb is 48 - 2 - 8 = 38dp.
    const toggleHeight = 48.0;
    const indicatorHeight = toggleHeight - 2 - 8;
    final trackDecoration = BoxDecoration(
      color: cardColor,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AirQrTheme.controlBorder(context)),
    );

    if (scaledLabelHeight > 22) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Container(
          padding: const EdgeInsets.all(4),
          decoration: trackDecoration,
          child: Column(
            children: [
              for (var index = 0; index < filters.length; index++)
                ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: _HistoryFilterToggleOption(
                    filter: filters[index],
                    label: labels[index],
                    count: counts?[filters[index]],
                    isSelected: selectedFilter == filters[index],
                    selectedBackground: selectedColor,
                    maxLabelLines: 2,
                    onTap: () => onChanged(filters[index]),
                  ),
                ),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SizedBox(
        height: toggleHeight,
        child: Container(
          decoration: trackDecoration,
          padding: const EdgeInsets.all(4),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final itemWidth = constraints.maxWidth / filters.length;
              return Stack(
                children: [
                  AnimatedPositioned(
                    duration: _historyAnimationDuration(
                      context,
                      const Duration(milliseconds: 300),
                    ),
                    curve: const Cubic(0.2, 0.8, 0.2, 1),
                    left: itemWidth * activeIndex,
                    top: 0,
                    width: itemWidth,
                    height: indicatorHeight,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: selectedColor,
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.14),
                            blurRadius: 2,
                            offset: const Offset(0, 1),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      for (var index = 0; index < filters.length; index++)
                        Expanded(
                          child: _HistoryFilterToggleOption(
                            filter: filters[index],
                            label: labels[index],
                            count: counts?[filters[index]],
                            isSelected: selectedFilter == filters[index],
                            onTap: () => onChanged(filters[index]),
                          ),
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

String _formatHistoryCount(int count) => count > 999 ? '999+' : '$count';

class _HistoryFilterToggleOption extends StatelessWidget {
  final String filter;
  final String label;
  final int? count;
  final bool isSelected;
  final VoidCallback onTap;
  final Color? selectedBackground;
  final int maxLabelLines;

  const _HistoryFilterToggleOption({
    required this.filter,
    required this.label,
    required this.count,
    required this.isSelected,
    required this.onTap,
    this.selectedBackground,
    this.maxLabelLines = 1,
  });

  @override
  Widget build(BuildContext context) {
    final labelText = Text(
      label,
      maxLines: maxLabelLines,
      overflow: TextOverflow.ellipsis,
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
        color: isSelected
            ? AirQrTheme.textPrimary(context)
            : AirQrTheme.textMuted(context),
        fontSize: 15,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.15,
        height: 1.2,
      ),
    );
    final count = this.count;
    return Semantics(
      container: true,
      button: true,
      selected: isSelected,
      label: label,
      value: count?.toString(),
      child: Material(
        color: isSelected && selectedBackground != null
            ? selectedBackground
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          hoverColor: Colors.transparent,
          highlightColor: Colors.transparent,
          splashColor: Colors.transparent,
          overlayColor: WidgetStateProperty.all(Colors.transparent),
          splashFactory: NoSplash.splashFactory,
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Center(
              child: ExcludeSemantics(
                child: count == null
                    ? labelText
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Flexible(child: labelText),
                          const SizedBox(width: 6),
                          Text(
                            _formatHistoryCount(count),
                            key: ValueKey('history_filter_count_$filter'),
                            maxLines: 1,
                            softWrap: false,
                            style: AirQrTypography.of(context).numeric.copyWith(
                              color: isSelected
                                  ? AirQrTheme.textSecondary(context)
                                  : AirQrTheme.textMuted(context),
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HistorySearchToolbar extends StatelessWidget {
  final TextEditingController searchController;
  final bool searchOpen;
  final String searchQuery;
  final String searchHint;
  final bool connected;
  final String connectedLabel;
  final String refreshTooltip;
  final String clearSearchTooltip;
  final VoidCallback onToggleSearch;
  final VoidCallback onClearSearch;
  final ValueChanged<String> onSearchChanged;
  final String sortTooltip;
  final List<HistorySortMenuValue> sortItems;
  final ValueChanged<HistorySortMenuValue> onSortSelected;
  final VoidCallback onRefresh;
  final bool canClearHistory;
  final String clearHistoryTooltip;
  final VoidCallback? onClearHistory;
  final bool syncEnabled;
  final bool isSyncingNow;
  final String syncTooltip;
  final VoidCallback onSyncNow;
  final String selectTooltip;

  /// Enters multi-select mode; the action is hidden when null.
  final VoidCallback? onEnterSelection;
  final Color cardColor;
  final Color primaryColor;

  const HistorySearchToolbar({
    super.key,
    required this.searchController,
    required this.searchOpen,
    required this.searchQuery,
    required this.searchHint,
    required this.connected,
    required this.connectedLabel,
    required this.refreshTooltip,
    required this.clearSearchTooltip,
    required this.onToggleSearch,
    required this.onClearSearch,
    required this.onSearchChanged,
    required this.sortTooltip,
    required this.sortItems,
    required this.onSortSelected,
    required this.onRefresh,
    required this.canClearHistory,
    required this.clearHistoryTooltip,
    required this.onClearHistory,
    required this.syncEnabled,
    required this.isSyncingNow,
    required this.syncTooltip,
    required this.onSyncNow,
    this.selectTooltip = 'Select',
    this.onEnterSelection,
    required this.cardColor,
    required this.primaryColor,
  });

  @override
  Widget build(BuildContext context) {
    final controlBorder = AirQrTheme.controlBorder(context);
    final textPrimary = AirQrTheme.textPrimary(context);
    final textSecondary = AirQrTheme.textSecondary(context);
    final textMuted = AirQrTheme.textMuted(context);
    final actionSurface = AirQrTheme.actionSurface(context);
    final actionHover = AirQrTheme.actionHover(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final scaledBadgeFont = MediaQuery.textScalerOf(
                context,
              ).scale(10);
              final connectionBadge = Container(
                constraints: BoxConstraints(
                  minHeight: 28,
                  maxWidth: scaledBadgeFont > 14 ? 220 : 128,
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: AirQrTheme.successSurface(context),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: AirQrTheme.successText(
                      context,
                    ).withValues(alpha: 0.22),
                  ),
                ),
                child: Text(
                  connectedLabel.toUpperCase(),
                  maxLines: scaledBadgeFont > 14 ? 2 : 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: AirQrTheme.successText(context),
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    height: 1.5,
                  ),
                ),
              );
              final actions = Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 8,
                children: [
                  _HistoryToolbarActionBox(
                    surfaceColor: actionSurface,
                    hoverColor: actionHover,
                    child: IconButton(
                      tooltip: searchHint,
                      onPressed: onToggleSearch,
                      icon: AirQrIcon(
                        searchOpen ? 'close' : 'search',
                        color: textSecondary,
                        size: 20,
                      ),
                    ),
                  ),
                  if (onEnterSelection != null) ...[
                    _HistoryToolbarActionBox(
                      surfaceColor: actionSurface,
                      hoverColor: actionHover,
                      child: IconButton(
                        tooltip: selectTooltip,
                        onPressed: onEnterSelection,
                        icon: AirQrIcon(
                          'checklist',
                          color: textSecondary,
                          size: 20,
                        ),
                      ),
                    ),
                  ],
                  _HistoryToolbarActionBox(
                    surfaceColor: actionSurface,
                    hoverColor: actionHover,
                    child: _HistorySortDropdownButton(
                      tooltip: sortTooltip,
                      items: sortItems,
                      onSelected: onSortSelected,
                      iconColor: textSecondary,
                      menuSurfaceColor: actionSurface,
                      selectedSurfaceColor: AirQrTheme.navActive(context),
                      hoverColor: actionHover,
                      borderColor: controlBorder,
                    ),
                  ),
                  _HistoryToolbarActionBox(
                    surfaceColor: actionSurface,
                    hoverColor: actionHover,
                    child: IconButton(
                      tooltip: refreshTooltip,
                      onPressed: onRefresh,
                      icon: AirQrIcon(
                        'refresh',
                        color: textSecondary,
                        size: 20,
                      ),
                    ),
                  ),
                  if (syncEnabled) ...[
                    _HistoryToolbarActionBox(
                      surfaceColor: actionSurface,
                      hoverColor: actionHover,
                      child: IconButton(
                        tooltip: syncTooltip,
                        onPressed: isSyncingNow ? null : onSyncNow,
                        icon: isSyncingNow
                            ? SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    textSecondary,
                                  ),
                                ),
                              )
                            : AirQrIcon(
                                'cloud_upload',
                                color: textSecondary,
                                size: 20,
                              ),
                      ),
                    ),
                  ],
                  _HistoryToolbarActionBox(
                    surfaceColor: actionSurface,
                    hoverColor: actionHover,
                    child: IconButton(
                      tooltip: clearHistoryTooltip,
                      onPressed: canClearHistory ? onClearHistory : null,
                      icon: AirQrIcon(
                        'delete',
                        color: canClearHistory
                            ? AirQrTheme.dangerText(context)
                            : textMuted.withValues(alpha: 0.42),
                        size: 20,
                      ),
                    ),
                  ),
                ],
              );

              // Match the web: 48dp actions, 8dp gaps and an uncompressed badge.
              final actionCount =
                  4 +
                  (syncEnabled ? 1 : 0) +
                  (onEnterSelection != null ? 1 : 0);
              final actionsWidth = actionCount * 48.0 + (actionCount - 1) * 8;
              final useStackedToolbar =
                  constraints.maxWidth < 290 ||
                  constraints.maxWidth < actionsWidth + 140 ||
                  scaledBadgeFont > 14;
              if (useStackedToolbar) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (connected) ...[
                      connectionBadge,
                      const SizedBox(height: 8),
                    ],
                    Align(alignment: Alignment.centerRight, child: actions),
                  ],
                );
              }

              return Row(
                children: [
                  if (connected) connectionBadge,
                  const Spacer(),
                  actions,
                ],
              );
            },
          ),
          if (searchOpen) ...[
            const SizedBox(height: 12),
            Container(
              constraints: const BoxConstraints(minHeight: 56),
              decoration: BoxDecoration(
                color: AirQrTheme.card(context),
                borderRadius: BorderRadius.circular(28),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                children: [
                  AirQrIcon('search', color: textMuted, size: 24),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: searchController,
                      autofocus: true,
                      style: TextStyle(
                        color: textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                      decoration: InputDecoration(
                        hintText: searchHint,
                        hintStyle: TextStyle(
                          color: textMuted,
                          fontWeight: FontWeight.w600,
                        ),
                        border: InputBorder.none,
                      ),
                      onChanged: onSearchChanged,
                    ),
                  ),
                  if (searchQuery.isNotEmpty)
                    IconButton(
                      tooltip: clearSearchTooltip,
                      onPressed: onClearSearch,
                      icon: AirQrIcon('close', color: textSecondary, size: 18),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Replaces [HistorySearchToolbar] while History is in multi-select mode.
class HistorySelectionBar extends StatelessWidget {
  final String selectedLabel;
  final bool allSelected;
  final String selectAllLabel;
  final String deselectAllLabel;
  final String closeTooltip;
  final VoidCallback onClose;
  final VoidCallback? onToggleSelectAll;
  final String deleteTooltip;
  final VoidCallback? onDelete;
  final bool showDownload;
  final String downloadTooltip;
  final VoidCallback? onDownload;
  final String syncTooltip;

  /// Hidden when null.
  final VoidCallback? onSync;
  final String keepLocalTooltip;

  /// Hidden when null.
  final VoidCallback? onKeepLocal;

  const HistorySelectionBar({
    super.key,
    required this.selectedLabel,
    required this.allSelected,
    required this.selectAllLabel,
    required this.deselectAllLabel,
    required this.closeTooltip,
    required this.onClose,
    required this.onToggleSelectAll,
    required this.deleteTooltip,
    required this.onDelete,
    required this.showDownload,
    required this.downloadTooltip,
    required this.onDownload,
    required this.syncTooltip,
    this.onSync,
    required this.keepLocalTooltip,
    this.onKeepLocal,
  });

  @override
  Widget build(BuildContext context) {
    final textPrimary = AirQrTheme.textPrimary(context);
    final textSecondary = AirQrTheme.textSecondary(context);
    final actionSurface = AirQrTheme.actionSurface(context);
    final actionHover = AirQrTheme.actionHover(context);
    final disabledColor = AirQrTheme.textMuted(context).withValues(alpha: 0.42);

    Widget actionBox({
      required String tooltip,
      required String iconName,
      required VoidCallback? onPressed,
      required Color color,
    }) {
      return _HistoryToolbarActionBox(
        surfaceColor: actionSurface,
        hoverColor: actionHover,
        child: IconButton(
          tooltip: tooltip,
          onPressed: onPressed,
          icon: AirQrIcon(
            iconName,
            color: onPressed == null ? disabledColor : color,
            size: 18,
          ),
        ),
      );
    }

    final actionButtons = <Widget>[
      actionBox(
        tooltip: deleteTooltip,
        iconName: 'delete',
        onPressed: onDelete,
        color: AirQrTheme.dangerText(context),
      ),
      if (showDownload)
        actionBox(
          tooltip: downloadTooltip,
          iconName: 'download',
          onPressed: onDownload,
          color: textSecondary,
        ),
      if (onSync != null)
        actionBox(
          tooltip: syncTooltip,
          iconName: 'cloud_upload',
          onPressed: onSync,
          color: textSecondary,
        ),
      if (onKeepLocal != null)
        actionBox(
          tooltip: keepLocalTooltip,
          iconName: 'cloud_off',
          onPressed: onKeepLocal,
          color: AirQrTheme.warningText(context),
        ),
    ];
    final actions = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var index = 0; index < actionButtons.length; index++) ...[
          if (index > 0) const SizedBox(width: 4),
          actionButtons[index],
        ],
      ],
    );
    final actionsWidth =
        actionButtons.length * 36.0 + (actionButtons.length - 1) * 4;

    final close = actionBox(
      tooltip: closeTooltip,
      iconName: 'close',
      onPressed: onClose,
      color: textSecondary,
    );
    final count = Text(
      selectedLabel,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(
        color: textPrimary,
        fontWeight: FontWeight.w800,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
    final selectAll = TextButton(
      onPressed: onToggleSelectAll,
      style: TextButton.styleFrom(
        foregroundColor: AirQrTheme.accentText(context),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        minimumSize: const Size(48, 36),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      child: Text(
        allSelected ? deselectAllLabel : selectAllLabel,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final singleRow =
              constraints.maxWidth >= actionsWidth + 300 &&
              MediaQuery.textScalerOf(context).scale(14) <= 20;
          if (singleRow) {
            return Row(
              children: [
                close,
                const SizedBox(width: 10),
                Expanded(child: count),
                selectAll,
                const SizedBox(width: 8),
                actions,
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  close,
                  const SizedBox(width: 10),
                  Expanded(child: count),
                  Flexible(child: selectAll),
                ],
              ),
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerRight, child: actions),
            ],
          );
        },
      ),
    );
  }
}

class _HistoryToolbarActionBox extends StatefulWidget {
  final Color surfaceColor;
  final Color hoverColor;
  final Widget child;

  const _HistoryToolbarActionBox({
    required this.surfaceColor,
    required this.hoverColor,
    required this.child,
  });

  @override
  State<_HistoryToolbarActionBox> createState() =>
      _HistoryToolbarActionBoxState();
}

class _HistoryToolbarActionBoxState extends State<_HistoryToolbarActionBox> {
  bool _hovered = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    return Focus(
      canRequestFocus: false,
      skipTraversal: true,
      onFocusChange: (focused) => setState(() => _focused = focused),
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        child: AnimatedContainer(
          duration: _historyAnimationDuration(
            context,
            const Duration(milliseconds: 160),
          ),
          curve: Curves.easeOut,
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: _hovered || _focused
                ? widget.hoverColor
                : widget.surfaceColor,
            borderRadius: BorderRadius.circular(24),
          ),
          foregroundDecoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: AirQrTheme.controlBorder(context)),
          ),
          child: widget.child,
        ),
      ),
    );
  }
}

class HistoryEmptyState extends StatelessWidget {
  final String filter;
  final String scannedLabel;
  final String generatedLabel;

  const HistoryEmptyState({
    super.key,
    required this.filter,
    required this.scannedLabel,
    required this.generatedLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AirQrIcon(
            filter == 'scanned' ? 'qr_code_scanner' : 'gif_box',
            size: 64,
            color: AirQrTheme.textMuted(context),
          ),
          const SizedBox(height: 16),
          Text(
            filter == 'scanned' ? scannedLabel : generatedLabel,
            style: TextStyle(color: AirQrTheme.textMuted(context)),
          ),
        ],
      ),
    );
  }
}

class _HistorySortDropdownButton extends StatefulWidget {
  final String tooltip;
  final List<HistorySortMenuValue> items;
  final ValueChanged<HistorySortMenuValue> onSelected;
  final Color iconColor;
  final Color menuSurfaceColor;
  final Color selectedSurfaceColor;
  final Color hoverColor;
  final Color borderColor;

  const _HistorySortDropdownButton({
    required this.tooltip,
    required this.items,
    required this.onSelected,
    required this.iconColor,
    required this.menuSurfaceColor,
    required this.selectedSurfaceColor,
    required this.hoverColor,
    required this.borderColor,
  });

  @override
  State<_HistorySortDropdownButton> createState() =>
      _HistorySortDropdownButtonState();
}

class _HistorySortDropdownButtonState
    extends State<_HistorySortDropdownButton> {
  final MenuController _controller = MenuController();

  @override
  Widget build(BuildContext context) {
    final textPrimary = AirQrTheme.textPrimary(context);
    final textSecondary = AirQrTheme.textSecondary(context);

    return MenuAnchor(
      controller: _controller,
      alignmentOffset: const Offset(-142, 8),
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(widget.menuSurfaceColor),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        elevation: const WidgetStatePropertyAll(18),
        padding: const WidgetStatePropertyAll(EdgeInsets.zero),
        minimumSize: const WidgetStatePropertyAll(Size(190, 0)),
        maximumSize: const WidgetStatePropertyAll(Size(220, double.infinity)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        side: WidgetStatePropertyAll(BorderSide(color: widget.borderColor)),
      ),
      menuChildren: widget.items
          .map(
            (item) => _HistorySortMenuRow(
              item: item,
              textColor: item.selected ? textPrimary : textSecondary,
              surfaceColor: item.selected
                  ? widget.selectedSurfaceColor
                  : widget.menuSurfaceColor,
              hoverColor: widget.hoverColor,
              onTap: () {
                _controller.close();
                widget.onSelected(item);
              },
            ),
          )
          .toList(),
      builder: (context, controller, child) {
        return IconButton(
          tooltip: widget.tooltip,
          onPressed: () {
            if (controller.isOpen) {
              controller.close();
            } else {
              controller.open();
            }
          },
          icon: AirQrIcon('sort', color: widget.iconColor, size: 22),
        );
      },
    );
  }
}

class _HistorySortMenuRow extends StatelessWidget {
  final HistorySortMenuValue item;
  final Color textColor;
  final Color surfaceColor;
  final Color hoverColor;
  final VoidCallback onTap;

  const _HistorySortMenuRow({
    required this.item,
    required this.textColor,
    required this.surfaceColor,
    required this.hoverColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 190, minHeight: 48),
      child: Material(
        color: surfaceColor,
        child: InkWell(
          onTap: onTap,
          hoverColor: hoverColor,
          splashColor: hoverColor.withValues(alpha: 0.45),
          highlightColor: hoverColor.withValues(alpha: 0.55),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(
              children: [
                AirQrIcon(item.iconName, size: 16, color: textColor),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    item.label,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: textColor,
                      height: 1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (item.selected) ...[
                  const SizedBox(width: 8),
                  AirQrIcon('check', size: 16, color: textColor),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HistorySortMenuValue {
  final String label;
  final String iconName;
  final bool selected;
  final Object value;

  const HistorySortMenuValue({
    required this.label,
    required this.iconName,
    required this.selected,
    required this.value,
  });
}

class HistorySectionHeader extends StatelessWidget {
  final String title;

  const HistorySectionHeader({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, top: 8, bottom: 4),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          color: _historyMutedText(context),
          letterSpacing: 1.98,
        ),
      ),
    );
  }
}

class HistoryActionButton extends StatelessWidget {
  final String iconName;
  final String semanticLabel;
  final VoidCallback? onPressed;
  final Color? color;
  final double dimension;
  final double? visualDimension;
  final double iconSize;
  final bool autofocus;
  final bool busy;

  const HistoryActionButton({
    super.key,
    required this.iconName,
    required this.semanticLabel,
    required this.onPressed,
    this.color,
    this.dimension = 48,
    this.visualDimension,
    this.iconSize = 18,
    this.autofocus = false,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    final iconColor = enabled
        ? (color ?? AirQrTheme.textSecondary(context))
        : AirQrTheme.disabledText(context);

    return Tooltip(
      message: semanticLabel,
      excludeFromSemantics: true,
      child: Semantics(
        container: true,
        button: true,
        enabled: enabled,
        label: semanticLabel,
        onTap: enabled ? onPressed : null,
        child: ExcludeSemantics(
          child: IconButton(
            autofocus: autofocus,
            onPressed: enabled ? onPressed : null,
            tooltip: null,
            style: ButtonStyle(
              fixedSize: WidgetStatePropertyAll(Size.square(dimension)),
              minimumSize: WidgetStatePropertyAll(Size.square(dimension)),
              maximumSize: WidgetStatePropertyAll(Size.square(dimension)),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              padding: const WidgetStatePropertyAll(EdgeInsets.zero),
              foregroundColor: WidgetStatePropertyAll(iconColor),
              backgroundColor: const WidgetStatePropertyAll(Colors.transparent),
              overlayColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.hovered) ||
                    states.contains(WidgetState.focused) ||
                    states.contains(WidgetState.pressed)) {
                  return AirQrTheme.actionHover(context);
                }
                return Colors.transparent;
              }),
              side: const WidgetStatePropertyAll(BorderSide.none),
              shape: WidgetStatePropertyAll(
                RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(dimension / 2),
                ),
              ),
            ),
            icon: Container(
              width: visualDimension ?? dimension,
              height: visualDimension ?? dimension,
              decoration: BoxDecoration(
                color: AirQrTheme.actionSurface(context),
                border: Border.all(color: AirQrTheme.controlBorder(context)),
                borderRadius: BorderRadius.circular(
                  (visualDimension ?? dimension) / 2,
                ),
              ),
              alignment: Alignment.center,
              child: busy
                  ? SizedBox.square(
                      dimension: iconSize,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: iconColor,
                      ),
                    )
                  : AirQrIcon(iconName, color: iconColor, size: iconSize),
            ),
          ),
        ),
      ),
    );
  }
}

class AirQrSyncBadge extends StatelessWidget {
  final String iconName;

  const AirQrSyncBadge({super.key, this.iconName = 'cloud'});

  @override
  Widget build(BuildContext context) {
    final isDark = AirQrTheme.isDark(context);

    return Container(
      width: 20,
      height: 20,
      decoration: BoxDecoration(
        color: isDark ? const Color(0x29FFFFFF) : const Color(0xF5C6D1DC),
        borderRadius: BorderRadius.circular(10),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.22)
                : const Color(0x29385369),
            blurRadius: isDark ? 5 : 4,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: Center(child: AirQrIcon(iconName, size: 12, color: Colors.white)),
    );
  }
}

class CompletedHistoryCard extends StatelessWidget {
  final HistoryItem item;
  final Color cardColor;
  final Color successColor;
  final String subtitle;
  final String viewLabel;
  final String keepLocalLabel;
  final String syncLabel;
  final String saveLabel;
  final String deleteLabel;
  final VoidCallback? onView;
  final VoidCallback? onKeepLocal;
  final VoidCallback? onSync;
  final VoidCallback? onSave;
  final VoidCallback onDelete;
  final VoidCallback onDismissed;

  /// In selection mode the card shows a leading checkbox, taps toggle
  /// [selected] through [onToggleSelected], and swipe / actions are hidden.
  final bool selectionMode;
  final bool selected;
  final bool isSyncing;
  final bool syncAvailable;
  final VoidCallback? onToggleSelected;

  /// Long press outside selection mode (enters selection mode).
  final VoidCallback? onLongPress;

  const CompletedHistoryCard({
    super.key,
    required this.item,
    required this.cardColor,
    required this.successColor,
    required this.subtitle,
    this.viewLabel = 'Open',
    this.keepLocalLabel = 'Keep local',
    this.syncLabel = 'Sync to server',
    this.saveLabel = 'Download',
    this.deleteLabel = 'Delete',
    required this.onView,
    required this.onKeepLocal,
    required this.onSync,
    required this.onSave,
    required this.onDelete,
    required this.onDismissed,
    this.selectionMode = false,
    this.selected = false,
    this.isSyncing = false,
    this.syncAvailable = true,
    this.onToggleSelected,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final isRemoteOnly = item.path.startsWith('airqr-remote://');
    final exists = isRemoteOnly || File(item.path).existsSync();
    final fileName = p.basename(item.path);

    String fileIconName;
    if (!exists) {
      fileIconName = 'error';
    } else if (item.isNote) {
      fileIconName = 'description';
    } else if (item.mimeType == 'application/zip' ||
        fileName.endsWith('.zip')) {
      fileIconName = 'folder_zip';
    } else {
      fileIconName = 'description';
    }
    final showKeepLocalAction = item.isSynced && !item.isLocalOnly;
    final showSyncAction =
        syncAvailable && (!item.isSynced || item.isLocalOnly);
    final identity = Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AirQrTheme.iconSurface(context),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Center(
                child: AirQrIcon(
                  fileIconName,
                  color: exists
                      ? AirQrTheme.textPrimary(context)
                      : AirQrTheme.disabledText(context),
                ),
              ),
              if (item.isSynced)
                const Positioned(
                  right: -4,
                  bottom: -4,
                  child: AirQrSyncBadge(),
                ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                fileName,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontFamily: AirQrTypography.of(
                    context,
                  ).compactStatus.fontFamily,
                  color: AirQrTheme.textPrimary(context),
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: _historyMutedText(context),
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    final actions = Wrap(
      spacing: 0,
      runSpacing: 4,
      alignment: WrapAlignment.end,
      children: [
        if (onView != null)
          HistoryActionButton(
            iconName: 'visibility',
            semanticLabel: viewLabel,
            onPressed: exists ? onView : null,
            color: AirQrTheme.successText(context),
            dimension: 44,
            visualDimension: 40,
            iconSize: 20,
          ),
        if (showKeepLocalAction)
          HistoryActionButton(
            iconName: 'cloud_off',
            semanticLabel: keepLocalLabel,
            onPressed: onKeepLocal,
            color: AirQrTheme.warningText(context),
            dimension: 44,
            visualDimension: 40,
            iconSize: 20,
          ),
        if (showSyncAction)
          HistoryActionButton(
            iconName: 'cloud_upload',
            semanticLabel: syncLabel,
            busy: isSyncing,
            onPressed: exists ? onSync : null,
            color: Colors.white,
            dimension: 44,
            visualDimension: 40,
            iconSize: 20,
          ),
        HistoryActionButton(
          iconName: 'download',
          semanticLabel: saveLabel,
          onPressed: exists ? onSave : null,
          color: AirQrTheme.accentText(context),
          dimension: 44,
          visualDimension: 40,
          iconSize: 20,
        ),
        HistoryActionButton(
          iconName: 'delete',
          semanticLabel: deleteLabel,
          onPressed: onDelete,
          color: AirQrTheme.dangerText(context),
          dimension: 44,
          visualDimension: 40,
          iconSize: 20,
        ),
      ],
    );

    final card = InkWell(
      excludeFromSemantics: true,
      canRequestFocus: false,
      borderRadius: BorderRadius.circular(28),
      onTap: selectionMode ? onToggleSelected : null,
      onLongPress: selectionMode ? onToggleSelected : onLongPress,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: cardColor,
          borderRadius: BorderRadius.circular(28),
          boxShadow: AirQrTheme.softShadow(context),
        ),
        foregroundDecoration: _historySelectedOutline(
          selectionMode && selected,
        ),
        child: selectionMode
            ? Row(
                children: [
                  HistorySelectionCheckbox(
                    selected: selected,
                    semanticLabel: fileName,
                    onChanged: onToggleSelected,
                  ),
                  const SizedBox(width: 6),
                  Expanded(child: identity),
                ],
              )
            : LayoutBuilder(
                builder: (context, constraints) {
                  final useStackedLayout =
                      constraints.maxWidth < 260 ||
                      MediaQuery.textScalerOf(context).scale(15) > 22;
                  if (useStackedLayout) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        identity,
                        const SizedBox(height: 8),
                        Align(alignment: Alignment.centerRight, child: actions),
                      ],
                    );
                  }
                  return Row(
                    children: [
                      Expanded(child: identity),
                      const SizedBox(width: 4),
                      actions,
                    ],
                  );
                },
              ),
      ),
    );

    if (selectionMode) return card;
    return Dismissible(
      key: ValueKey('file_${item.path}_${item.timestamp}'),
      background: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: AirQrTheme.destructive,
          borderRadius: BorderRadius.circular(28),
        ),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        child: const AirQrIcon('delete', color: Colors.white),
      ),
      direction: DismissDirection.endToStart,
      onDismissed: (_) => onDismissed(),
      child: card,
    );
  }
}

BoxDecoration? _historySelectedOutline(bool selected, {double radius = 28}) =>
    selected
    ? BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AirQrTheme.accentBlue, width: 2),
      )
    : null;

/// Leading checkbox shown on history cards in selection mode.
class HistorySelectionCheckbox extends StatelessWidget {
  final bool selected;
  final String semanticLabel;
  final VoidCallback? onChanged;

  const HistorySelectionCheckbox({
    super.key,
    required this.selected,
    required this.semanticLabel,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final accent = AirQrTheme.accentText(context);
    final duration = _historyAnimationDuration(
      context,
      const Duration(milliseconds: 150),
    );
    // Round 24dp control centered in a 44dp tap target (mirrors web).
    return Semantics(
      container: true,
      checked: selected,
      enabled: onChanged != null,
      label: semanticLabel,
      onTap: onChanged,
      child: ExcludeSemantics(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onChanged,
          child: SizedBox.square(
            dimension: 44,
            child: Center(
              child: AnimatedContainer(
                duration: duration,
                curve: Curves.easeOut,
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? accent : Colors.transparent,
                  border: Border.all(
                    color: selected ? accent : AirQrTheme.textMuted(context),
                    width: 2,
                  ),
                ),
                alignment: Alignment.center,
                child: AnimatedOpacity(
                  duration: duration,
                  curve: Curves.easeOut,
                  opacity: selected ? 1 : 0,
                  child: AnimatedScale(
                    duration: duration,
                    curve: Curves.easeOut,
                    scale: selected ? 1 : 0.5,
                    child: AirQrIcon(
                      'check',
                      size: 14,
                      color: AirQrTheme.card(context),
                      exactColor: true,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class IncompleteHistoryCard extends StatelessWidget {
  final IncompleteScan scan;
  final Color cardColor;
  final Color warningColor;
  final String displayName;
  final String packetsSummary;
  final String? serverSyncSummary;
  final String formattedDate;
  final String keepLocalLabel;
  final String syncLabel;
  final String resumeLabel;
  final String deleteLabel;
  final VoidCallback? onSync;
  final VoidCallback? onKeepLocal;
  final VoidCallback onResume;
  final VoidCallback onDelete;

  /// See [CompletedHistoryCard.selectionMode].
  final bool selectionMode;
  final bool selected;
  final bool isSyncing;
  final VoidCallback? onToggleSelected;
  final VoidCallback? onLongPress;

  const IncompleteHistoryCard({
    super.key,
    required this.scan,
    required this.cardColor,
    required this.warningColor,
    required this.displayName,
    required this.packetsSummary,
    this.serverSyncSummary,
    required this.formattedDate,
    this.keepLocalLabel = 'Keep local',
    this.syncLabel = 'Sync to server',
    this.resumeLabel = 'Resume scan',
    this.deleteLabel = 'Delete incomplete scan',
    this.onSync,
    this.onKeepLocal,
    required this.onResume,
    required this.onDelete,
    this.selectionMode = false,
    this.selected = false,
    this.isSyncing = false,
    this.onToggleSelected,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final actions = Wrap(
      alignment: WrapAlignment.end,
      children: [
        if (onKeepLocal != null)
          HistoryActionButton(
            iconName: 'cloud_off',
            semanticLabel: keepLocalLabel,
            onPressed: onKeepLocal,
            color: AirQrTheme.warningText(context),
            dimension: 44,
            visualDimension: 40,
            iconSize: 20,
          )
        else if (onSync != null || isSyncing)
          HistoryActionButton(
            iconName: 'cloud_upload',
            semanticLabel: syncLabel,
            busy: isSyncing,
            onPressed: onSync,
            color: AirQrTheme.accentText(context),
            dimension: 44,
            visualDimension: 40,
            iconSize: 20,
          ),
        HistoryActionButton(
          iconName: 'play_arrow',
          semanticLabel: resumeLabel,
          onPressed: onResume,
          color: AirQrTheme.textPrimary(context),
          dimension: 44,
          visualDimension: 40,
          iconSize: 20,
        ),
        HistoryActionButton(
          iconName: 'delete',
          semanticLabel: deleteLabel,
          onPressed: onDelete,
          color: AirQrTheme.dangerText(context),
          dimension: 44,
          visualDimension: 40,
          iconSize: 20,
        ),
      ],
    );
    final identity = Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AirQrTheme.iconSurface(context),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Center(
                child: AirQrIcon(
                  'autorenew',
                  size: 24,
                  color: AirQrTheme.textPrimary(context),
                ),
              ),
              if (scan.isRemote)
                const Positioned(
                  right: -4,
                  bottom: -4,
                  child: AirQrSyncBadge(),
                ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                displayName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: AirQrTheme.textPrimary(context),
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (scan.deviceName != null)
                Text(
                  scan.deviceName!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AirQrTheme.warningText(context),
                  ),
                ),
              const SizedBox(height: 3),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text:
                          '${formatIncompleteProgressPercent(scan.progress)}%',
                      style: TextStyle(
                        color: AirQrTheme.warningText(context),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    TextSpan(
                      text:
                          ' • $packetsSummary${serverSyncSummary == null ? '' : ' • $serverSyncSummary'} • $formattedDate',
                    ),
                  ],
                ),
                style: AirQrTypography.of(context).liveNumeric.copyWith(
                  color: AirQrTheme.textMuted(context),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    final card = InkWell(
      excludeFromSemantics: true,
      canRequestFocus: false,
      borderRadius: BorderRadius.circular(30),
      onTap: selectionMode ? onToggleSelected : onResume,
      onLongPress: selectionMode ? onToggleSelected : onLongPress,
      child: Container(
        key: ValueKey('history_incomplete_card_${scan.id}'),
        margin: const EdgeInsets.only(bottom: 12),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: cardColor,
          borderRadius: BorderRadius.circular(30),
          boxShadow: AirQrTheme.softShadow(context),
        ),
        foregroundDecoration: _historySelectedOutline(
          selectionMode && selected,
          radius: 30,
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  if (selectionMode) {
                    return Row(
                      children: [
                        HistorySelectionCheckbox(
                          selected: selected,
                          semanticLabel: displayName,
                          onChanged: onToggleSelected,
                        ),
                        const SizedBox(width: 6),
                        Expanded(child: identity),
                      ],
                    );
                  }
                  if (constraints.maxWidth < 280 ||
                      MediaQuery.textScalerOf(context).scale(16) > 24) {
                    return Column(
                      children: [
                        identity,
                        const SizedBox(height: 8),
                        Align(alignment: Alignment.centerRight, child: actions),
                      ],
                    );
                  }
                  return Row(
                    children: [
                      Expanded(child: identity),
                      const SizedBox(width: 8),
                      actions,
                    ],
                  );
                },
              ),
            ),
            LinearProgressIndicator(
              value: normalizeIncompleteProgress(scan.progress),
              backgroundColor: AirQrTheme.warningSurface(context),
              valueColor: const AlwaysStoppedAnimation<Color>(
                AirQrTheme.progressOrange,
              ),
              minHeight: 6,
            ),
          ],
        ),
      ),
    );

    if (selectionMode) return card;
    return Dismissible(
      key: ValueKey('scan_${scan.id}'),
      background: Container(
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: AirQrTheme.destructive,
          borderRadius: BorderRadius.circular(28),
        ),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        child: const AirQrIcon('delete', color: Colors.white),
      ),
      direction: DismissDirection.endToStart,
      onDismissed: (_) => onDelete(),
      child: card,
    );
  }
}
