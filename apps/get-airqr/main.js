const recommendations = {
  android: {
    label: "Get it on Google Play",
    href: "https://play.google.com/store/apps/details?id=com.airqr.mobile",
    device: "Android",
  },
  ios: {
    label: "Use AirQR on the web",
    href: "https://airqr-demo.pgnrd.fr/",
    device: "an iPhone or iPad",
  },
  windows: {
    label: "Get it from Microsoft Store",
    href: "https://apps.microsoft.com/detail/9P90L5TKGMD5",
    device: "Windows",
  },
  linux: {
    label: "Download for Debian / Ubuntu",
    href: "https://github.com/Thunzyy/AirQR/releases/download/v1.0/AirQR-linux-x64.deb",
    device: "Linux",
  },
  macos: {
    label: "Use AirQR on the web",
    href: "https://airqr-demo.pgnrd.fr/",
    device: "macOS",
  },
};

function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const touchMac = platform.includes("mac") && navigator.maxTouchPoints > 1;

  if (userAgent.includes("android")) return "android";
  if (touchMac || /iphone|ipad|ipod/.test(userAgent)) return "ios";
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return null;
}

function applyRecommendation() {
  const platform = detectPlatform();
  const recommendation = platform ? recommendations[platform] : null;
  if (!recommendation) return;

  document.querySelectorAll("[data-device-name]").forEach((element) => {
    element.textContent = recommendation.device;
  });

  const heroLink = document.querySelector("[data-recommended-link]");
  if (heroLink) {
    heroLink.textContent = recommendation.label;
    heroLink.href = recommendation.href;
    heroLink.target = "_blank";
    heroLink.rel = "noopener noreferrer";
  }

  const row = document.querySelector(`[data-platform="${platform}"]`);
  row?.classList.add("is-recommended");
}

function bindHeaderState() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const sync = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  sync();
  window.addEventListener("scroll", sync, { passive: true });
}

document.documentElement.classList.add("js");
applyRecommendation();
bindHeaderState();
