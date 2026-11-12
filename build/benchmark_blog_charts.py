from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Iterable
from xml.sax.saxutils import escape


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    ratio = position - lower
    return ordered[lower] * (1.0 - ratio) + ordered[upper] * ratio


def boxplot_stats(values: Iterable[float]) -> dict[str, float]:
    ordered = sorted(float(value) for value in values)
    q1 = percentile(ordered, 0.25)
    q2 = percentile(ordered, 0.50)
    q3 = percentile(ordered, 0.75)
    iqr = q3 - q1
    low_limit = q1 - (1.5 * iqr)
    high_limit = q3 + (1.5 * iqr)
    low = next((value for value in ordered if value >= low_limit), ordered[0])
    high = next((value for value in reversed(ordered) if value <= high_limit), ordered[-1])
    return {"q1": q1, "median": q2, "q3": q3, "low": low, "high": high}


def format_seconds(value: float) -> str:
    return f"{value:.1f}s"


def format_kbps(value: float) -> str:
    return f"{value:.1f} KB/s"


def color_lerp(a: tuple[int, int, int], b: tuple[int, int, int], ratio: float) -> str:
    ratio = max(0.0, min(1.0, ratio))
    red = round(a[0] + (b[0] - a[0]) * ratio)
    green = round(a[1] + (b[1] - a[1]) * ratio)
    blue = round(a[2] + (b[2] - a[2]) * ratio)
    return f"#{red:02x}{green:02x}{blue:02x}"


def sequential_color(value: float, minimum: float, maximum: float) -> str:
    stops = [
        (0.0, (238, 246, 255)),
        (0.35, (126, 203, 195)),
        (0.70, (30, 136, 168)),
        (1.0, (2, 48, 71)),
    ]
    if maximum <= minimum:
        return "#7ecbc3"
    clamped = max(minimum, min(maximum, value))
    ratio = (clamped - minimum) / (maximum - minimum)
    for index in range(len(stops) - 1):
        left_stop, left_color = stops[index]
        right_stop, right_color = stops[index + 1]
        if ratio <= right_stop:
            local_ratio = (ratio - left_stop) / (right_stop - left_stop or 1)
            return color_lerp(left_color, right_color, local_ratio)
    return color_lerp(stops[-2][1], stops[-1][1], 1.0)


def svg_root(width: int, height: int, body: list[str]) -> str:
    styles = """
    <style>
      text { font-family: 'Segoe UI', Arial, sans-serif; fill: #17324d; }
      .title { font-size: 28px; font-weight: 700; }
      .subtitle { font-size: 14px; fill: #4d6a85; }
      .axis { stroke: #8aa1b8; stroke-width: 1; }
      .grid { stroke: #d8e4ef; stroke-width: 1; }
      .label { font-size: 12px; fill: #4d6a85; }
      .small { font-size: 11px; fill: #6f889f; }
      .panel-title { font-size: 16px; font-weight: 700; }
      .caption { font-size: 13px; fill: #33516c; }
    </style>
    """
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">'
        f'<title id="title">AirQR benchmark chart</title>'
        f'<desc id="desc">Generated from benchmark CSV data.</desc>'
        f'<rect width="{width}" height="{height}" fill="#f7fbff"/>'
        f"{styles}{''.join(body)}</svg>"
    )


