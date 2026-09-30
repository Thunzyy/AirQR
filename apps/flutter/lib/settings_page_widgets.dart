import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'widgets/airqr_segmented_control.dart';

bool settingsControlUsesStackedLayout(
  BuildContext context,
  BoxConstraints constraints,
) =>
    constraints.maxWidth < 360 ||
    MediaQuery.textScalerOf(context).scale(16) > 24;

class SettingsSectionHeader extends StatelessWidget {
  final String title;
  final Color color;

  const SettingsSectionHeader({
    super.key,
    required this.title,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        title,
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: color.withValues(alpha: 0.8),
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class SettingsCard extends StatelessWidget {
  final Color backgroundColor;
  final Color borderColor;
  final List<Widget> children;

  const SettingsCard({
    super.key,
    required this.backgroundColor,
    required this.borderColor,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: AirQrRadii.card,
        border: Border.all(color: borderColor),
      ),
      child: Column(children: children),
    );
  }
}

class SettingsCardDivider extends StatelessWidget {
  final Color color;

  const SettingsCardDivider({super.key, required this.color});

  @override
  Widget build(BuildContext context) {
    return Divider(height: 1, color: color);
  }
}

class SettingsPresetOption extends StatelessWidget {
  final String emoji;
  final String name;
  final String description;
  final bool selected;
  final Color primaryTextColor;
  final Color secondaryTextColor;
  final Color selectedColor;
  final VoidCallback onTap;

  const SettingsPresetOption({
    super.key,
    required this.emoji,
    required this.name,
    required this.description,
    required this.selected,
    required this.primaryTextColor,
    required this.secondaryTextColor,
    required this.selectedColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Text(emoji, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: TextStyle(
                      color: primaryTextColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    description,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: secondaryTextColor,
                    ),
                  ),
                ],
              ),
            ),
            if (selected)
              AirQrIcon('check_circle', color: selectedColor, size: 22),
          ],
        ),
      ),
    );
  }
}

class SettingsSliderTile extends StatelessWidget {
  final String label;
  final double value;
  final double min;
  final double max;
  final ValueChanged<double> onChanged;
  final VoidCallback onChangeEnd;
  final String suffix;
  final int decimals;
  final Color primaryTextColor;
  final Color accentColor;
  final Color inactiveTrackColor;

  const SettingsSliderTile({
    super.key,
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.onChanged,
    required this.onChangeEnd,
    required this.primaryTextColor,
    required this.accentColor,
    required this.inactiveTrackColor,
    this.suffix = '',
    this.decimals = 0,
  });

  @override
  Widget build(BuildContext context) {
    final sliderFillColor = AirQrTheme.isDark(context)
        ? AirQrTheme.navActive(context)
        : AirQrTheme.primaryButtonSurface(context);
    final sliderThumbColor = AirQrTheme.primaryButtonSurface(context);

    final labelText = Text(
      label,
      style: TextStyle(color: primaryTextColor, fontWeight: FontWeight.w500),
    );
    final valueText = Text(
      '${decimals > 0 ? value.toStringAsFixed(decimals) : value.round()}$suffix',
      textAlign: TextAlign.right,
      style: TextStyle(color: primaryTextColor, fontWeight: FontWeight.bold),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = settingsControlUsesStackedLayout(context, constraints);
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (stacked)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    labelText,
                    const SizedBox(height: 4),
                    Align(alignment: Alignment.centerRight, child: valueText),
                  ],
                )
              else
                Row(
                  children: [
                    Expanded(child: labelText),
                    const SizedBox(width: 12),
                    valueText,
                  ],
                ),
              SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  activeTrackColor: sliderFillColor,
                  inactiveTrackColor: inactiveTrackColor,
                  thumbColor: sliderThumbColor,
                  overlayColor: sliderFillColor.withValues(alpha: 0.2),
                ),
                child: Slider(
                  value: value,
                  min: min,
                  max: max,
                  onChanged: onChanged,
                  onChangeEnd: (_) => onChangeEnd(),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class SettingsDropdownTile extends StatelessWidget {
  final String label;
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final Color primaryTextColor;
  final Color accentColor;
  final Color fieldBackgroundColor;
  final Color borderColor;
  final Color dropdownColor;

  const SettingsDropdownTile({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.primaryTextColor,
    required this.accentColor,
    required this.fieldBackgroundColor,
    required this.borderColor,
    required this.dropdownColor,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked = settingsControlUsesStackedLayout(context, constraints);
        final labelWidget = Text(
          label,
          style: TextStyle(
            color: primaryTextColor,
            fontWeight: FontWeight.w500,
          ),
        );
        final dropdown = Container(
          key: const Key('settings-dropdown-field'),
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: fieldBackgroundColor,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: borderColor),
          ),
          child: DropdownButton<String>(
            value: value,
            isExpanded: stacked,
            itemHeight: 48,
            dropdownColor: dropdownColor,
            underline: const SizedBox(),
            isDense: false,
            style: TextStyle(
              color: primaryTextColor,
              fontWeight: FontWeight.w600,
            ),
            items: options
                .map(
                  (option) =>
                      DropdownMenuItem(value: option, child: Text(option)),
                )
                .toList(),
            onChanged: (next) {
              if (next != null) onChanged(next);
            },
          ),
        );
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: stacked
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    labelWidget,
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: SizedBox(width: double.infinity, child: dropdown),
                    ),
                  ],
                )
              : Row(
                  children: [
                    Expanded(child: labelWidget),
                    const SizedBox(width: 12),
                    dropdown,
                  ],
                ),
        );
      },
    );
  }
}

