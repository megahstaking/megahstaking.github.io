(async () => {
  "use strict";

  var API_BASE = window.location.origin + "/staking/roi/api/";
  var API_HISTORY = API_BASE + "tvl_api.php?_=" + Date.now();
  var API_LATEST = API_BASE + "tvl_latest.php?_=" + Date.now();
  var API_SAVE = API_BASE + "save_tvl.php?force=1&_=" + Date.now();
  var API_PRICE = API_BASE + "get_megah_price.php?_=" + Date.now();

  var chart = null;
  var lineSeries = null;
  var chartData = [];
  var isChartReady = false;
  var updateInterval = null;
  var isUpdating = false;
  var resizeTimer = null;
  var visibilityObserver = null;
  var isChartInitialized = false;
  var currentPrice = null;

  function isMobile() {
    return window.innerWidth < 768;
  }

  function isModalOpen() {
    return document.body.classList.contains("modal-open");
  }

  function fillMissingData(data) {
    if (data.length === 0) return data;

    var sorted = [...data].sort(function (a, b) {
      return a.time - b.time;
    });
    var filled = [];
    var lastValue = sorted[0].value;
    var lastUsdValue = sorted[0].valueUsd || null;
    var lastTime = sorted[0].time;
    var INTERVAL = 300;

    for (var i = 0; i < sorted.length; i++) {
      var current = sorted[i];

      if (i > 0 && current.time - lastTime > INTERVAL) {
        var gap = current.time - lastTime;
        var steps = Math.ceil(gap / INTERVAL);
        for (var j = 1; j < steps; j++) {
          filled.push({
            time: lastTime + j * INTERVAL,
            value: lastValue,
            valueUsd: lastUsdValue,
            isFilled: true,
          });
        }
      }

      filled.push({
        time: current.time,
        value: current.value,
        valueUsd: current.valueUsd || null,
        isFilled: false,
      });

      lastValue = current.value;
      lastUsdValue = current.valueUsd || null;
      lastTime = current.time;
    }

    return filled;
  }

  function buildLineData(data) {
    return data.map(function (p) {
      var value = p.valueUsd;
      if (!value || value === 0) {
        value = p.value * (currentPrice || 0);
      }
      return {
        time: p.time,
        value: value,
      };
    });
  }

  function buildUrl(base, params) {
    var url = base;
    var first = true;
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        url +=
          (first ? "?" : "&") + key + "=" + encodeURIComponent(params[key]);
        first = false;
      }
    }
    return url;
  }

  async function fetchCurrentPrice() {
    try {
      var url = buildUrl(API_PRICE, { _: Date.now() });
      var response = await fetch(url);
      var data = await response.json();
      if (data.success && data.price && data.price > 0) {
        currentPrice = data.price;
        var priceEl = document.getElementById("tvlMegahPrice");
        if (priceEl) {
          priceEl.textContent = "$" + data.price.toFixed(6);
          priceEl.style.color = "var(--gold)";
        }
        return data.price;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function fetchOnChainData() {
    try {
      var url = buildUrl(API_SAVE, { force: 1, _: Date.now() });
      var response = await fetch(url);
      var result = await response.json();
      if (result.success) {
        var tvlEl = document.getElementById("tvlCurrentValue");
        if (tvlEl && result.tvl !== undefined) {
          var price = await fetchCurrentPrice();
          var tvlUsd = price ? result.tvl * price : null;
          if (price && tvlUsd) {
            tvlEl.textContent =
              "$" + (isMobile() ? tvlUsd.toFixed(0) : tvlUsd.toFixed(2));
          } else {
            tvlEl.textContent = result.tvl.toFixed(4) + " MEGAH";
          }
        }
        return result;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function fetchTVLHistory() {
    try {
      var maxPoints = isMobile() ? 300 : 500;
      var url = buildUrl(API_HISTORY, { _: Date.now() });
      var response = await fetch(url);
      var result = await response.json();

      if (result.success && result.data.length > 0) {
        var price = await fetchCurrentPrice();

        var data = result.data.map(function (item) {
          var tvl = parseFloat(item.tvl);
          var tvlUsd = item.tvl_usd ? parseFloat(item.tvl_usd) : null;

          if (!tvlUsd && price && tvl) {
            tvlUsd = tvl * price;
          }

          return {
            time: Math.floor(new Date(item.timestamp).getTime() / 1000),
            value: tvl,
            valueUsd: tvlUsd,
          };
        });

        data = fillMissingData(data);

        if (data.length > maxPoints) {
          var step = Math.ceil(data.length / maxPoints);
          data = data.filter(function (_, i) {
            return i % step === 0;
          });
        }
        return data;
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async function fetchLatestTVL() {
    try {
      var url = buildUrl(API_LATEST, { _: Date.now() });
      var response = await fetch(url);
      var result = await response.json();
      if (result.success) {
        if (!result.current.price || result.current.price <= 0) {
          var price = await fetchCurrentPrice();
          result.current.price = price;
          if (price && result.current.tvl) {
            result.current.tvl_usd = result.current.tvl * price;
          }
        }
        return {
          tvl: result.current.tvl,
          tvl_usd: result.current.tvl_usd,
          price: result.current.price,
          summary: result.summary,
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function getChartDimensions() {
    var container = document.getElementById("tvlChart");
    if (!container) return { width: 600, height: 220 };

    if (container.offsetParent === null) {
      return { width: 600, height: 220 };
    }

    var rect = container.getBoundingClientRect();
    var parentWidth =
      container.parentElement?.clientWidth || window.innerWidth || 600;

    var width = Math.min(rect.width || parentWidth, parentWidth);
    width = Math.max(width, 100);

    var height = isMobile() ? 180 : 220;
    if (rect.height > 0) {
      height = Math.min(Math.max(rect.height, 100), 400);
    }

    return { width: width, height: height };
  }

  function updateDisplay(data, price) {
    var effectivePrice = price || data?.price || currentPrice || null;

    var el = document.getElementById("tvlCurrentValue");
    var labelEl = document.getElementById("tvlCurrencyLabel");
    var priceEl = document.getElementById("tvlMegahPrice");
    var minMaxEl = document.getElementById("tvlMinMax");
    var pointsEl = document.getElementById("tvlDataPoints");

    if (el && data?.tvl !== undefined && data?.tvl !== null) {
      if (effectivePrice && effectivePrice > 0) {
        var tvlUsd = data.tvl * effectivePrice;
        el.textContent =
          "$" + (isMobile() ? tvlUsd.toFixed(0) : tvlUsd.toFixed(2));
        el.style.color = "var(--green)";

        if (labelEl) {
          labelEl.textContent = "TVL (USD) @ $" + effectivePrice.toFixed(6);
          labelEl.style.color = "var(--green)";
        }
      } else {
        el.textContent = data.tvl.toFixed(4) + " MEGAH";
        el.style.color = "var(--text)";

        if (labelEl) {
          labelEl.textContent = "TVL (MEGAH) - Price unavailable";
          labelEl.style.color = "var(--muted)";
        }
      }
    }

    if (priceEl) {
      if (effectivePrice && effectivePrice > 0) {
        priceEl.textContent = "$" + effectivePrice.toFixed(6);
        priceEl.style.color = "var(--gold)";
      } else {
        priceEl.textContent = "—";
        priceEl.style.color = "var(--muted)";
      }
    }

    if (minMaxEl && data?.summary) {
      var summary = data.summary;

      if (
        summary.min_tvl_usd !== undefined &&
        summary.max_tvl_usd !== undefined &&
        summary.min_tvl_usd !== null &&
        summary.max_tvl_usd !== null &&
        summary.min_tvl_usd > 0 &&
        summary.max_tvl_usd > 0
      ) {
        var min = summary.min_tvl_usd;
        var max = summary.max_tvl_usd;

        if (min < max) {
          minMaxEl.textContent = "$" + min.toFixed(2) + " / $" + max.toFixed(2);
        } else if (min === max) {
          minMaxEl.textContent = "$" + min.toFixed(2) + " (data terkumpul)";
        } else {
          minMaxEl.textContent = "—";
        }
      } else {
        minMaxEl.textContent = "—";
      }
    }

    if (pointsEl && data?.summary) {
      pointsEl.textContent = data.summary.total_points || "—";
    }

    var timeEl = document.getElementById("tvlLastUpdate");
    if (timeEl) {
      var now = new Date();
      var timeStr = now.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: isMobile() ? undefined : "2-digit",
      });
      timeEl.innerHTML = '<i class="fa-regular fa-clock"></i> ' + timeStr;
    }
  }

  function handleResize() {
    if (!chart || !isChartReady) return;
    if (isModalOpen()) return;

    var container = document.getElementById("tvlChart");
    if (!container || container.offsetParent === null) return;

    var dims = getChartDimensions();

    try {
      if (chart && typeof chart.applyOptions === "function") {
        chart.applyOptions({ width: dims.width, height: dims.height });

        setTimeout(function () {
          if (
            chart &&
            typeof chart.timeScale === "function" &&
            !isModalOpen()
          ) {
            fitAllTimeWithPadding();
          }
        }, 100);
      }
    } catch (e) {}
  }

  function fitAllTimeWithPadding() {
    if (!chart || !isChartReady) return;
    if (isModalOpen()) return;

    try {
      chart.timeScale().fitContent();

      var logicalRange = chart.timeScale().getVisibleLogicalRange();
      if (logicalRange) {
        var range = logicalRange.to - logicalRange.from;
        var padding = range * 0.1;
        chart.timeScale().setVisibleLogicalRange({
          from: logicalRange.from - padding,
          to: logicalRange.to + padding,
        });
      }
    } catch (e) {}
  }

  async function autoUpdate() {
    if (!isChartReady || isUpdating) return;
    if (isModalOpen()) return;

    isUpdating = true;
    try {
      var price = await fetchCurrentPrice();
      var latest = await fetchLatestTVL();
      if (!latest || (!latest.tvl && latest.tvl !== 0)) {
        isUpdating = false;
        return;
      }

      updateDisplay(latest, price);

      var now = Math.floor(Date.now() / 1000);
      var lastPoint = chartData[chartData.length - 1];

      var effectivePrice = price || latest.price || currentPrice || 0;
      var tvlUsd = latest.tvl * effectivePrice;

      if (
        !lastPoint ||
        now - lastPoint.time > 300 ||
        Math.abs(latest.tvl - lastPoint.value) > 0.0001
      ) {
        chartData.push({
          time: now,
          value: latest.tvl,
          valueUsd: tvlUsd,
          isFilled: false,
        });

        var maxPoints = isMobile() ? 300 : 500;
        if (chartData.length > maxPoints) {
          var step = Math.ceil(chartData.length / maxPoints);
          chartData = chartData.filter(function (_, i) {
            return i % step === 0;
          });
        }

        var lineData = buildLineData(chartData);
        lineSeries.setData(lineData);

        if (chart && !isModalOpen()) {
        }
      }
    } catch (e) {}
    isUpdating = false;
  }

  function setupVisibilityObserver() {
    var container = document.getElementById("tvlChart");
    if (!container || visibilityObserver) return;

    visibilityObserver = new ResizeObserver(function () {
      if (isModalOpen()) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 200);
    });

    visibilityObserver.observe(container);
  }

  function cleanupVisibilityObserver() {
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
  }

  async function initTVLChart() {
    if (isChartInitialized) return;

    var container = document.getElementById("tvlChart");
    if (!container) {
      setTimeout(initTVLChart, 300);
      return;
    }

    if (container.offsetParent === null) {
      setTimeout(initTVLChart, 500);
      return;
    }

    if (typeof LightweightCharts === "undefined") {
      setTimeout(initTVLChart, 1000);
      return;
    }

    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.overflow = "hidden";
    container.style.position = "relative";

    var parent = container.parentElement;
    if (parent) {
      parent.style.width = "100%";
      parent.style.maxWidth = "100%";
      parent.style.overflow = "hidden";
    }

    await fetchOnChainData();

    var price = await fetchCurrentPrice();
    var history = await fetchTVLHistory();

    if (history.length > 0) {
      chartData = history.map(function (item) {
        return {
          time: item.time,
          value: item.value,
          valueUsd: item.valueUsd || item.value * (price || 0),
          isFilled: item.isFilled || false,
        };
      });
    } else {
      var latest = await fetchLatestTVL();
      if (latest && latest.tvl > 0) {
        var now = Math.floor(Date.now() / 1000);
        var count = isMobile() ? 5 : 10;
        var INTERVAL = 300;
        var tvlUsd = latest.tvl * (price || 0);

        for (var i = 0; i < count; i++) {
          var time = now - (count - i) * INTERVAL;
          chartData.push({
            time: time,
            value: latest.tvl,
            valueUsd: tvlUsd,
            isFilled: false,
          });
        }
        chartData.push({
          time: now,
          value: latest.tvl,
          valueUsd: tvlUsd,
          isFilled: false,
        });
        chartData = fillMissingData(chartData);
      }
    }

    var dims = getChartDimensions();

    chart = LightweightCharts.createChart(container, {
      width: dims.width,
      height: dims.height,
      layout: {
        background: { color: "#0f1220" },
        textColor: "#8892b0",
      },
      grid: {
        vertLines: { color: "rgba(34,197,94,0.05)" },
        horzLines: { color: "rgba(34,197,94,0.05)" },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: "rgba(34,197,94,0.2)",
          style: LightweightCharts.LineStyle.Dashed,
        },
        horzLine: {
          color: "rgba(34,197,94,0.2)",
          style: LightweightCharts.LineStyle.Dashed,
        },
      },
      rightPriceScale: {
        borderColor: "rgba(34,197,94,0.1)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: "rgba(34,197,94,0.1)",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
        tickMarkFormatter: function (time) {
          var date = new Date(time * 1000);
          var now = new Date();
          var diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

          if (isMobile()) {
            return (
              date.getHours() + ":" + String(date.getMinutes()).padStart(2, "0")
            );
          }

          if (diffDays > 7) {
            return date.toLocaleString("id-ID", {
              day: "2-digit",
              month: "short",
            });
          } else if (diffDays > 1) {
            return date.toLocaleString("id-ID", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
          } else {
            return (
              date.getHours() + ":" + String(date.getMinutes()).padStart(2, "0")
            );
          }
        },
      },
      handleScroll: !isMobile(),
      handleScale: !isMobile(),
    });

    lineSeries = chart.addAreaSeries({
      topColor: "rgba(34,197,94,0.4)",
      bottomColor: "rgba(34,197,94,0.02)",
      lineColor: "#22c55e",
      lineWidth: 2,
      priceScaleId: "right",
      priceFormat: {
        type: "price",
        precision: isMobile() ? 0 : 2,
        minMove: isMobile() ? 1 : 0.01,
      },
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    var lineData = buildLineData(chartData);
    lineSeries.setData(lineData);

    setTimeout(function () {
      if (chart && !isModalOpen()) {
        fitAllTimeWithPadding();
      }
    }, 200);

    isChartReady = true;
    isChartInitialized = true;

    var latestData = await fetchLatestTVL();
    if (latestData) {
      updateDisplay(latestData, price);
    }

    setupVisibilityObserver();

    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(autoUpdate, 10000);

    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!isModalOpen()) {
          handleResize();
        }
      }, 250);
    });

    var modalObserver = new MutationObserver(function () {
      if (!isModalOpen()) {
        setTimeout(handleResize, 150);
        setTimeout(autoUpdate, 500);
      }
    });
    modalObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  function destroyChart() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
    cleanupVisibilityObserver();
    if (chart) {
      try {
        chart.remove();
      } catch (e) {}
      chart = null;
    }
    lineSeries = null;
    isChartReady = false;
    isChartInitialized = false;
    chartData = [];
  }

  function reinitChart() {
    destroyChart();
    setTimeout(initTVLChart, 500);
  }

  window.TVLChart = {
    init: initTVLChart,
    destroy: destroyChart,
    reinit: reinitChart,
    resize: handleResize,
    update: autoUpdate,
    isReady: function () {
      return isChartReady;
    },
    forceUpdate: async function () {
      await fetchOnChainData();
      await autoUpdate();
      return "Updated";
    },
    getPrice: function () {
      return currentPrice;
    },
    refreshPrice: fetchCurrentPrice,
  };

  var TVLUpdateManager = {
    intervalId: null,
    isUpdating: false,

    forceUpdate: async function () {
      if (this.isUpdating) return;

      this.isUpdating = true;
      var el = document.getElementById("tvlCurrentValue");

      try {
        if (el) {
          el.style.transition = "opacity 0.3s";
          el.style.opacity = "0.3";
          el.textContent = "⟳ Updating...";
        }

        await TVLChart.forceUpdate();

        var statusEl = document.getElementById("tvlRefreshStatus");
        if (statusEl) {
          var now = new Date();
          statusEl.textContent = "✅ Updated: " + now.toLocaleTimeString();
          statusEl.style.color = "var(--green)";
        }
      } catch (e) {
        if (el) {
          el.textContent = "⚠️ Update failed";
          el.style.color = "var(--red)";
        }
      } finally {
        if (el) {
          el.style.opacity = "1";
        }
        this.isUpdating = false;
      }
    },

    startAutoUpdate: function (interval) {
      interval = interval || 30000;
      this.stopAutoUpdate();
      this.intervalId = setInterval(function () {
        TVLUpdateManager.forceUpdate();
      }, interval);
    },

    stopAutoUpdate: function () {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    },

    toggleAutoUpdate: function () {
      if (this.intervalId) {
        this.stopAutoUpdate();
        return false;
      } else {
        this.startAutoUpdate();
        return true;
      }
    },
  };

  window.TVLUpdateManager = TVLUpdateManager;

  function startChart() {
    if (typeof LightweightCharts !== "undefined") {
      initTVLChart();
      setTimeout(function () {
        TVLUpdateManager.startAutoUpdate(30000);
      }, 2000);
    } else {
      setTimeout(startChart, 500);
    }
  }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(startChart, 800);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(startChart, 800);
    });
  }

  window.handleChartAfterModalClose = function () {
    setTimeout(function () {
      if (!isModalOpen() && isChartReady) {
        handleResize();
        setTimeout(autoUpdate, 500);
      }
    }, 200);
  };

  var originalCloseNotify = window.closeNotify || function () {};
  window.closeNotify = function () {
    originalCloseNotify();
    setTimeout(function () {
      if (!isModalOpen() && isChartReady) {
        handleResize();
      }
    }, 150);
  };
})();