def write_svg(path: Path, svg: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")


def draw_heatmap(rows: list[dict[str, str]], output_path: Path) -> None:
    phase1 = [row for row in rows if row["phase"] == "phase1"]
    ecc_levels = ["LOW", "MEDIUM", "QUARTILE", "HIGH"]
    packet_sizes = sorted({int(row["packetSize"]) for row in phase1})
    fps_values = sorted({int(row["fps"]) for row in phase1})
    values = [float(row["throughputKBps"]) for row in phase1]
    legend_min = percentile(values, 0.05)
    legend_max = percentile(values, 0.99)

    width = 1560
    height = 1060
    body = [
        '<text class="title" x="60" y="58">Phase 1 throughput surface by FPS, packet size, and ECC</text>',
        '<text class="subtitle" x="60" y="86">Each cell is one measured run from benchmark-5560.csv. Colors are clipped at the 99th percentile so rare spikes do not flatten the rest of the map.</text>',
    ]

    panel_width = 620
    panel_height = 350
    panel_origins = [
        (60, 130),
        (760, 130),
        (60, 560),
        (760, 560),
    ]
    inner_margin_left = 68
    inner_margin_bottom = 42
    inner_margin_top = 28
    inner_margin_right = 16

    cell_width = (panel_width - inner_margin_left - inner_margin_right) / len(packet_sizes)
    cell_height = (panel_height - inner_margin_top - inner_margin_bottom) / len(fps_values)

    for index, ecc in enumerate(ecc_levels):
        panel_x, panel_y = panel_origins[index]
        chart_x = panel_x + inner_margin_left
        chart_y = panel_y + inner_margin_top
        chart_width = panel_width - inner_margin_left - inner_margin_right
        chart_height = panel_height - inner_margin_top - inner_margin_bottom
        body.append(
            f'<rect x="{panel_x}" y="{panel_y}" width="{panel_width}" height="{panel_height}" rx="16" fill="#ffffff" stroke="#d7e4ef"/>'
        )
        body.append(f'<text class="panel-title" x="{panel_x + 20}" y="{panel_y + 24}">{escape(ecc)}</text>')

        lookup = {
            (int(row["packetSize"]), int(row["fps"])): float(row["throughputKBps"])
            for row in phase1
            if row["ecc"] == ecc
        }

        for fps_index, fps in enumerate(fps_values):
            y = chart_y + (len(fps_values) - fps_index - 1) * cell_height
            if fps % 2 == 0:
                body.append(f'<line class="grid" x1="{chart_x}" y1="{y}" x2="{chart_x + chart_width}" y2="{y}"/>')
                body.append(f'<text class="label" x="{panel_x + 10}" y="{y + 4}">{fps}</text>')
        for packet_index, packet_size in enumerate(packet_sizes):
            x = chart_x + packet_index * cell_width
            if packet_size % 200 == 0:
                body.append(f'<line class="grid" x1="{x}" y1="{chart_y}" x2="{x}" y2="{chart_y + chart_height}"/>')
                body.append(
                    f'<text class="label" x="{x}" y="{panel_y + panel_height - 10}" transform="rotate(60 {x} {panel_y + panel_height - 10})">{packet_size}</text>'
                )

            for fps_index, fps in enumerate(fps_values):
                y = chart_y + (len(fps_values) - fps_index - 1) * cell_height
                value = lookup.get((packet_size, fps))
                if value is None:
                    continue
                fill = sequential_color(value, legend_min, legend_max)
                body.append(
                    f'<rect x="{x:.2f}" y="{y:.2f}" width="{cell_width + 0.4:.2f}" height="{cell_height + 0.4:.2f}" fill="{fill}" stroke="none"/>'
                )

        body.append(f'<line class="axis" x1="{chart_x}" y1="{chart_y + chart_height}" x2="{chart_x + chart_width}" y2="{chart_y + chart_height}"/>')
        body.append(f'<line class="axis" x1="{chart_x}" y1="{chart_y}" x2="{chart_x}" y2="{chart_y + chart_height}"/>')
        body.append(f'<text class="label" x="{panel_x + panel_width / 2 - 45}" y="{panel_y + panel_height - 8}">Packet size (bytes)</text>')
        body.append(
            f'<text class="label" x="{panel_x + 16}" y="{panel_y + panel_height / 2}" transform="rotate(-90 {panel_x + 16} {panel_y + panel_height / 2})">FPS</text>'
        )

    legend_x = 1420
    legend_y = 210
    legend_height = 560
    steps = 120
    for step in range(steps):
        ratio = step / (steps - 1)
        value = legend_max - (legend_max - legend_min) * ratio
        fill = sequential_color(value, legend_min, legend_max)
        y = legend_y + ratio * legend_height
        body.append(f'<rect x="{legend_x}" y="{y:.2f}" width="26" height="{legend_height / steps + 1:.2f}" fill="{fill}" stroke="none"/>')
    body.append(f'<rect x="{legend_x}" y="{legend_y}" width="26" height="{legend_height}" fill="none" stroke="#bfd0df"/>')
    body.append(f'<text class="panel-title" x="{legend_x - 4}" y="{legend_y - 16}">Throughput</text>')
    for ratio, label in [(0.0, legend_max), (0.25, legend_min + 0.75 * (legend_max - legend_min)), (0.5, legend_min + 0.5 * (legend_max - legend_min)), (0.75, legend_min + 0.25 * (legend_max - legend_min)), (1.0, legend_min)]:
        y = legend_y + ratio * legend_height + 4
        body.append(f'<text class="label" x="{legend_x + 36}" y="{y:.2f}">{format_kbps(label)}</text>')

    write_svg(output_path, svg_root(width, height, body))


def draw_boxplot_chart(
    title: str,
    subtitle: str,
    groups: list[tuple[str, list[float], str]],
    output_path: Path,
    y_label: str,
    tick_step: int = 1,
) -> None:
    width = max(1100, 140 + len(groups) * 18)
    height = 760
    margin_left = 84
    margin_right = 32
    margin_top = 120
    margin_bottom = 110
    chart_width = width - margin_left - margin_right
    chart_height = height - margin_top - margin_bottom

    stats = [boxplot_stats(values) for _, values, _ in groups]
    all_values = [float(value) for _, values, _ in groups for value in values]
    y_min = 0.0
    y_max = percentile(all_values, 0.98)
    y_max = max(y_max, max(stat["high"] for stat in stats))
    y_max = math.ceil(y_max * 10) / 10

    def y_scale(value: float) -> float:
        if y_max <= y_min:
            return margin_top + chart_height
        return margin_top + chart_height - ((value - y_min) / (y_max - y_min) * chart_height)

    body = [
        f'<text class="title" x="60" y="58">{escape(title)}</text>',
        f'<text class="subtitle" x="60" y="86">{escape(subtitle)}</text>',
    ]

    for step in range(0, int(y_max * 10) + 1, 10):
        value = step / 10
        y = y_scale(value)
        body.append(f'<line class="grid" x1="{margin_left}" y1="{y:.2f}" x2="{margin_left + chart_width}" y2="{y:.2f}"/>')
        body.append(f'<text class="label" x="22" y="{y + 4:.2f}">{format_seconds(value)}</text>')

    body.append(f'<line class="axis" x1="{margin_left}" y1="{margin_top}" x2="{margin_left}" y2="{margin_top + chart_height}"/>')
    body.append(f'<line class="axis" x1="{margin_left}" y1="{margin_top + chart_height}" x2="{margin_left + chart_width}" y2="{margin_top + chart_height}"/>')
    body.append(
        f'<text class="label" x="18" y="{margin_top + chart_height / 2}" transform="rotate(-90 18 {margin_top + chart_height / 2})">{escape(y_label)}</text>'
    )

    step_x = chart_width / len(groups)
    box_width = max(8, step_x * 0.58)

    for index, ((label, _, color), stat) in enumerate(zip(groups, stats)):
        center = margin_left + (index + 0.5) * step_x
        box_left = center - box_width / 2
        q1_y = y_scale(stat["q1"])
        q3_y = y_scale(stat["q3"])
        median_y = y_scale(stat["median"])
        low_y = y_scale(stat["low"])
        high_y = y_scale(stat["high"])
        body.append(f'<line x1="{center:.2f}" y1="{high_y:.2f}" x2="{center:.2f}" y2="{q3_y:.2f}" stroke="#55708a" stroke-width="1.5"/>')
        body.append(f'<line x1="{center:.2f}" y1="{q1_y:.2f}" x2="{center:.2f}" y2="{low_y:.2f}" stroke="#55708a" stroke-width="1.5"/>')
        body.append(f'<line x1="{center - 5:.2f}" y1="{high_y:.2f}" x2="{center + 5:.2f}" y2="{high_y:.2f}" stroke="#55708a" stroke-width="1.5"/>')
        body.append(f'<line x1="{center - 5:.2f}" y1="{low_y:.2f}" x2="{center + 5:.2f}" y2="{low_y:.2f}" stroke="#55708a" stroke-width="1.5"/>')
        body.append(
            f'<rect x="{box_left:.2f}" y="{q3_y:.2f}" width="{box_width:.2f}" height="{max(1.5, q1_y - q3_y):.2f}" rx="4" fill="{color}" fill-opacity="0.82" stroke="#3d5a73"/>'
        )
        body.append(f'<line x1="{box_left:.2f}" y1="{median_y:.2f}" x2="{box_left + box_width:.2f}" y2="{median_y:.2f}" stroke="#0b2438" stroke-width="2"/>')

        if tick_step == 1 or index % tick_step == 0:
            label_y = margin_top + chart_height + 18
            body.append(
                f'<text class="small" x="{center:.2f}" y="{label_y}" text-anchor="middle" transform="rotate(60 {center:.2f} {label_y})">{escape(label)}</text>'
            )

    write_svg(output_path, svg_root(width, height, body))


def draw_phase3_chart(rows: list[dict[str, str]], output_path: Path) -> None:
    phase3 = [row for row in rows if row["phase"] == "phase3"]
    width = 1180
    height = 760
    margin_left = 84
    margin_right = 36
    margin_top = 120
    margin_bottom = 120
    chart_width = width - margin_left - margin_right
    chart_height = height - margin_top - margin_bottom

    grouped: dict[tuple[str, str], list[float]] = defaultdict(list)
    for row in phase3:
        grouped[(row["raptorqOverhead"], row["compressionEnabled"])].append(float(row["throughputKBps"]))

    overheads = sorted({row["raptorqOverhead"] for row in phase3}, key=float)
    bar_width = 36
    pair_width = 94
    gap = 34
    max_value = max(percentile(values, 0.75) for values in grouped.values())
    max_value = max(max_value, max(median(values) for values in grouped.values()))
    max_value = math.ceil(max_value * 10) / 10

    def y_scale(value: float) -> float:
        return margin_top + chart_height - ((value / max_value) * chart_height)

    raw_color = "#1f7a8c"
    comp_color = "#ffb703"

    body = [
        '<text class="title" x="60" y="58">Phase 3 follow-up: overhead and compression on the finalists</text>',
        '<text class="subtitle" x="60" y="86">Bars show median throughput across the five winning phase-1 configs. Thin whiskers show the interquartile range.</text>',
    ]

    for step in range(0, int(max_value * 10) + 1, 10):
        value = step / 10
        y = y_scale(value)
        body.append(f'<line class="grid" x1="{margin_left}" y1="{y:.2f}" x2="{margin_left + chart_width}" y2="{y:.2f}"/>')
        body.append(f'<text class="label" x="22" y="{y + 4:.2f}">{format_kbps(value)}</text>')

    body.append(f'<line class="axis" x1="{margin_left}" y1="{margin_top}" x2="{margin_left}" y2="{margin_top + chart_height}"/>')
    body.append(f'<line class="axis" x1="{margin_left}" y1="{margin_top + chart_height}" x2="{margin_left + chart_width}" y2="{margin_top + chart_height}"/>')

    total_width = len(overheads) * pair_width + (len(overheads) - 1) * gap
    start_x = margin_left + (chart_width - total_width) / 2

    for index, overhead in enumerate(overheads):
        pair_left = start_x + index * (pair_width + gap)
        for bar_index, compression in enumerate(["false", "true"]):
            values = grouped[(overhead, compression)]
            q1 = percentile(values, 0.25)
            q3 = percentile(values, 0.75)
            med = percentile(values, 0.50)
            center = pair_left + (bar_index * (bar_width + 14)) + bar_width / 2
            top_y = y_scale(med)
            q1_y = y_scale(q1)
            q3_y = y_scale(q3)
            color = raw_color if compression == "false" else comp_color
            body.append(
                f'<rect x="{center - bar_width / 2:.2f}" y="{top_y:.2f}" width="{bar_width}" height="{margin_top + chart_height - top_y:.2f}" rx="6" fill="{color}" fill-opacity="0.88"/>'
            )
            body.append(f'<line x1="{center:.2f}" y1="{q3_y:.2f}" x2="{center:.2f}" y2="{q1_y:.2f}" stroke="#17324d" stroke-width="2"/>')
            body.append(f'<line x1="{center - 8:.2f}" y1="{q3_y:.2f}" x2="{center + 8:.2f}" y2="{q3_y:.2f}" stroke="#17324d" stroke-width="2"/>')
            body.append(f'<line x1="{center - 8:.2f}" y1="{q1_y:.2f}" x2="{center + 8:.2f}" y2="{q1_y:.2f}" stroke="#17324d" stroke-width="2"/>')
            body.append(f'<text class="small" x="{center:.2f}" y="{top_y - 8:.2f}" text-anchor="middle">{med:.2f}</text>')
            body.append(f'<text class="small" x="{center:.2f}" y="{margin_top + chart_height + 20:.2f}" text-anchor="middle">{"raw" if compression == "false" else "deflate"}</text>')
        body.append(f'<text class="label" x="{pair_left + pair_width / 2:.2f}" y="{margin_top + chart_height + 50:.2f}" text-anchor="middle">{overhead}x</text>')

    body.append(f'<rect x="836" y="124" width="18" height="18" rx="4" fill="{raw_color}" fill-opacity="0.88"/>')
    body.append('<text class="label" x="864" y="138">raw</text>')
    body.append(f'<rect x="920" y="124" width="18" height="18" rx="4" fill="{comp_color}" fill-opacity="0.88"/>')
    body.append('<text class="label" x="948" y="138">deflate</text>')

    write_svg(output_path, svg_root(width, height, body))


def generate(csv_path: Path, output_dir: Path) -> None:
    rows = list(csv.DictReader(csv_path.open(newline="", encoding="utf-8")))
    phase1 = [row for row in rows if row["phase"] == "phase1"]

    packet_groups = []
    for packet_size in sorted({int(row["packetSize"]) for row in phase1}):
        values = [float(row["transferTimeMs"]) / 1000.0 for row in phase1 if int(row["packetSize"]) == packet_size]
        packet_groups.append((str(packet_size), values, "#8ecae6"))

    fps_groups = []
    for fps in sorted({int(row["fps"]) for row in phase1}):
        values = [float(row["transferTimeMs"]) / 1000.0 for row in phase1 if int(row["fps"]) == fps]
        fps_groups.append((str(fps), values, "#ffb703"))

    ecc_colors = {
        "LOW": "#2a9d8f",
        "MEDIUM": "#4d96ff",
        "QUARTILE": "#f4a261",
        "HIGH": "#e76f51",
    }
    ecc_groups = []
    for ecc in ["LOW", "MEDIUM", "QUARTILE", "HIGH"]:
        values = [float(row["transferTimeMs"]) / 1000.0 for row in phase1 if row["ecc"] == ecc]
        ecc_groups.append((ecc, values, ecc_colors[ecc]))

    draw_heatmap(rows, output_dir / "phase1-heatmap.svg")
    draw_boxplot_chart(
        "Phase 1 transfer time vs packet size",
        "This is the closest equivalent to divan's chunk-size boxplots, but based on the denser AirQR sweep.",
        packet_groups,
        output_dir / "phase1-packet-size-boxplot.svg",
        y_label="Transfer time",
        tick_step=4,
    )
    draw_boxplot_chart(
        "Phase 1 transfer time vs FPS",
        "The fastest band is in the mid-teens. Very low and very high frame rates both widen the spread.",
        fps_groups,
        output_dir / "phase1-fps-boxplot.svg",
        y_label="Transfer time",
        tick_step=1,
    )
    draw_boxplot_chart(
        "Phase 1 transfer time vs ECC level",
        "Lower redundancy consistently wins on this device pair. High ECC is safer, but measurably slower.",
        ecc_groups,
        output_dir / "phase1-ecc-boxplot.svg",
        y_label="Transfer time",
        tick_step=1,
    )
    draw_phase3_chart(rows, output_dir / "phase3-overhead-compression.svg")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate SVG benchmark charts for the AirQR blog posts.")
    parser.add_argument("csv_path", type=Path, help="Path to the exported benchmark CSV.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directory where the SVG charts will be written. Defaults to docs/blog/assets/<csv-stem>/",
    )
    args = parser.parse_args()

    output_dir = args.output_dir or Path("docs/blog/assets") / args.csv_path.stem
    generate(args.csv_path, output_dir)
    print(f"Wrote charts to {output_dir}")


if __name__ == "__main__":
    main()