class SettingsSwitchTile extends StatelessWidget {
  final String label;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  final Color primaryTextColor;
  final Color secondaryTextColor;

  const SettingsSwitchTile({
    super.key,
    required this.label,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    required this.primaryTextColor,
    required this.secondaryTextColor,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final stacked =
            constraints.maxWidth < 280 ||
            MediaQuery.textScalerOf(context).scale(16) > 24;
        final copy = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                color: primaryTextColor,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              subtitle,
              style: Theme.of(
                context,
              ).textTheme.labelMedium?.copyWith(color: secondaryTextColor),
            ),
          ],
        );
        final control = Switch(
          value: value,
          thumbColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return Colors.white;
            }
            return primaryTextColor.withValues(alpha: 0.72);
          }),
          trackColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return AirQrTheme.switchSelectedTrack(context);
            }
            return secondaryTextColor.withValues(alpha: 0.22);
          }),
          trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
          onChanged: onChanged,
        );
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: stacked
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    copy,
                    const SizedBox(height: 4),
                    Align(alignment: Alignment.centerRight, child: control),
                  ],
                )
              : Row(
                  children: [
                    Expanded(child: copy),
                    const SizedBox(width: 8),
                    control,
                  ],
                ),
        );
      },
    );
  }
}

class SettingsTextFieldTile extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final String hint;
  final bool obscure;
  final ValueChanged<String>? onChanged;
  final Color primaryTextColor;
  final Color secondaryTextColor;
  final Color fieldBackgroundColor;
  final Color borderColor;
  final Color focusedBorderColor;

  const SettingsTextFieldTile({
    super.key,
    required this.label,
    required this.controller,
    required this.hint,
    required this.primaryTextColor,
    required this.secondaryTextColor,
    required this.fieldBackgroundColor,
    required this.borderColor,
    required this.focusedBorderColor,
    this.obscure = false,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: primaryTextColor,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            obscureText: obscure,
            style: TextStyle(color: primaryTextColor),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: secondaryTextColor),
              filled: true,
              fillColor: fieldBackgroundColor,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: borderColor),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: borderColor),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: focusedBorderColor, width: 1.2),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 12,
              ),
            ),
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}

class SettingsSegmentedControl extends StatelessWidget {
  final List<String> options;
  final String value;
  final ValueChanged<String> onChanged;
  final Color selectedColor;
  final Color backgroundColor;
  final Color unselectedTextColor;
  final Key? indicatorKey;

  const SettingsSegmentedControl({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
    required this.selectedColor,
    required this.backgroundColor,
    required this.unselectedTextColor,
    this.indicatorKey,
  });

  @override
  Widget build(BuildContext context) {
    return AirQrSegmentedControl(
      options: options,
      value: value,
      onChanged: onChanged,
      selectedColor: selectedColor,
      backgroundColor: backgroundColor,
      unselectedTextColor: unselectedTextColor,
      indicatorKey: indicatorKey,
    );
  }
}
