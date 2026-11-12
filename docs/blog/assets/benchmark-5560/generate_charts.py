"""Generate charts for the AirQR benchmark-5560 blog post.

Reads ``benchmark-5560.csv`` at the repository root and writes seven PNGs next
to this script. The charts intentionally mirror divan.dev's animated-QR post
(time vs FPS, time vs packet size, time vs ECC, and a Phase 3 deep dive) but
lean on the denser 5,460-run Phase 1 sweep to show the shape of the optimum
instead of a single best point.

Run from the repo root::

    python docs/blog/assets/benchmark-5560/generate_charts.py
"""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib import ticker
from matplotlib.colors import Normalize
from matplotlib.patches import Patch

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
CSV_PATH = REPO_ROOT / "benchmark-5560.csv"

ECC_ORDER = ["LOW", "MEDIUM", "QUARTILE", "HIGH"]
ECC_COLORS = {
    "LOW": "#2a9d8f",
    "MEDIUM": "#4d96ff",
    "QUARTILE": "#f4a261",
    "HIGH": "#e76f51",
}

sns.set_theme(style="whitegrid", context="talk")
plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "axes.titleweight": "bold",
        "axes.titlesize": 16,
        "axes.titlepad": 14,
        "axes.labelsize": 13,
        "axes.labelcolor": "#17324d",
        "xtick.labelsize": 11,
        "ytick.labelsize": 11,
        "xtick.color": "#4d6a85",
        "ytick.color": "#4d6a85",
        "axes.edgecolor": "#c3d0de",
        "axes.linewidth": 1.0,
        "grid.color": "#e2ebf4",
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
        "savefig.bbox": "tight",
        "savefig.dpi": 160,
    }
)


def save(fig: plt.Figure, name: str) -> None:
    out = SCRIPT_DIR / f"{name}.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def load() -> pd.DataFrame:
    df = pd.read_csv(CSV_PATH)
    df = df[df.success == True].copy()  # noqa: E712 — explicit compare for clarity
    df["ecc"] = pd.Categorical(df["ecc"], categories=ECC_ORDER, ordered=True)
    df["transferTimeS"] = df["transferTimeMs"] / 1000.0
    df["gifSizeKB"] = df["gifSizeBytes"] / 1024.0
    return df


def bin_packet_sizes(df: pd.DataFrame, bin_width: int = 200) -> pd.DataFrame:
    # The sweep has 97 distinct packet sizes (400..2800 step 25). Boxplotting
    # each one is unreadable — bucket into 200-byte bins for the plots that
    # don't need the full resolution.
    edges = np.arange(400, 2800 + bin_width + 1, bin_width)
    labels = [f"{int(lo)}-{int(hi - 1)}" for lo, hi in zip(edges[:-1], edges[1:])]
    df = df.copy()
    df["packetBucket"] = pd.cut(
        df["packetSize"], bins=edges, right=False, labels=labels, include_lowest=True
    )
    return df


# -----------------------------------------------------------------------------
# Chart 1 — Phase 1 heatmap: throughput surface across FPS × packet size × ECC
# -----------------------------------------------------------------------------


def chart_phase1_heatmap(df: pd.DataFrame) -> None:
    p1 = df[df.phase == "phase1"]
    p1 = bin_packet_sizes(p1, bin_width=200)

    vmax = p1["throughputKBps"].quantile(0.99)
    vmin = p1["throughputKBps"].quantile(0.02)

    # Reindex every panel against the same bucket / FPS grid so panels line up
    # even though ECC=HIGH/QUARTILE/MEDIUM can't use the larger packet sizes
    # (packets don't fit in the QR once redundancy goes up — that's the point).
    # Sort buckets numerically by their low edge, not lexicographically.
    all_buckets = sorted(
        [c for c in p1["packetBucket"].cat.categories if c in p1["packetBucket"].unique()],
        key=lambda s: int(s.split("-")[0]),
    )
    all_fps = sorted(p1["fps"].unique())

    fig, axes = plt.subplots(
        2, 2, figsize=(15, 12), sharex=True, sharey=True, constrained_layout=True
    )
    axes = axes.ravel()
    cbar_ax = None

    for i, ecc in enumerate(ECC_ORDER):
        ax = axes[i]
        sub = p1[p1.ecc == ecc]
        pivot = (
            sub.groupby(["packetBucket", "fps"], observed=True)["throughputKBps"]
            .median()
            .unstack("fps")
        )
        # Put the largest packet sizes at the top of the heatmap so the axis
        # reads like a standard y-axis (values increasing upward).
        pivot = pivot.reindex(index=list(reversed(all_buckets)), columns=all_fps)
        is_last = i == len(ECC_ORDER) - 1
        hm = sns.heatmap(
            pivot,
            ax=ax,
            cmap="viridis",
            vmin=vmin,
            vmax=vmax,
            cbar=is_last,
            cbar_kws={"label": "Median throughput (KB/s)", "shrink": 0.8}
            if is_last
            else None,
            linewidths=0.3,
            linecolor="white",
        )
        if is_last:
            cbar_ax = hm.collections[0].colorbar
        # Annotate the best cell per panel
        best = sub.groupby(["packetBucket", "fps"], observed=True)[
            "throughputKBps"
        ].median()
        if not best.empty:
            best_key = best.idxmax()
            if best_key in pivot.stack().index:
                # locate row/col in the pivot
                row_idx = list(pivot.index).index(best_key[0])
                col_idx = list(pivot.columns).index(best_key[1])
                ax.add_patch(
                    plt.Rectangle(
                        (col_idx, row_idx),
                        1,
                        1,
                        fill=False,
                        edgecolor="#e63946",
                        lw=2.5,
                    )
                )
                ax.annotate(
                    f"{best.max():.1f} KB/s",
                    xy=(col_idx + 0.5, row_idx + 0.5),
                    ha="center",
                    va="center",
                    color="white",
                    fontsize=10,
                    fontweight="bold",
                )

        ax.set_title(f"ECC = {ecc}")
        ax.set_xlabel("FPS")
        ax.set_ylabel("Packet size (bytes)")

    fig.suptitle(
        "Phase 1 — median throughput across the FPS × packet size × ECC sweep",
        fontsize=18,
        y=1.02,
    )
    fig.text(
        0.5,
        -0.02,
        "Each cell is a bucket of benchmark runs. The red outline marks the best median in each panel. "
        "5,460 successful phase-1 runs, no timeouts on this device pair.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    if cbar_ax is not None:
        cbar_ax.ax.tick_params(labelsize=10)
    save(fig, "phase1-heatmap")


# -----------------------------------------------------------------------------
# Chart 2 — Time vs packet size (divan-style box plot, denser data)
# -----------------------------------------------------------------------------


def chart_phase1_packet_size(df: pd.DataFrame) -> None:
    p1 = df[df.phase == "phase1"]
    p1 = bin_packet_sizes(p1, bin_width=200)

    fig, ax = plt.subplots(figsize=(13, 7))
    order = [c for c in p1["packetBucket"].cat.categories if c in p1["packetBucket"].unique()]
    sns.boxplot(
        data=p1,
        x="packetBucket",
        y="transferTimeS",
        order=order,
        ax=ax,
        hue="packetBucket",
        palette=sns.color_palette("viridis", n_colors=len(order)),
        fliersize=0,
        linewidth=1.2,
        legend=False,
    )
    # Thin scatter overlay — communicates sample density without overwhelming
    sns.stripplot(
        data=p1.sample(n=min(1800, len(p1)), random_state=0),
        x="packetBucket",
        y="transferTimeS",
        order=order,
        ax=ax,
        color="#17324d",
        alpha=0.15,
        size=2.5,
        jitter=0.3,
    )

    # Median line
    medians = p1.groupby("packetBucket", observed=True)["transferTimeS"].median()
    medians = medians.reindex(order)
    ax.plot(
        range(len(order)),
        medians.values,
        marker="o",
        color="#e63946",
        linewidth=1.8,
        zorder=6,
        label="Median",
    )
    ax.set_title("Phase 1 — transfer time by packet size")
    ax.set_xlabel("Packet size bucket (bytes)")
    ax.set_ylabel("Transfer time (s)")
    ax.tick_params(axis="x", rotation=30)
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}s"))
    # Clip the y-axis so the boxes are readable. A few outliers above
    # 12 s exist (autofocus hiccups, mostly) but they compress the IQR
    # bands into one-pixel slices if left on.
    ax.set_ylim(0, min(12.0, float(p1["transferTimeS"].quantile(0.995))))
    ax.legend(loc="upper right", frameon=True, fontsize=11)
    fig.text(
        0.5,
        -0.04,
        f"Denser sweep than divan's txqr: {len(p1):,} measured runs binned into 200 B packet-size buckets. "
        "Lower is better. Each dot is one run, the red line connects medians.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "phase1-packet-size")


# -----------------------------------------------------------------------------
# Chart 3 — Time vs FPS
# -----------------------------------------------------------------------------


def chart_phase1_fps(df: pd.DataFrame) -> None:
    p1 = df[df.phase == "phase1"]
    fps_order = sorted(p1["fps"].unique())

    fig, ax = plt.subplots(figsize=(13, 7))
    sns.boxplot(
        data=p1,
        x="fps",
        y="transferTimeS",
        order=fps_order,
        ax=ax,
        hue="fps",
        palette=sns.color_palette("viridis", n_colors=len(fps_order)),
        fliersize=0,
        linewidth=1.2,
        legend=False,
    )
    sns.stripplot(
        data=p1.sample(n=min(1800, len(p1)), random_state=0),
        x="fps",
        y="transferTimeS",
        order=fps_order,
        ax=ax,
        color="#17324d",
        alpha=0.12,
        size=2.2,
        jitter=0.3,
    )
    medians = p1.groupby("fps")["transferTimeS"].median().reindex(fps_order)
    ax.plot(
        range(len(fps_order)),
        medians.values,
        marker="o",
        color="#e63946",
        linewidth=1.8,
        zorder=6,
        label="Median",
    )
    best_fps = medians.idxmin()
    best_val = medians.min()
    ax.annotate(
        f"Best median: {best_val:.2f}s @ {best_fps} FPS",
        xy=(list(fps_order).index(best_fps), best_val),
        xytext=(list(fps_order).index(best_fps) + 2, best_val - 0.6),
        fontsize=11,
        color="#e63946",
        arrowprops={"arrowstyle": "->", "color": "#e63946", "lw": 1.2},
    )

    ax.set_title("Phase 1 — transfer time by FPS")
    ax.set_xlabel("Frames per second")
    ax.set_ylabel("Transfer time (s)")
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}s"))
    ax.set_ylim(0, min(12.0, float(p1["transferTimeS"].quantile(0.995))))
    ax.legend(loc="upper right", frameon=True, fontsize=11)
    fig.text(
        0.5,
        -0.03,
        "All 5,460 successful phase-1 runs, binned by FPS. Lower is better.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "phase1-fps")


# -----------------------------------------------------------------------------
# Chart 4 — Time vs ECC (violin + box)
# -----------------------------------------------------------------------------


def chart_phase1_ecc(df: pd.DataFrame) -> None:
    p1 = df[df.phase == "phase1"]

    fig, ax = plt.subplots(figsize=(10, 7))
    sns.violinplot(
        data=p1,
        x="ecc",
        y="transferTimeS",
        order=ECC_ORDER,
        ax=ax,
        hue="ecc",
        palette=ECC_COLORS,
        inner=None,
        cut=0,
        linewidth=1.0,
        alpha=0.75,
        legend=False,
    )
    sns.boxplot(
        data=p1,
        x="ecc",
        y="transferTimeS",
        order=ECC_ORDER,
        ax=ax,
        showcaps=True,
        boxprops={"facecolor": "white", "edgecolor": "#17324d", "linewidth": 1.2},
        whiskerprops={"color": "#17324d", "linewidth": 1.2},
        medianprops={"color": "#e63946", "linewidth": 2.0},
        fliersize=0,
        width=0.22,
    )
    medians = p1.groupby("ecc", observed=False)["transferTimeS"].median()
    for i, ecc in enumerate(ECC_ORDER):
        if ecc in medians.index:
            ax.text(
                i,
                medians[ecc],
                f"  {medians[ecc]:.2f}s",
                va="center",
                fontsize=11,
                fontweight="bold",
                color="#17324d",
            )

    ax.set_title("Phase 1 — transfer time by error correction level")
    ax.set_xlabel("ECC level")
    ax.set_ylabel("Transfer time (s)")
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}s"))
    ax.set_ylim(0, 12.0)
    fig.text(
        0.5,
        -0.03,
        "Violin shows the full distribution; inner box shows the IQR with the median in red.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "phase1-ecc")


# -----------------------------------------------------------------------------
# Chart 5 — Phase 3: overhead × compression deep dive
# -----------------------------------------------------------------------------


def chart_phase3(df: pd.DataFrame) -> None:
    p3 = df[df.phase == "phase3"].copy()
    p3["compression"] = p3["compressionEnabled"].map({True: "deflate", False: "raw"})

    fig, ax = plt.subplots(figsize=(12, 6.5))
    sns.barplot(
        data=p3,
        x="raptorqOverhead",
        y="throughputKBps",
        hue="compression",
        order=sorted(p3["raptorqOverhead"].unique()),
        ax=ax,
        palette={"raw": "#2a9d8f", "deflate": "#e76f51"},
        estimator=np.median,
        errorbar=("pi", 50),  # middle 50% (IQR)
        alpha=0.85,
        edgecolor="#17324d",
        linewidth=0.8,
    )
    # Scatter overlay: individual runs
    sns.stripplot(
        data=p3,
        x="raptorqOverhead",
        y="throughputKBps",
        hue="compression",
        order=sorted(p3["raptorqOverhead"].unique()),
        ax=ax,
        palette={"raw": "#17324d", "deflate": "#17324d"},
        dodge=True,
        alpha=0.45,
        size=4,
        legend=False,
    )
    # Best single run annotation
    best = p3.loc[p3["throughputKBps"].idxmax()]
    ax.axhline(best["throughputKBps"], color="#e63946", linewidth=1, linestyle="--", alpha=0.6)
    ax.text(
        len(p3["raptorqOverhead"].unique()) - 0.4,
        best["throughputKBps"] + 0.2,
        f"Best run: {best['throughputKBps']:.2f} KB/s  ·  "
        f"{int(best['fps'])} FPS / {int(best['packetSize'])} B / {best['ecc']} / "
        f"{best['raptorqOverhead']:.2f}x / {best['compression']}",
        color="#e63946",
        fontsize=10,
        ha="right",
        fontweight="bold",
    )
    ax.set_title("Phase 3 — RaptorQ overhead × compression (top finalists)")
    ax.set_xlabel("RaptorQ overhead multiplier")
    ax.set_ylabel("Throughput (KB/s)")
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}"))
    ax.legend(title="Compression", loc="lower right", frameon=True)
    fig.text(
        0.5,
        -0.04,
        f"{len(p3)} phase-3 runs re-tested the five best phase-1 configs with varying overhead and compression. "
        "Bar = median, whiskers = IQR, dots = individual runs. Higher is better.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "phase3-overhead-compression")


# -----------------------------------------------------------------------------
# Chart 6 — Pareto: GIF size vs transfer time
# -----------------------------------------------------------------------------


def chart_pareto(df: pd.DataFrame) -> None:
    sub = df.copy()
    fig, ax = plt.subplots(figsize=(12, 7))

    # Median over (packetSize, ecc) so the scatter isn't 5k points
    agg = sub.groupby(["packetSize", "ecc"], observed=True).agg(
        gifSizeKB=("gifSizeKB", "median"),
        transferTimeS=("transferTimeS", "median"),
        throughput=("throughputKBps", "median"),
    ).reset_index()

    for ecc in ECC_ORDER:
        rows = agg[agg["ecc"] == ecc]
        ax.scatter(
            rows["gifSizeKB"],
            rows["transferTimeS"],
            label=ecc,
            c=ECC_COLORS[ecc],
            s=32,
            alpha=0.75,
            edgecolor="white",
            linewidth=0.6,
        )

    # Pareto front (min transfer time for each gif size bucket)
    sorted_agg = agg.sort_values("gifSizeKB")
    pareto = []
    best_time = float("inf")
    for _, row in sorted_agg.iterrows():
        if row["transferTimeS"] < best_time:
            best_time = row["transferTimeS"]
            pareto.append((row["gifSizeKB"], row["transferTimeS"]))
    if pareto:
        px, py = zip(*pareto)
        ax.plot(
            px,
            py,
            color="#e63946",
            linewidth=2.5,
            marker="D",
            markersize=6,
            label="Pareto front",
            zorder=5,
            markerfacecolor="white",
            markeredgewidth=1.5,
        )

    ax.set_title("GIF size vs transfer time — where each config lands")
    ax.set_xlabel("GIF size (KB, median per config)")
    ax.set_ylabel("Transfer time (s, median per config)")
    ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.0f} KB"))
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}s"))
    ax.legend(title="ECC", loc="upper right", frameon=True)
    ax.set_ylim(bottom=0)
    fig.text(
        0.5,
        -0.03,
        "Each dot is the median of a (packet size × ECC) config over all FPS values. "
        "The red diamond line is the Pareto front: bottom-left is ideal (small GIF, fast transfer).",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "pareto-size-vs-time")


# -----------------------------------------------------------------------------
# Chart 7 — Best-median ridge per FPS, coloured by ECC
# -----------------------------------------------------------------------------


def chart_fps_ridge(df: pd.DataFrame) -> None:
    p1 = df[df.phase == "phase1"].copy()
    # max() picks single-shot outliers (one lucky run hitting 100 KB/s on a
    # 200 ms transfer). Use the 95th percentile of throughput per (fps, ecc)
    # so the ridge reflects what you can reliably reproduce.
    best_per_fps_ecc = (
        p1.groupby(["fps", "ecc"], observed=True)["throughputKBps"]
        .quantile(0.95)
        .reset_index()
    )

    fig, ax = plt.subplots(figsize=(12, 6.5))
    for ecc in ECC_ORDER:
        rows = best_per_fps_ecc[best_per_fps_ecc["ecc"] == ecc].sort_values("fps")
        ax.plot(
            rows["fps"],
            rows["throughputKBps"],
            marker="o",
            markersize=5,
            linewidth=2.0,
            color=ECC_COLORS[ecc],
            label=ecc,
        )

    # Best single point across all
    best = best_per_fps_ecc.loc[best_per_fps_ecc["throughputKBps"].idxmax()]
    ax.scatter(
        [best["fps"]],
        [best["throughputKBps"]],
        s=160,
        facecolor="none",
        edgecolor="#e63946",
        linewidth=2.2,
        zorder=6,
    )
    ax.annotate(
        f"p95 peak: {best['throughputKBps']:.2f} KB/s @ {int(best['fps'])} FPS / {best['ecc']}",
        xy=(best["fps"], best["throughputKBps"]),
        xytext=(best["fps"] + 1.5, best["throughputKBps"] + 0.4),
        fontsize=11,
        color="#e63946",
        fontweight="bold",
        arrowprops={"arrowstyle": "->", "color": "#e63946", "lw": 1.2},
    )

    ax.set_title("Reliable top throughput per FPS (phase 1, 95th percentile per ECC)")
    ax.set_xlabel("Frames per second")
    ax.set_ylabel("Throughput p95 (KB/s)")
    ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, _: f"{v:.1f}"))
    ax.legend(title="ECC", frameon=True)
    fig.text(
        0.5,
        -0.03,
        "Reliable top-end per FPS per ECC (95th percentile over all packet sizes). "
        "Using the raw max would pick up single-run autofocus-hit outliers at 100+ KB/s.",
        ha="center",
        fontsize=11,
        color="#4d6a85",
    )
    save(fig, "fps-best-throughput")


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found: {CSV_PATH}")

    print(f"Loading {CSV_PATH.name}")
    df = load()
    print(f"  {len(df):,} successful runs ({(df.phase == 'phase1').sum()} phase1, "
          f"{(df.phase == 'phase3').sum()} phase3)")

    print("Rendering charts in", SCRIPT_DIR.relative_to(REPO_ROOT))
    chart_phase1_heatmap(df)
    chart_phase1_packet_size(df)
    chart_phase1_fps(df)
    chart_phase1_ecc(df)
    chart_phase3(df)
    chart_pareto(df)
    chart_fps_ridge(df)
    print("Done.")


if __name__ == "__main__":
    main()
