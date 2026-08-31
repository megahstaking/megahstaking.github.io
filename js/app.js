(() => {
  "use strict";

  const CONFIG = {
    chainId: 56,
    chainHex: "0x38",
    chainName: "BNB Smart Chain",
    nativeSymbol: "BNB",
    explorer: "https://bscscan.com/",
    stakingContractAddress: "0x553cb00408fb127b30df5edac684f52e1a77f71f",
    stakingContract: "0x553cb00408fb127b30df5edac684f52e1a77f71f",
    expectedToken: "0xc55d416476CFC6e879948eD5a5F4461c43Af45Aa",
    expectedSymbol: "MEGAH",
    pollingInterval: 15000,
    refreshInterval: 30000,
    cacheTTL: 5000,
    maxRetries: 3,
    retryDelay: 1000,
    rpcList: [
      "https://bsc-dataseed1.binance.org/",
      "https://bsc-dataseed2.binance.org/",
      "https://bsc-dataseed3.binance.org/",
      "https://bsc-dataseed4.binance.org/",
      "https://bsc-dataseed1.defibit.io/",
      "https://bsc-dataseed2.defibit.io/",
      "https://bsc-rpc.publicnode.com/",
    ],
  };

  const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ];

  const GT_ABI = [
    "function owner() view returns (address)",
    "function stakingToken() view returns (address)",
    "function minStake() view returns (uint256)",
    "function leaderBonusBps() view returns (uint256)",
    "function dailyRoiBps() view returns (uint256)",
    "function referralBonusLevels(uint256) view returns (uint256)",
    "function getReferralLevels() view returns (uint256[])",
    "function MAX_REFERRAL_LEVELS() view returns (uint256)",
    "function MAX_DIRECT_DOWNLINES() view returns (uint256)",
    "function MAX_BPS() view returns (uint256)",
    "function ADMIN_LEFTOVER_WALLET() view returns (address)",
    "function referralDepth(address) view returns (uint256)",
    "function userStakes(address) view returns (uint256 stakedAmount, uint256 maxCap, uint256 totalEarned, uint256 savedReward, uint256 lastClaimTime, uint256 pendingReferralBonus, uint256 totalRoiClaimed, uint256 referralClaimCount)",
    "function userReferrers(address) view returns (address)",
    "function isLeader(address) view returns (bool)",
    "function pendingReward(address) view returns (uint256)",
    "function isMaxCapReached(address) view returns (bool)",
    "function getStakeInfo(address) view returns (uint256 stakedAmount, uint256 maxCap, uint256 totalEarned, uint256 currentPendingReward, uint256 pendingReferralBonus)",
    "function getStakeInfoExtended(address) view returns (uint256 stakedAmount, uint256 maxCap, uint256 totalEarned, uint256 currentPendingReward, uint256 pendingReferralBonus, uint256 totalRoiClaimed, uint256 lastClaimTime, address referrer, uint256 networkDepth, uint256 referralClaimCount)",
    "function getDirectDownlineCount(address) view returns (uint256)",
    "function getDirectDownlines(address) view returns (address[])",
    "function getDirectDownlinesPaginated(address,uint256,uint256) view returns (address[] result,uint256 total)",
    "function getDirectDownlineInfo(address,uint256,uint256) view returns (tuple(address wallet,uint256 stakedAmount,uint256 maxCap,uint256 totalEarned,uint256 pendingRoi,uint256 pendingReferralBonus,uint256 totalRoiClaimed,uint256 referralEarned,uint256 referralRewardCount,bool maxCapReached)[] result,uint256 total)",
    "function getReferralStats(address,address) view returns (uint256 totalEarned,uint256 rewardCount)",
    "function getReferralEarnedByLevel(address,address) view returns (uint256[10])",
    "function getNetworkSummary(address) view returns (uint256 directCount,uint256 stakedAmount,uint256 totalEarned,uint256 totalRoiClaimed,uint256 pendingRoi,uint256 pendingReferralBonus,uint256 networkDepth,bool maxCapReached)",
    "function stake(uint256 _amount, address _referrer)",
    "function claimRoi()",
    "function claimReferralBonus()",
    "function adminStake(address _user, uint256 _amount, address _referrer)",
    "function setLeader(address _wallet, bool _status)",
    "function updateLeaderBonusBps(uint256 _bps)",
    "function updateDailyRoiBps(uint256 _bps)",
    "function updateReferralLevels(uint256[] calldata _levels)",
    "function updateMinStake(uint256 _minStake)",
    "function recoverERC20(address _tokenAddress, uint256 _tokenAmount)",
    "function renounceOwnership()",
    "function transferOwnership(address newOwner)",
  ];

  let browserProvider = null;
  let signer = null;
  let readProvider = null;
  let gt = null;
  let token = null;
  let readToken = null;
  let account = null;
  let tokenDecimals = 18;
  let tokenSymbol = "MEGAH";
  let refreshTimer = null;
  let liveTimer = null;
  let downlineOffset = 0;
  const DOWNLINE_PAGE_SIZE = 10;
  const NETWORK_PAGE_SIZE = 15;
  const MAX_NETWORK_NODES = 500;
  let referralNetwork = [];
  let referralLevelEarnings = Array.from({ length: 10 }, () => 0n);
  let referralNetworkTotals = Array.from({ length: 10 }, () => 0);
  let referralNetworkTruncated = false;
  let networkRefreshInFlight = false;
  let networkLoadedAccount = "";
  let networkLoadedGeneration = 0;
  let heartbeatTimer = null;
  let blockListener = null;
  let connectionGeneration = 0;
  let isPolling = false;
  let isProcessing = false;
  let transactionNonce = 0;
  let currentRpcIndex = 0;

  const cache = {};
  const cached = {
    total: 0n,
    cap: 0n,
    claimed: 0n,
    pending: 0n,
    referral: 0n,
    lastClaim: 0n,
    dailyBps: 0n,
    leaderBps: 0n,
    minStake: 0n,
    levels: [],
  };

  const $ = (id) => document.getElementById(id);

  function validAddress(v) {
    return /^0x[0-9a-fA-F]{40}$/.test(String(v || "").trim());
  }

  function short(a) {
    return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—";
  }

  function fmt(v, max = 8) {
    try {
      const s = ethers.formatUnits(v, tokenDecimals);
      if (!s.includes(".")) return s;
      const parts = s.split(".");
      const decimal = parts[1].slice(0, max).replace(/0+$/, "");
      if (decimal === "" || decimal === "00000000") {
        return parts[0] + ".0000";
      }
      return decimal ? `${parts[0]}.${decimal}` : parts[0];
    } catch {
      return "0";
    }
  }

  function fmtBps(b) {
    return `${Number(b) / 100}%`;
  }

  function fmtNative(v) {
    try {
      const s = ethers.formatEther(v);
      if (!s.includes(".")) return s;
      const p = s.split(".");
      return p[0] + "." + p[1].slice(0, 6).replace(/0+$/, "");
    } catch {
      return "0";
    }
  }

  function formatTimestamp(ts) {
    try {
      const n = Number(ts);
      if (!n) return "—";
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date(n * 1000));
    } catch {
      return "—";
    }
  }

  function configured() {
    return validAddress(CONFIG.stakingContract);
  }

  function getCached(key) {
    if (cache[key] && Date.now() - cache[key].timestamp < CONFIG.cacheTTL) {
      return cache[key].data;
    }
    return null;
  }

  function setCached(key, data) {
    cache[key] = { data, timestamp: Date.now() };
  }

  function clearCache(key) {
    if (key) {
      delete cache[key];
    } else {
      Object.keys(cache).forEach((k) => delete cache[k]);
    }
  }

  function validateAmountInput(value) {
    const cleaned = value.replace(/,/g, ".");
    if (!/^\d*\.?\d*$/.test(cleaned)) {
      return {
        valid: false,
        message: "Only numbers and decimals are allowed.",
      };
    }
    const num = parseFloat(cleaned);
    if (isNaN(num) || num <= 0) {
      return {
        valid: false,
        message: "Please enter a valid amount (greater than 0).",
      };
    }
    return { valid: true, value: cleaned, num };
  }

  function cleanError(e) {
    if (!e) return "An unknown error occurred.";
    if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) {
      return "Transaction was rejected in your wallet.";
    }
    if (/insufficient funds/i.test(e.message || "")) {
      return "Insufficient BNB for gas or MEGAH balance.";
    }
    if (
      /transfer amount exceeds balance|exceeds allowance|insufficient balance/i.test(
        e.message || "",
      )
    ) {
      return "Insufficient MEGAH balance for this transaction.";
    }
    if (
      /allowance insufficient|insufficient allowance/i.test(e.message || "")
    ) {
      return "Insufficient MEGAH allowance. Please approve first.";
    }
    if (/below minimum|min stake/i.test(e.message || "")) {
      return "Stake amount is below the minimum required by the contract.";
    }
    if (/max cap|maximum cap|cap reached/i.test(e.message || "")) {
      return "You have reached the Maximum Cap. Cannot stake or claim further.";
    }
    if (/network|timeout|ETIMEDOUT|connection|fetch/i.test(e.message || "")) {
      return "Network connection issue. Please check your internet and try again.";
    }
    const msg = e.shortMessage || e.reason || e.message || String(e);
    return msg.replace(/^execution reverted:\s*/i, "").slice(0, 400);
  }

  let notifyTimer = null;
  let notifyActionHandler = null;
  let notifyLocked = false;
  let notifyPreviousFocus = null;

  function notify(
    message,
    type = "info",
    title = "Notification",
    duration = 4500,
    actionText = null,
    actionHandler = null,
    locked = false,
    details = null,
  ) {
    const overlay = $("notifyOverlay");
    const box = $("notifyBox");
    const icon = $("notifyIcon");
    const action = $("notifyAction");
    const close = $("notifyClose");
    const detailsEl = $("notifyDetails");
    if (!overlay || !box) return;

    if (!overlay.classList.contains("show")) {
      const active = document.activeElement;
      notifyPreviousFocus = active && active !== document.body ? active : null;
    }

    notifyActionHandler =
      typeof actionHandler === "function" ? actionHandler : null;
    notifyLocked = !!locked;
    $("notifyTitle").textContent = title;
    $("notifyMessage").textContent = message || "";
    box.className = `notify-box ${type}${locked ? " processing" : ""}`;

    if (locked) {
      icon.innerHTML =
        '<span class="notify-spinner" aria-hidden="true"></span>';
    } else {
      icon.textContent =
        type === "ok"
          ? "✓"
          : type === "error"
            ? "✕"
            : type === "warn"
              ? "⚠"
              : "ℹ";
    }

    if (details) {
      detailsEl.innerHTML = details;
      detailsEl.style.display = "block";
    } else {
      detailsEl.innerHTML = "";
      detailsEl.style.display = "none";
    }

    if (actionText) {
      action.textContent = actionText;
      action.hidden = false;
      action.disabled = false;
    } else {
      action.textContent = "";
      action.hidden = true;
    }

    close.hidden = !!locked;
    close.disabled = locked;
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    clearTimeout(notifyTimer);
    if (duration > 0 && !locked)
      notifyTimer = setTimeout(closeNotify, duration);
  }

  function setNotifyProcessing(title, message, details = null) {
    notify(message, "info", title, 0, null, null, true, details);
  }

  function closeNotify(force = false) {
    if (notifyLocked && !force) return;
    const overlay = $("notifyOverlay");
    const active = document.activeElement;
    const focusInsideNotify = overlay && active && overlay.contains(active);

    // Move focus out of the dialog BEFORE aria-hidden is applied.
    // This prevents the browser accessibility warning about a focused
    // descendant being hidden from assistive technology.
    if (focusInsideNotify) {
      if (notifyPreviousFocus && document.contains(notifyPreviousFocus)) {
        notifyPreviousFocus.focus({ preventScroll: true });
      } else {
        active.blur();
      }
    }

    if (overlay) {
      overlay.classList.remove("show");
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("modal-open");
    clearTimeout(notifyTimer);
    notifyTimer = null;
    notifyActionHandler = null;
    notifyLocked = false;
    notifyPreviousFocus = null;
    const action = $("notifyAction");
    if (action) {
      action.hidden = true;
      action.textContent = "";
    }
  }

  $("notifyAction").addEventListener("click", async () => {
    const handler = notifyActionHandler;
    if (typeof handler !== "function") return;
    const action = $("notifyAction");
    action.disabled = true;
    try {
      await handler();
    } finally {
      action.disabled = false;
    }
  });
  $("notifyClose").addEventListener("click", () => closeNotify());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !notifyLocked) closeNotify();
  });
  $("notifyOverlay").addEventListener("click", (e) => {
    if (e.target === $("notifyOverlay") && !notifyLocked) closeNotify();
  });

  function notifyConfirm(
    message,
    title = "Please Confirm",
    confirmText = "CONFIRM",
  ) {
    return new Promise((resolve) => {
      notify(
        message,
        "warn",
        title,
        0,
        confirmText,
        () => {
          closeNotify(true);
          resolve(true);
        },
        false,
        "You can cancel this action by closing this popup.",
      );
      const close = $("notifyClose");
      if (close) {
        close.hidden = false;
        close.textContent = "CANCEL";
        const previous = close.onclick;
        close.onclick = () => {
          close.onclick = previous;
          close.textContent = "OK";
          closeNotify(true);
          resolve(false);
        };
      }
    });
  }

  function setLoading(buttonId, loading = true, text = null) {
    const btn = $(buttonId);
    if (!btn) return;
    if (loading) {
      btn._originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-small"></span>&nbsp;${text || "Processing..."}`;
    } else {
      btn.disabled = false;
      if (btn._originalText) {
        btn.innerHTML = btn._originalText;
        delete btn._originalText;
      }
    }
  }

  function setStakeStatus(message, type = "info", show = true) {
    const el = $("stakeStatus");
    if (el) el.style.display = "none";
  }

  function setGasEstimate(amount, show = false) {
    const el = $("gasEstimate");
    if (el) el.style.display = "none";
  }

  async function getProviderWithFallback(retries = 0) {
    const startIndex = currentRpcIndex % CONFIG.rpcList.length;
    for (let i = 0; i < CONFIG.rpcList.length; i++) {
      const idx = (startIndex + i) % CONFIG.rpcList.length;
      const rpc = CONFIG.rpcList[idx];
      try {
        const provider = new ethers.JsonRpcProvider(rpc, {
          name: CONFIG.chainName,
          chainId: CONFIG.chainId,
        });
        await provider.getBlockNumber();
        currentRpcIndex = idx;
        return provider;
      } catch {
        continue;
      }
    }
    if (retries < CONFIG.maxRetries) {
      await new Promise((r) =>
        setTimeout(r, CONFIG.retryDelay * (retries + 1)),
      );
      return getProviderWithFallback(retries + 1);
    }
    throw new Error("All RPC nodes failed. Please try again later.");
  }

  function setWalletState(state, text) {
    const btn = $("connectBtn");
    btn.className = `wallet ${state}`;
    btn.innerHTML = text;
  }

  function clearUserUI() {
    [
      "nStakedAmount",
      "nMaxCap",
      "nTotalEarned",
      "nPendingRoi",
      "nPendingReferral",
      "nTotalRoiClaimed",
      "nSavedReward",
      "nReferralClaimCount",
      "nLastClaimTime",
      "nNetworkDepth",
      "nDirectCount",
      "nMaxCapReached",
    ].forEach((id) => setNetworkText(id, "—"));
    const body = $("downlineTableBody");
    if (body)
      body.innerHTML =
        '<tr><td colspan="7" class="network-empty">Connect wallet to load referral network.</td></tr>';
    setNetworkText("downlineCountBadge", "0");
    setNetworkText("downlinePageInfo", "—");
    setNetworkText("networkLevelsUpdated", "—");
    setNetworkText("networkLevelTotals", "");
    referralNetwork = [];
    referralLevelEarnings = Array.from({ length: 10 }, () => 0n);
    referralNetworkTotals = Array.from({ length: 10 }, () => 0);
    referralNetworkTruncated = false;
    networkLoadedAccount = "";
    networkLoadedGeneration = 0;
    renderNetworkLevels(referralLevelEarnings, referralNetworkTotals);

    const placeholders = [
      "balance",
      "staked",
      "pending",
      "referral",
      "dStaked",
      "dCap",
      "dClaimed",
      "dPending",
      "dReferral",
      "dSavedReward",
      "dLastClaim",
      "dCapRemaining",
      "roiClaimAmount",
      "referralClaimAmount",
      "stakeMaxCap",
      "dReferrer",
      "dLeader",
      "dCapStatus",
      "myAddress",
      "nReferrer",
      "nLeader",
      "allowanceText",
      "bnbBalanceText",
      "balanceStakeText",
    ];
    placeholders.forEach((id) => {
      const el = $(id);
      if (el) {
        if (id === "allowanceText") el.textContent = "Allowance: —";
        else if (id === "bnbBalanceText") el.textContent = "BNB Balance: —";
        else if (id === "balanceStakeText") el.textContent = "MEGAH Balance: —";
        else el.textContent = "—";
      }
    });
    $("positionStatus").textContent = "Wallet not connected";
    $("positionStatus").className = "badge gray";
    $("capProgress").style.width = "0%";
    $("capText").textContent = "Connect your wallet to view your position.";
    $("claimRoiBtn").disabled = true;
    $("claimReferralBtn").disabled = true;
    $("approveBtn").disabled = true;
    $("stakeBtn").disabled = true;
    $("maxBtn").disabled = true;
    document.querySelectorAll(".owner-tab").forEach((el) => {
      if (el) el.style.display = "none";
    });
    $("ownerWarning").textContent =
      "Owner panel is restricted to the contract owner.";
    setStakeStatus("", "info", false);
    setGasEstimate(null, false);
    toggleStakeButtons(false);
  }

  function disconnectUI() {
    account = null;
    signer = null;
    gt = null;
    token = null;
    cached.total = 0n;
    cached.cap = 0n;
    cached.claimed = 0n;
    cached.pending = 0n;
    cached.referral = 0n;
    cached.lastClaim = 0n;
    cached.dailyBps = 0n;
    cached.leaderBps = 0n;
    cached.minStake = 0n;
    cached.levels = [];
    clearUserUI();
    setWalletState(
      "red",
      '<i class="fa-solid fa-plug"></i>&nbsp;Connect Wallet',
    );
    clearInterval(refreshTimer);
    clearInterval(liveTimer);
    clearInterval(heartbeatTimer);
    if (blockListener) {
      readProvider?.off("block", blockListener);
      blockListener = null;
    }
    clearCache();
    document.querySelectorAll(".owner-tab").forEach((el) => {
      if (el) el.style.display = "none";
    });
    toggleStakeButtons(false);
  }

  async function syncWalletState(notifyWrongNetwork = false) {
    const generation = ++connectionGeneration;
    if (!window.ethereum) {
      disconnectUI();
      return false;
    }
    try {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      if (generation !== connectionGeneration) return false;
      const current = accounts?.[0] || null;
      if (!current) {
        disconnectUI();
        return false;
      }
      const currentChain = Number(BigInt(chain));
      if (currentChain !== CONFIG.chainId) {
        account = null;
        signer = null;
        gt = null;
        token = null;
        clearUserUI();
        setWalletState(
          "yellow",
          '<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;Switch Network',
        );
        if (notifyWrongNetwork) {
          notify(
            `Your wallet is on the wrong network. Please switch to ${CONFIG.chainName}.`,
            "warn",
            "Wrong Network",
            0,
          );
        }
        return false;
      }
      browserProvider = new ethers.BrowserProvider(window.ethereum, "any");
      signer = await browserProvider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== current.toLowerCase()) {
        disconnectUI();
        return false;
      }
      account = signerAddress;
      await bindWallet(generation);
      return true;
    } catch (e) {
      console.error("wallet sync", e);
      if (e?.message?.includes("provider") || e?.code?.includes("NETWORK")) {
        console.warn("Temporary error, maintaining read-only mode");
        return false;
      }
      disconnectUI();
      return false;
    }
  }

  async function bindWallet(generation = connectionGeneration) {
    if (!account) return false;
    const localAccount = account;
    try {
      const localProvider = new ethers.BrowserProvider(window.ethereum, "any");
      const localSigner = await localProvider.getSigner();
      const signerAddress = await localSigner.getAddress();
      if (signerAddress.toLowerCase() !== localAccount.toLowerCase()) {
        return false;
      }
      const contract = new ethers.Contract(
        CONFIG.stakingContract,
        GT_ABI,
        localSigner,
      );
      const taddr = await contract.stakingToken();
      if (taddr.toLowerCase() !== CONFIG.expectedToken.toLowerCase()) {
        throw new Error(
          "Staking contract is configured for a token other than MEGAH.",
        );
      }
      const erc20 = new ethers.Contract(
        CONFIG.expectedToken,
        ERC20_ABI,
        localSigner,
      );
      const decimals = Number(await erc20.decimals());
      const symbol = await erc20.symbol();
      if (symbol.toUpperCase() !== CONFIG.expectedSymbol) {
        throw new Error(
          `Token returned ${symbol}, expected ${CONFIG.expectedSymbol}.`,
        );
      }
      if (generation !== connectionGeneration) return false;
      browserProvider = localProvider;
      signer = localSigner;
      gt = contract;
      token = erc20;
      account = signerAddress;
      tokenDecimals = decimals;
      tokenSymbol = symbol;
      setWalletState(
        "green",
        `<i class="fa-solid fa-circle-check"></i>&nbsp;${short(account)}`,
      );
      $("myAddress").textContent = short(account);
      $("myAddress").title = account;
      const owner = await gt.owner();
      const isOwner = owner.toLowerCase() === account.toLowerCase();
      document.querySelectorAll(".owner-tab").forEach((el) => {
        if (el) el.style.display = isOwner ? "flex" : "none";
      });
      $("ownerWarning").textContent = isOwner
        ? "✅ Connected wallet is the contract owner. Owner functions are enabled."
        : "Owner panel is restricted to the contract owner.";
      $("approveBtn").disabled = false;
      $("stakeBtn").disabled = false;
      $("maxBtn").disabled = false;
      toggleStakeButtons(false);
      await refresh();
      await refreshNetworkIfVisible(false);
      startPolling();
      return true;
    } catch (e) {
      console.error("bindWallet", e);
      if (!e?.message?.includes("provider") && !e?.code?.includes("NETWORK")) {
        disconnectUI();
        notify(cleanError(e), "error", "Wallet / Contract Error", 0);
      } else {
        console.warn("Temporary error, maintaining read-only mode");
      }
      return false;
    }
  }

  async function connect() {
    if (!window.ethereum) {
      notify(
        "No EVM wallet detected. Open this app in an EVM browser wallet or install an EVM-compatible wallet.",
        "error",
        "Wallet Not Found",
        0,
      );
      return;
    }
    try {
      setWalletState(
        "blue",
        '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Connecting...',
      );
      browserProvider = new ethers.BrowserProvider(window.ethereum, "any");
      const net = await browserProvider.getNetwork();
      if (Number(net.chainId) !== CONFIG.chainId) {
        await addNetwork();
        return;
      }
      await browserProvider.send("eth_requestAccounts", []);
      await syncWalletState(false);
      if (!account) {
        notify("Wallet connection failed.", "error", "Connection Failed", 0);
      }
    } catch (e) {
      console.error(e);
      disconnectUI();
      notify(cleanError(e), "error", "Wallet Connection", 0);
    }
  }

  async function addNetwork() {
    try {
      setWalletState(
        "yellow",
        '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Switching...',
      );
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CONFIG.chainHex,
            chainName: CONFIG.chainName,
            nativeCurrency: {
              name: "BNB Smart Chain",
              symbol: "BNB",
              decimals: 18,
            },
            rpcUrls: [CONFIG.rpcList[0]],
            blockExplorerUrls: [CONFIG.explorer],
          },
        ],
      });
      await syncWalletState(false);
    } catch (e) {
      console.error(e);
      setWalletState(
        "yellow",
        '<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;Switch Network',
      );
      notify(cleanError(e), "warn", "Switch Network", 0);
    }
  }

  async function requireWallet() {
    if (!window.ethereum) {
      notify("No EVM wallet detected.", "error", "Wallet Required", 0);
      return false;
    }
    const ok = await syncWalletState(true);
    if (!ok) return false;
    if (!gt || !token) {
      notify(
        "Wallet connected but staking contract could not be initialized.",
        "error",
        "Contract Error",
        0,
      );
      return false;
    }
    return true;
  }

  async function requireOwner() {
    if (!(await requireWallet())) return false;
    try {
      const owner = await gt.owner();
      if (owner.toLowerCase() !== account.toLowerCase()) {
        notify(
          "Connected wallet is not the owner of this staking contract.",
          "error",
          "Owner Access Denied",
          0,
        );
        return false;
      }
      return true;
    } catch (e) {
      notify(cleanError(e), "error", "Owner Verification Failed", 0);
      return false;
    }
  }

  async function initReadProvider() {
    readProvider = await getProviderWithFallback();
    const code = await readProvider.getCode(CONFIG.stakingContract);
    if (code === "0x") {
      throw new Error("Staking contract not found on BNB Smart Chain.");
    }
    const reader = new ethers.Contract(
      CONFIG.stakingContract,
      GT_ABI,
      readProvider,
    );
    const taddr = await reader.stakingToken();
    if (taddr.toLowerCase() !== CONFIG.expectedToken.toLowerCase()) {
      throw new Error("Staking contract is configured for a different token.");
    }
    readToken = new ethers.Contract(
      CONFIG.expectedToken,
      ERC20_ABI,
      readProvider,
    );
    tokenDecimals = Number(await readToken.decimals());
    tokenSymbol = await readToken.symbol();
    if (tokenSymbol.toUpperCase() !== CONFIG.expectedSymbol) {
      throw new Error(
        `Expected ${CONFIG.expectedSymbol}, but token returned ${tokenSymbol}.`,
      );
    }
    setupBlockListener();
    await refresh();
  }

  function setupBlockListener() {
    if (blockListener) {
      readProvider?.off("block", blockListener);
      blockListener = null;
    }
    blockListener = async (blockNumber) => {
      if (account) {
        await refreshUserOnChain();
      }
    };
    readProvider?.on("block", blockListener);
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      if (!account) return;
      try {
        const accounts = await window.ethereum?.request({
          method: "eth_accounts",
        });
        if (
          !accounts?.length ||
          accounts[0].toLowerCase() !== account.toLowerCase()
        ) {
          disconnectUI();
          notify("Wallet disconnected.", "warn", "Disconnected", 3000);
        }
      } catch {}
    }, 10000);
  }

  async function readNativeBalance(address) {
    try {
      return await readProvider.getBalance(address);
    } catch {
      return 0n;
    }
  }

  function updateLevelsDisplay(levels) {
    const levelsContainer = $("levels");
    if (levelsContainer) {
      levelsContainer.innerHTML = levels
        .map(
          (b, i) =>
            `<div class="kv"><span>Level ${i + 1}</span><span>${fmtBps(BigInt(b))}</span></div>`,
        )
        .join("");
    }
    const calcDisplay = document.getElementById("calculatorLevelsDisplay");
    if (calcDisplay && levels.length > 0) {
      calcDisplay.innerHTML = levels
        .map((b, i) => `L${i + 1}: ${fmtBps(BigInt(b))}`)
        .join(" | ");
    } else if (calcDisplay) {
      calcDisplay.textContent = "Loading data from contract...";
    }
    levels.forEach((b, i) => {
      const el = $(`lvl${i + 1}`);
      if (el && !el.matches(":focus")) {
        el.value = String(b);
      }
    });
  }

  async function refresh() {
    if (!configured()) return;
    const cacheKey = "contract_data";
    const cachedData = getCached(cacheKey);
    let reader;
    if (cachedData) {
      reader = cachedData.reader;
    } else {
      reader =
        gt || new ethers.Contract(CONFIG.stakingContract, GT_ABI, readProvider);
      setCached(cacheKey, { reader });
    }
    try {
      const [
        owner,
        stakingToken,
        min,
        roi,
        leaderBonus,
        maxReferralLevels,
        maxDirectDownlines,
        maxBps,
        leftoverWallet,
      ] = await Promise.all([
        reader.owner(),
        reader.stakingToken(),
        reader.minStake(),
        reader.dailyRoiBps(),
        reader.leaderBonusBps(),
        reader.MAX_REFERRAL_LEVELS(),
        reader.MAX_DIRECT_DOWNLINES(),
        reader.MAX_BPS(),
        reader.ADMIN_LEFTOVER_WALLET(),
      ]);

      cached.minStake = min;
      cached.dailyBps = roi;
      cached.leaderBps = leaderBonus;

      const contractDataTime = document.getElementById("contractDataTime");
      if (contractDataTime) {
        const now = new Date();
        contractDataTime.textContent = `Updated: ${now.toLocaleTimeString("en-US")}`;
      }

      const calcRoiInput = document.getElementById("calcRoi");
      const calcMaxCapInput = document.getElementById("calcMaxCapPct");
      if (calcRoiInput) {
        const roiPercent = Number(roi) / 100;
        calcRoiInput.value = roiPercent.toFixed(2);
      }
      if (calcMaxCapInput) {
        calcMaxCapInput.value = 200;
      }

      const levels = await Promise.all(
        [...Array(10)].map((_, i) =>
          reader.referralBonusLevels(i).catch(() => 0n),
        ),
      );
      cached.levels = levels;
      updateLevelsDisplay(levels);

      if (typeof calculateStaking === "function") {
        setTimeout(calculateStaking, 50);
      }

      $("contractToken").textContent = short(stakingToken);
      $("contractMin").textContent = `${fmt(min)} ${tokenSymbol}`;
      $("contractRoi").textContent = fmtBps(roi);
      $("contractLeader").textContent = fmtBps(leaderBonus);
      $("contractNetwork").textContent = CONFIG.chainName;

      const leftoverEl = $("contractLeftover");
      if (leftoverEl) {
        leftoverEl.textContent = leftoverWallet;
        leftoverEl.title = leftoverWallet;
      }
      setNetworkText("contractMaxReferralLevels", String(maxReferralLevels));
      setNetworkText("contractMaxDirectDownlines", String(maxDirectDownlines));
      setNetworkText("contractMaxBps", String(maxBps));

      try {
        const tokenForRead = token || readToken;
        if (tokenForRead) {
          const poolBalance = await tokenForRead.balanceOf(
            CONFIG.stakingContract,
          );
          const poolEl = $("contractPoolBalance");
          if (poolEl) {
            poolEl.textContent = `${fmt(poolBalance)} ${tokenSymbol}`;
          }
        }
      } catch (poolError) {
        console.warn("Failed to read reward pool:", poolError);
      }
      $("minStake").textContent = `${fmt(min)} ${tokenSymbol}`;
      $("dailyRoi").textContent = fmtBps(roi);
      $("leaderBonus").textContent = fmtBps(leaderBonus);
      $("stakeMin").textContent = `${fmt(min)} ${tokenSymbol}`;
      $("stakeRoi").textContent = fmtBps(roi);

      if (!account) {
        clearUserUI();
        return;
      }
      const tokenForRead = token || readToken;
      const [info, up, leader, maxReached, balance, allowance, bnbBalance] =
        await Promise.all([
          reader.getStakeInfo(account),
          reader.userReferrers(account),
          reader.isLeader(account),
          reader.isMaxCapReached(account),
          tokenForRead.balanceOf(account),
          tokenForRead.allowance(account, CONFIG.stakingContract),
          readNativeBalance(account),
        ]);
      cached.total = info[0];
      cached.cap = info[1];
      cached.claimed = info[2];
      cached.pending = info[3];
      cached.referral = info[4];
      const raw = await reader.userStakes(account);
      cached.lastClaim = raw[4];
      renderUser(
        info,
        up,
        leader,
        maxReached,
        balance,
        allowance,
        bnbBalance,
        raw,
      );
      if (owner.toLowerCase() === account.toLowerCase()) {
        fillOwner(levels, min, roi, leaderBonus);
      }
    } catch (e) {
      console.error("refresh", e);
      if (e.message?.includes("network") || e.message?.includes("timeout")) {
        try {
          readProvider = await getProviderWithFallback();
          await refresh();
        } catch {}
      }
    }
  }

  async function refreshUserOnChain() {
    if (isPolling) return;
    if (!account || !gt) return;
    const localAccount = account;
    const generation = connectionGeneration;
    const tokenForRead = token || readToken;
    if (!tokenForRead) return;
    isPolling = true;
    try {
      const [
        info,
        up,
        leader,
        maxReached,
        balance,
        allowance,
        bnbBalance,
        raw,
      ] = await Promise.all([
        gt.getStakeInfo(localAccount),
        gt.userReferrers(localAccount),
        gt.isLeader(localAccount),
        gt.isMaxCapReached(localAccount),
        tokenForRead.balanceOf(localAccount),
        tokenForRead.allowance(localAccount, CONFIG.stakingContract),
        readNativeBalance(localAccount),
        gt.userStakes(localAccount),
      ]);
      if (
        generation !== connectionGeneration ||
        account?.toLowerCase() !== localAccount.toLowerCase()
      ) {
        return;
      }
      cached.total = info[0];
      cached.cap = info[1];
      cached.claimed = info[2];
      cached.pending = info[3];
      cached.referral = info[4];
      cached.lastClaim = raw[4];
      renderUser(
        info,
        up,
        leader,
        maxReached,
        balance,
        allowance,
        bnbBalance,
        raw,
      );
    } catch (e) {
      console.error("on-chain user refresh", e);
    } finally {
      isPolling = false;
    }
  }

  function renderUser(info, up, leader, maxReached, bal, allow, bnb, raw) {
    if (!account) {
      clearUserUI();
      return;
    }
    $("balance").textContent = `${fmt(bal)} ${tokenSymbol}`;
    $("staked").textContent = `${fmt(info[0])} ${tokenSymbol}`;
    $("pending").textContent = `${fmt(info[3])} ${tokenSymbol}`;
    $("referral").textContent = `${fmt(info[4])} ${tokenSymbol}`;
    $("dStaked").textContent = `${fmt(info[0])} ${tokenSymbol}`;
    $("dCap").textContent = `${fmt(info[1])} ${tokenSymbol}`;
    $("dClaimed").textContent = `${fmt(info[2])} ${tokenSymbol}`;
    $("dPending").textContent = `${fmt(info[3])} ${tokenSymbol}`;
    $("dReferral").textContent = `${fmt(info[4])} ${tokenSymbol}`;
    if (raw && raw.length >= 5) {
      $("dSavedReward").textContent = `${fmt(raw[3])} ${tokenSymbol}`;
      $("dLastClaim").textContent = formatTimestamp(raw[4]);
      if (raw.length >= 8) {
        const totalRoiClaimed = raw[6] || 0n;
        const referralClaimCount = raw[7] || 0n;
        const nTotalRoi = $("nTotalRoiClaimed");
        const nRefClaims = $("nReferralClaimCount");
        if (nTotalRoi)
          nTotalRoi.textContent = `${fmt(totalRoiClaimed)} ${tokenSymbol}`;
        if (nRefClaims) nRefClaims.textContent = String(referralClaimCount);
      }
    }
    const remaining = info[1] > info[2] ? info[1] - info[2] : 0n;
    $("dCapRemaining").textContent = `${fmt(remaining)} ${tokenSymbol}`;
    const roiPending = info[3] || 0n;
    const referralPending = info[4] || 0n;
    const claimRoiBtn = $("claimRoiBtn");
    const claimReferralBtn = $("claimReferralBtn");
    if (!claimRoiBtn._originalText) {
      claimRoiBtn.disabled = roiPending <= 0n;
    }
    if (!claimReferralBtn._originalText) {
      claimReferralBtn.disabled = referralPending <= 0n;
    }
    $("roiClaimAmount").textContent = `${fmt(roiPending)} ${tokenSymbol}`;
    $("referralClaimAmount").textContent =
      `${fmt(referralPending)} ${tokenSymbol}`;
    $("stakeMaxCap").textContent = `${fmt(info[1])} ${tokenSymbol}`;
    const referrerDisplay =
      up && up !== ethers.ZeroAddress ? short(up) : "None";
    $("dReferrer").textContent = referrerDisplay;
    $("dReferrer").title = up || "";
    $("nReferrer").textContent = referrerDisplay;
    $("nReferrer").title = up || "";
    $("dLeader").textContent = leader ? "Yes" : "No";
    $("nLeader").textContent = leader ? "Yes" : "No";
    $("dCapStatus").textContent = maxReached ? "Reached" : "Not Reached";
    $("dCapStatus").style.color = maxReached ? "#ff8c9c" : "#70dfbd";
    $("positionStatus").textContent = "Connected";
    $("positionStatus").className = "badge green";
    const pct = info[1] > 0n ? Number((info[2] * 10000n) / info[1]) / 100 : 0;
    const calcCap = $("calcMaxCapPct");
    if (calcCap && info[0] > 0n)
      calcCap.value = (Number((info[1] * 10000n) / info[0]) / 100).toFixed(2);
    $("capProgress").style.width = Math.min(100, pct) + "%";
    $("capText").textContent = `${pct.toFixed(2)}% of maximum cap reached`;
    $("allowanceText").textContent = `Allowance: ${fmt(allow)} ${tokenSymbol}`;
    $("bnbBalanceText").textContent = `BNB Balance: ${fmtNative(bnb)} BNB`;
    $("balanceStakeText").textContent =
      `MEGAH Balance: ${fmt(bal)} ${tokenSymbol}`;
  }

  function setNetworkText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function renderNetworkLevels(earnings = [], counts = []) {
    const box = $("networkLevelEarnings");
    if (!box) return;
    box.innerHTML = "";
    let total = 0n;
    for (let i = 0; i < 10; i++) {
      const amount = BigInt(earnings?.[i] || 0n);
      const count = Number(counts?.[i] || 0);
      total += amount;
      const d = document.createElement("div");
      d.className = "level-earn";
      d.innerHTML = `<b>LEVEL ${i + 1}</b><span>${fmt(amount)} ${tokenSymbol}<small style="display:block;opacity:.7;font-size:8px;">${count} member${count === 1 ? "" : "s"}</small></span>`;
      box.appendChild(d);
    }
    const totalEl = $("networkLevelTotals");
    if (totalEl)
      totalEl.textContent = `Total referral earned from network: ${fmt(total)} ${tokenSymbol}${referralNetworkTruncated ? " • Network display limited for performance." : ""}`;
  }

  async function buildReferralNetwork() {
    if (!gt || !account) return;
    const nodes = [];
    const seen = new Set([account.toLowerCase()]);
    let frontier = [account];
    let level = 0;
    referralNetworkTruncated = false;
    while (frontier.length && level < 10 && nodes.length < MAX_NETWORK_NODES) {
      const children = await Promise.all(
        frontier.map(async (parent) => {
          try {
            return await gt.getDirectDownlines(parent);
          } catch (e) {
            console.warn("getDirectDownlines", parent, e);
            return [];
          }
        }),
      );
      const next = [];
      for (const list of children) {
        for (const wallet of list) {
          const key = wallet.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          nodes.push({ wallet, level: level + 1 });
          next.push(wallet);
          if (nodes.length >= MAX_NETWORK_NODES) {
            referralNetworkTruncated = true;
            break;
          }
        }
        if (nodes.length >= MAX_NETWORK_NODES) break;
      }
      frontier = next;
      level++;
    }
    if (frontier.length && level >= 10) {
      // Level 10 is the contract's maximum referral depth.
    }
    referralNetwork = nodes;
    referralNetworkTotals = Array.from({ length: 10 }, () => 0);
    for (const n of nodes) referralNetworkTotals[n.level - 1]++;

    const results = Array.from({ length: 10 }, () => 0n);
    const batchSize = 20;
    for (let i = 0; i < nodes.length; i += batchSize) {
      const batch = nodes.slice(i, i + batchSize);
      const values = await Promise.all(
        batch.map(async (n) => {
          try {
            return await gt.getReferralEarnedByLevel(account, n.wallet);
          } catch (e) {
            console.warn("getReferralEarnedByLevel", n.wallet, e);
            return null;
          }
        }),
      );
      values.forEach((v) => {
        if (!v) return;
        for (let i = 0; i < 10; i++) results[i] += BigInt(v[i] || 0n);
      });
    }
    referralLevelEarnings = results;
    renderNetworkLevels(results, referralNetworkTotals);
  }

  function renderDownlines(items, total) {
    const body = $("downlineTableBody");
    const badge = $("downlineCountBadge");
    const pageInfo = $("downlinePageInfo");
    if (badge) badge.textContent = String(total);
    if (!body) return;
    body.innerHTML = "";
    if (!items.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="network-empty">No referral downlines recorded on-chain.</td></tr>';
    } else {
      items.forEach((d, idx) => {
        const tr = document.createElement("tr");
        const wallet = d.wallet;
        const level = d.level;
        const staked = d.stakedAmount ?? 0n;
        const refEarned = d.referralEarned ?? 0n;
        const refCount = d.referralRewardCount ?? 0n;
        const reached = d.maxCapReached ?? false;
        tr.innerHTML = `<td>${downlineOffset + idx + 1}</td><td>L${level}</td><td title="${wallet}">${short(wallet)}</td><td>${fmt(staked)}</td><td>${fmt(refEarned)}</td><td>${String(refCount)}</td><td>${reached ? "Cap reached" : "Active"}</td>`;
        body.appendChild(tr);
      });
    }
    const start = total ? downlineOffset + 1 : 0;
    const end = Math.min(downlineOffset + items.length, total);
    if (pageInfo)
      pageInfo.textContent = total
        ? `${start}–${end} of ${total}`
        : "0 network members";
    const prev = $("downlinePrev"),
      next = $("downlineNext");
    if (prev) prev.disabled = downlineOffset === 0;
    if (next) next.disabled = downlineOffset + items.length >= total;
  }

  async function loadDownlinesPage() {
    if (!gt || !account) return;
    try {
      const total = referralNetwork.length;
      const page = referralNetwork.slice(
        downlineOffset,
        downlineOffset + DOWNLINE_PAGE_SIZE,
      );
      const enriched = await Promise.all(
        page.map(async (n) => {
          try {
            const [info, stats] = await Promise.all([
              gt.getStakeInfo(n.wallet),
              gt.getReferralStats(account, n.wallet),
            ]);
            return {
              wallet: n.wallet,
              level: n.level,
              stakedAmount: info[0] || 0n,
              referralEarned: stats[0] || 0n,
              referralRewardCount: stats[1] || 0n,
              maxCapReached: info[1] > 0n && info[2] >= info[1],
            };
          } catch {
            return {
              wallet: n.wallet,
              level: n.level,
              stakedAmount: 0n,
              referralEarned: 0n,
              referralRewardCount: 0n,
              maxCapReached: false,
            };
          }
        }),
      );
      renderDownlines(enriched, total);
    } catch (e) {
      console.error("network page", e);
      const body = $("downlineTableBody");
      if (body)
        body.innerHTML = `<tr><td colspan="7" class="network-empty">Unable to read referral data: ${cleanError(e)}</td></tr>`;
    }
  }

  async function inspectReferralPair() {
    if (!gt) return;
    const input = $("refPairWallet");
    const result = $("refPairResult");
    const wallet = input?.value?.trim();
    if (!ethers.isAddress(wallet)) {
      if (result) result.textContent = "Please enter a valid wallet address.";
      return;
    }
    const referrer = account;
    if (!referrer) {
      if (result) result.textContent = "Connect your wallet first.";
      return;
    }
    try {
      const [stats, levels] = await Promise.all([
        gt.getReferralStats(referrer, wallet),
        gt.getReferralEarnedByLevel(referrer, wallet),
      ]);
      const parts = [];
      for (let i = 0; i < 10; i++)
        parts.push(`L${i + 1}: ${fmt(levels[i])} ${tokenSymbol}`);
      if (result)
        result.innerHTML = `<strong>Total earned:</strong> ${fmt(stats[0])} ${tokenSymbol} &nbsp; <strong>Reward count:</strong> ${stats[1]}<div style="margin-top:5px;line-height:1.7;">${parts.join(" &nbsp;•&nbsp; ")}</div>`;
    } catch (e) {
      if (result) result.textContent = cleanError(e);
    }
  }

  function isNetworkTabActive() {
    const section = $("network");
    return !!section?.classList.contains("active");
  }

  async function refreshExtendedNetwork(force = false) {
    if (!gt || !account || networkRefreshInFlight) return;
    const localAccount = account;
    const generation = connectionGeneration;
    if (
      !force &&
      networkLoadedAccount === localAccount.toLowerCase() &&
      networkLoadedGeneration === generation
    ) {
      return;
    }
    networkRefreshInFlight = true;
    try {
      const [levels] = await Promise.all([gt.getReferralLevels()]);
      if (
        generation !== connectionGeneration ||
        account?.toLowerCase() !== localAccount.toLowerCase()
      )
        return;
      cached.levels = levels;
      updateLevelsDisplay(levels);
      downlineOffset = 0;
      await buildReferralNetwork();
      if (
        generation !== connectionGeneration ||
        account?.toLowerCase() !== localAccount.toLowerCase()
      )
        return;
      await loadDownlinesPage();
      setNetworkText("downlineCountBadge", String(referralNetwork.length));
      setNetworkText(
        "networkLevelsUpdated",
        `Updated ${new Date().toLocaleTimeString()}`,
      );
      networkLoadedAccount = localAccount.toLowerCase();
      networkLoadedGeneration = generation;
    } catch (e) {
      console.error("referral network refresh", e);
      const box = $("networkLevelEarnings");
      if (box)
        box.innerHTML = `<div class="network-empty" style="grid-column:1/-1;">Unable to read referral earnings: ${cleanError(e)}</div>`;
    } finally {
      networkRefreshInFlight = false;
    }
  }

  async function refreshNetworkIfVisible(force = false) {
    if (isNetworkTabActive()) {
      await refreshExtendedNetwork(force);
    }
  }

  function fillOwner(levels, min, roi, lb) {
    $("oMinStake").value = ethers.formatUnits(min, tokenDecimals);
    $("oRoi").value = String(roi);
    $("oLeaderBps").value = String(lb);
    levels.forEach((b, i) => {
      const el = $(`lvl${i + 1}`);
      if (el && !el.matches(":focus")) {
        el.value = String(b);
      }
    });
  }

  function buildLevelInputs() {
    const box = $("levelInputs");
    box.innerHTML = "";
    for (let i = 1; i <= 10; i++) {
      const d = document.createElement("div");
      d.innerHTML = `<label class="label">Level ${i} — BPS</label><input id="lvl${i}" inputmode="numeric" placeholder="0" style="font-size:12px;padding:6px 10px;">`;
      box.appendChild(d);
    }
  }

  async function sendTransaction(
    tx,
    label,
    buttonId = null,
    showGasEstimate = true,
  ) {
    const myNonce = ++transactionNonce;
    if (isProcessing) {
      notify(
        "A transaction is already being processed.",
        "warn",
        "Processing",
        2000,
      );
      return null;
    }
    isProcessing = true;
    if (buttonId) {
      const btn = $(buttonId);
      if (btn) {
        btn._originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-small"></span>&nbsp;${label}...`;
      }
    }

    try {
      let gasText = "";
      if (showGasEstimate) {
        try {
          const gasRequest = {
            from: account,
            to: tx.to,
            data: tx.data,
            value: tx.value || 0n,
          };
          const gasEstimate = await readProvider.estimateGas(gasRequest);
          const feeData = await readProvider.getFeeData();
          const gasPrice =
            tx.gasPrice ||
            tx.maxFeePerGas ||
            feeData.gasPrice ||
            feeData.maxFeePerGas ||
            0n;
          if (gasPrice > 0n) {
            const totalGas = gasEstimate * gasPrice;
            gasText = `Estimated network fee: ~${parseFloat(ethers.formatEther(totalGas)).toFixed(6)} BNB`;
          } else {
            gasText = `Estimated gas: ~${gasEstimate.toString()} units`;
          }
        } catch (gasError) {
          console.warn("Gas estimation failed:", gasError);
          gasText =
            "Gas estimate is unavailable right now. Your wallet will show the final fee before confirmation.";
        }
      }

      setNotifyProcessing(
        label,
        "Transaction submitted. Waiting for blockchain confirmation…",
        gasText
          ? `<strong>⛽ ${gasText}</strong><br>Do not close this page while the transaction is confirming.`
          : "Do not close this page while the transaction is confirming.",
      );

      const receipt = await tx.wait();
      if (myNonce !== transactionNonce) return null;

      clearCache();
      await refresh();
      await refreshNetworkIfVisible(true);

      notify(
        `${label} was confirmed successfully.

Transaction: ${short(receipt.hash)}`,
        "ok",
        "Transaction Successful",
        5000,
        "View on BscScan",
        () => {
          window.open(
            `${CONFIG.explorer}tx/${receipt.hash}`,
            "_blank",
            "noopener,noreferrer",
          );
        },
        false,
        gasText ? `⛽ ${gasText}` : null,
      );

      if (buttonId) {
        const btn = $(buttonId);
        if (btn && btn._originalText) {
          btn.disabled = false;
          btn.innerHTML = btn._originalText;
          delete btn._originalText;
        }
      }
      return receipt;
    } catch (e) {
      if (myNonce !== transactionNonce) return null;
      const msg = cleanError(e);
      notify(msg, "error", `${label} Failed`, 0);
      if (buttonId) {
        const btn = $(buttonId);
        if (btn && btn._originalText) {
          btn.disabled = false;
          btn.innerHTML = btn._originalText;
          delete btn._originalText;
        }
      }
      throw e;
    } finally {
      if (myNonce === transactionNonce) isProcessing = false;
    }
  }

  async function approve() {
    if (!(await requireWallet())) return;
    if (isProcessing) {
      notify(
        "Please wait for the current process to finish.",
        "warn",
        "Processing",
        2000,
      );
      return;
    }

    const amountInput = $("stakeAmount");
    const amountRaw = amountInput.value.trim();
    const validation = validateAmountInput(amountRaw);

    if (!validation.valid) {
      notify(validation.message, "warn", "Input Error", 0);
      amountInput.classList.add("input-error");
      setTimeout(() => amountInput.classList.remove("input-error"), 3000);
      return;
    }

    try {
      const amount = ethers.parseUnits(validation.value, tokenDecimals);

      if (!(await validateStakeInput(amount))) {
        return;
      }

      const currentAllowance = await token.allowance(
        account,
        CONFIG.stakingContract,
      );

      if (amount <= currentAllowance) {
        toggleStakeButtons(true);
        notify(
          `Your approval is already sufficient for ${fmt(amount)} MEGAH.`,
          "ok",
          "Ready to Stake",
          0,
          "STAKE NOW",
          () => {
            closeNotify(true);
            return stake();
          },
        );
        return;
      }

      const tx = await token.approve(CONFIG.stakingContract, amount);
      await sendTransaction(tx, "Approve MEGAH", "approveBtn");

      toggleStakeButtons(true);

      notify(
        `You approved ${fmt(amount)} MEGAH successfully.\n\nYour tokens are ready for staking.`,
        "ok",
        "Approval Successful",
        0,
        "STAKE NOW",
        () => {
          closeNotify(true);
          return stake();
        },
        false,
        "You can review the amount and referrer on the staking form before confirming the stake.",
      );
    } catch (e) {
      notify(cleanError(e), "error", "Approval Failed", 0);
    }
  }

  async function stake() {
    if (!(await requireWallet())) return;
    if (isProcessing) {
      notify(
        "Please wait for the current process to finish.",
        "warn",
        "Processing",
        2000,
      );
      return;
    }

    const amountInput = $("stakeAmount");
    const amountRaw = amountInput.value.trim();
    const validation = validateAmountInput(amountRaw);

    if (!validation.valid) {
      notify(validation.message, "warn", "Input Error", 0);
      amountInput.classList.add("input-error");
      setTimeout(() => amountInput.classList.remove("input-error"), 3000);
      return;
    }

    try {
      const amount = ethers.parseUnits(validation.value, tokenDecimals);

      if (!(await validateStakeInput(amount))) {
        return;
      }

      const allowance = await token.allowance(account, CONFIG.stakingContract);

      if (allowance < amount) {
        toggleStakeButtons(false);
        notify(
          `Insufficient allowance.\nAllowance: ${fmt(allowance)} MEGAH\nRequired: ${fmt(amount)} MEGAH\n\nPlease approve first.`,
          "warn",
          "Insufficient Allowance",
          0,
        );
        return;
      }

      let up = $("referrer").value.trim();

      if (up) {
        if (!validAddress(up)) {
          notify("Invalid referrer address.", "error", "Input Error", 0);
          return;
        }
        if (up.toLowerCase() === account.toLowerCase()) {
          notify(
            "Referrer cannot be your own address.",
            "warn",
            "Input Error",
            0,
          );
          return;
        }
      }

      const tx = await gt.stake(amount, up || ethers.ZeroAddress);
      await sendTransaction(tx, "Stake MEGAH", "stakeBtn");

      amountInput.value = "";
      toggleStakeButtons(false);
    } catch (e) {
      notify(cleanError(e), "error", "Stake Failed", 0);
    }
  }

  // ============================================================
  // TOGGLE STAKE BUTTONS
  // ============================================================

  function toggleStakeButtons(showStake) {
    const approveBtn = $("approveBtn");
    const stakeBtn = $("stakeBtn");
    const amountInput = $("stakeAmount");
    const validation = validateAmountInput(amountInput.value.trim());

    if (!validation.valid || !amountInput.value.trim()) {
      approveBtn.disabled = true;
      stakeBtn.disabled = true;
      approveBtn.classList.remove("hidden");
      stakeBtn.classList.add("hidden");
      return;
    }

    if (showStake) {
      approveBtn.classList.add("hidden");
      approveBtn.disabled = true;
      stakeBtn.classList.remove("hidden");
      stakeBtn.disabled = false;
    } else {
      approveBtn.classList.remove("hidden");
      approveBtn.disabled = false;
      stakeBtn.classList.add("hidden");
      stakeBtn.disabled = true;
    }
  }

  async function checkAllowance() {
    if (!account || !token) {
      toggleStakeButtons(false);
      return;
    }

    const amountInput = $("stakeAmount");
    const amountRaw = amountInput.value.trim();
    const validation = validateAmountInput(amountRaw);

    if (!validation.valid || !amountRaw) {
      toggleStakeButtons(false);
      return;
    }

    try {
      const amount = ethers.parseUnits(amountRaw, tokenDecimals);
      const allowance = await token.allowance(account, CONFIG.stakingContract);
      const balance = await token.balanceOf(account);

      if (amount > balance) {
        toggleStakeButtons(false);
        return;
      }

      if (allowance >= amount) {
        toggleStakeButtons(true);
      } else {
        toggleStakeButtons(false);
      }
    } catch (e) {
      toggleStakeButtons(false);
    }
  }

  async function maxAmount() {
    if (!(await requireWallet())) return;
    const tokenForRead = token || readToken;
    if (!tokenForRead) {
      notify("Token contract not available.", "error", "Token Error", 0);
      return;
    }
    try {
      const balance = await tokenForRead.balanceOf(account);
      $("stakeAmount").value = ethers.formatUnits(balance, tokenDecimals);
    } catch (e) {
      notify(cleanError(e), "error", "Failed to Read Balance", 0);
    }
  }

  async function validateStakeInput(amount) {
    if (!account) {
      notify("Please connect your wallet first.", "warn", "Wallet Required", 0);
      return false;
    }
    if (amount <= 0n) {
      notify(
        "Please enter a valid MEGAH amount (greater than 0).",
        "warn",
        "Input Error",
        0,
      );
      return false;
    }
    const tokenForRead = token || readToken;
    if (!tokenForRead) {
      notify(
        "Token contract not available. Please refresh the page.",
        "error",
        "Token Error",
        0,
      );
      return false;
    }
    try {
      const balance = await tokenForRead.balanceOf(account);
      if (amount > balance) {
        notify(
          `❌ Your MEGAH balance: ${fmt(balance)} MEGAH\nRequired: ${fmt(amount)} MEGAH\n\nPlease reduce the amount or add more MEGAH.`,
          "error",
          "Insufficient Balance",
          0,
        );
        return false;
      }
    } catch (e) {
      notify(
        "Failed to read balance: " + cleanError(e),
        "error",
        "Balance Error",
        0,
      );
      return false;
    }
    if (gt) {
      try {
        const min = await gt.minStake();
        if (amount < min) {
          notify(
            `❌ Minimum stake: ${fmt(min)} MEGAH\nYou entered: ${fmt(amount)} MEGAH`,
            "warn",
            "Below Minimum",
            0,
          );
          return false;
        }
      } catch (e) {
        notify(
          "Failed to read minimum stake: " + cleanError(e),
          "error",
          "Contract Error",
          0,
        );
        return false;
      }
    }
    return true;
  }

  async function claimRoi() {
    if (!(await requireWallet())) return;
    if (isProcessing) {
      notify(
        "Please wait for the current process to finish.",
        "warn",
        "Processing",
        2000,
      );
      return;
    }
    if (cached.pending <= 0n) {
      notify("No pending ROI to claim.", "info", "No Reward", 3000);
      return;
    }
    const roiAmount = cached.pending;
    try {
      const beforeTotalEarned = cached.claimed;
      const beforeReferral = cached.referral;
      try {
        const txEstimate = await gt.claimRoi.populateTransaction();
        const gasEstimate = await readProvider.estimateGas({
          to: CONFIG.stakingContract,
          data: txEstimate.data,
          from: account,
        });
        const feeData = await readProvider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
        const totalGas = gasEstimate * gasPrice;
        setGasEstimate(ethers.formatEther(totalGas), true);
      } catch {}
      const tx = await gt.claimRoi();
      const receipt = await sendTransaction(tx, "Claim ROI", "claimRoiBtn");
      if (receipt) {
        try {
          const [newInfo, newReferral] = await Promise.all([
            gt.getStakeInfo(account),
            gt.userStakes(account),
          ]);
          const newTotalEarned = newInfo[2];
          const newReferralPending = newInfo[4];
          const earnedDifference = newTotalEarned - beforeTotalEarned;
          const referralDifference = newReferralPending - beforeReferral;
          let bonusDetails = "";
          if (referralDifference > 0n) {
            bonusDetails += `\n📤 Referral Bonus added: +${fmt(referralDifference)} ${tokenSymbol}`;
          }
          let referralTotal = 0n;
          let leaderBonus = 0n;
          let leaderAddress = "";
          if (receipt.logs && receipt.logs.length > 0) {
            const iface = new ethers.Interface(GT_ABI);
            for (const log of receipt.logs) {
              try {
                const parsed = iface.parseLog(log);
                if (parsed) {
                  if (parsed.name === "ReferralBonusDistributed") {
                    referralTotal = parsed.args[2] || 0n;
                  }
                  if (parsed.name === "LeaderBonusPaid") {
                    leaderBonus = parsed.args[2] || 0n;
                    leaderAddress = parsed.args[0] || "";
                  }
                }
              } catch {}
            }
          }
          let detailMessage = `✅ ROI ${fmt(roiAmount)} ${tokenSymbol} successfully claimed.`;
          if (referralTotal > 0n) {
            detailMessage += `\n📊 Referral Bonus distributed to 10 levels: ${fmt(referralTotal)} ${tokenSymbol}`;
          }
          if (leaderBonus > 0n && leaderAddress) {
            detailMessage += `\n👑 Leader Bonus sent to ${short(leaderAddress)}: ${fmt(leaderBonus)} ${tokenSymbol}`;
          }
          if (referralDifference > 0n) {
            detailMessage += `\n💼 Your referral bonus increased: +${fmt(referralDifference)} ${tokenSymbol}`;
          }
          detailMessage += `\n📈 Total earned: ${fmt(newTotalEarned)} / ${fmt(newInfo[1])} ${tokenSymbol}`;
          const pct =
            newInfo[1] > 0n
              ? Number((newTotalEarned * 10000n) / newInfo[1]) / 100
              : 0;
          detailMessage += `\n📊 Cap progress: ${pct.toFixed(2)}%`;
          notify(detailMessage, "ok", "🎉 ROI Claim Successful", 8000);
        } catch (detailError) {
          notify(
            `✅ ROI ${fmt(roiAmount)} ${tokenSymbol} successfully claimed.\n📤 Referral & leader bonuses automatically distributed according to the contract.`,
            "ok",
            "ROI Claim Successful",
            6000,
          );
        }
        clearCache();
        await refresh();
      }
    } catch (e) {
      notify(cleanError(e), "error", "ROI Claim Failed", 0);
    }
  }

  async function claimReferral() {
    if (!(await requireWallet())) return;
    if (isProcessing) {
      notify(
        "Please wait for the current process to finish.",
        "warn",
        "Processing",
        2000,
      );
      return;
    }
    if (cached.referral <= 0n) {
      notify("No pending referral bonus to claim.", "info", "No Bonus", 3000);
      return;
    }
    try {
      try {
        const txEstimate = await gt.claimReferralBonus.populateTransaction();
        const gasEstimate = await readProvider.estimateGas({
          to: CONFIG.stakingContract,
          data: txEstimate.data,
          from: account,
        });
        const feeData = await readProvider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
        const totalGas = gasEstimate * gasPrice;
        setGasEstimate(ethers.formatEther(totalGas), true);
      } catch {}
      const tx = await gt.claimReferralBonus();
      const receipt = await sendTransaction(
        tx,
        "Claim Referral Bonus",
        "claimReferralBtn",
      );
      if (receipt) {
        const referralAmount = cached.referral;
        notify(
          `✅ Referral Bonus ${fmt(referralAmount)} ${tokenSymbol} successfully claimed!`,
          "ok",
          "🎉 Referral Bonus Claim Successful",
          5000,
        );
        clearCache();
        await refresh();
      }
    } catch (e) {
      notify(cleanError(e), "error", "Referral Bonus Claim Failed", 0);
    }
  }

  async function copyReferral() {
    if (!(await requireWallet())) return;
    if (!account) {
      notify(
        "Please connect your wallet first.",
        "warn",
        "Wallet Required",
        3000,
      );
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("ref", account);
      const cleanUrl = url.origin + url.pathname + "?ref=" + account;
      await navigator.clipboard.writeText(cleanUrl);
      notify(
        "✅ Referral link copied!\n\n" + cleanUrl,
        "ok",
        "Referral Link Copied",
        5000,
      );
    } catch (e) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("ref", account);
        const text = url.toString();
        const input = document.createElement("input");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        notify(
          "✅ Referral link copied!\n\n" + text,
          "ok",
          "Referral Link Copied",
          5000,
        );
      } catch (fallbackError) {
        const manualUrl = new URL(window.location.href);
        manualUrl.searchParams.set("ref", account);
        notify(
          "Failed to copy link. Please copy it manually:\n\n" +
            manualUrl.toString(),
          "warn",
          "Copy Manually",
          8000,
        );
      }
    }
  }

  async function updateMinStake() {
    if (!(await requireOwner())) return;
    try {
      const v = ethers.parseUnits($("oMinStake").value.trim(), tokenDecimals);
      const tx = await gt.updateMinStake(v);
      await sendTransaction(tx, "Update Minimum Stake", "setMinStake");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Update Failed", 0);
    }
  }

  async function updateRoi() {
    if (!(await requireOwner())) return;
    try {
      const v = BigInt($("oRoi").value);
      const maxBps = BigInt(await gt.MAX_BPS());
      if (v < 0n || v > maxBps)
        throw new Error(`ROI BPS must be between 0 and ${maxBps}.`);
      const tx = await gt.updateDailyRoiBps(v);
      await sendTransaction(tx, "Update Daily ROI", "setRoi");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Update Failed", 0);
    }
  }

  async function updateLeaderBps() {
    if (!(await requireOwner())) return;
    try {
      const v = BigInt($("oLeaderBps").value);
      const maxBps = BigInt(await gt.MAX_BPS());
      if (v < 0n || v > maxBps)
        throw new Error(`Leader bonus BPS must be between 0 and ${maxBps}.`);
      const tx = await gt.updateLeaderBonusBps(v);
      await sendTransaction(tx, "Update Leader Bonus", "setLeaderBps");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Update Failed", 0);
    }
  }

  async function setLevels() {
    if (!(await requireOwner())) return;
    try {
      const arr = [];
      const maxBps = BigInt(await gt.MAX_BPS());
      let totalBps = 0n;
      const maxLevels = Number(await gt.MAX_REFERRAL_LEVELS());
      if (maxLevels !== 10)
        throw new Error(
          `Contract reports ${maxLevels} referral levels; UI expects the contract maximum of 10.`,
        );
      for (let i = 1; i <= maxLevels; i++) {
        const v = BigInt($(`lvl${i}`).value || "0");
        if (v < 0n || v > maxBps)
          throw new Error(`Level ${i} BPS must be between 0 and ${maxBps}.`);
        totalBps += v;
        arr.push(v);
      }
      if (totalBps > maxBps)
        throw new Error(
          `Total referral BPS cannot exceed ${maxBps}. Current total: ${totalBps}.`,
        );
      const tx = await gt.updateReferralLevels(arr);
      await sendTransaction(tx, "Update Referral Levels", "setLevels");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Update Failed", 0);
    }
  }

  async function setLeader() {
    if (!(await requireOwner())) return;
    try {
      const a = $("leaderAddress").value.trim();
      if (!validAddress(a)) throw new Error("Invalid leader address.");
      const status = $("leaderStatus").value === "true";
      const tx = await gt.setLeader(a, status);
      await sendTransaction(tx, "Update Leader Status", "setLeader");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Update Failed", 0);
    }
  }

  async function adminStake() {
    if (!(await requireOwner())) return;
    try {
      const user = $("adminUser").value.trim();
      const up = $("adminReferrer").value.trim() || ethers.ZeroAddress;
      if (
        !validAddress(user) ||
        (up !== ethers.ZeroAddress && !validAddress(up))
      ) {
        throw new Error("Invalid address.");
      }
      const amount = ethers.parseUnits(
        $("adminAmount").value.trim(),
        tokenDecimals,
      );
      if (amount <= 0n) throw new Error("Amount must be greater than zero.");
      const tx = await gt.adminStake(user, amount, up);
      await sendTransaction(tx, "Admin Stake", "adminStake");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Admin Stake Failed", 0);
    }
  }

  async function recoverERC20() {
    if (!(await requireOwner())) return;
    try {
      const address = $("recoverToken").value.trim();
      if (!validAddress(address)) throw new Error("Invalid token address.");
      const c = new ethers.Contract(address, ERC20_ABI, signer);
      const decimals = Number(await c.decimals());
      const amount = ethers.parseUnits(
        $("recoverAmount").value.trim(),
        decimals,
      );
      const tx = await gt.recoverERC20(address, amount);
      await sendTransaction(tx, "Recover ERC-20", "recoverBtn");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Recovery Failed", 0);
    }
  }

  async function renounceOwnership() {
    if (!(await requireOwner())) return;
    const confirmed = await notifyConfirm(
      "You are about to permanently renounce ownership of the contract.\n\nAfter confirmation, owner-only functions can no longer be used by anyone. This action cannot be undone.",
      "Renounce Ownership",
      "RENOUNCE OWNERSHIP",
    );
    if (!confirmed) return;
    try {
      const tx = await gt.renounceOwnership();
      await sendTransaction(tx, "Renounce Ownership", "renounceOwnershipBtn");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Renounce Ownership Failed", 0);
    }
  }

  async function transferOwnership() {
    if (!(await requireOwner())) return;
    const newOwner = $("transferOwnerAddress").value.trim();
    if (!validAddress(newOwner)) {
      notify("Invalid new owner address.", "error", "Input Error", 0);
      return;
    }
    if (newOwner.toLowerCase() === account.toLowerCase()) {
      notify(
        "New owner cannot be the current owner.",
        "warn",
        "Input Error",
        0,
      );
      return;
    }
    const confirmed = await notifyConfirm(
      `Transfer contract ownership to:\n${newOwner}\n\nAfter confirmation, only the new owner will be able to use owner-only functions.`,
      "Transfer Ownership",
      "TRANSFER OWNERSHIP",
    );
    if (!confirmed) return;
    try {
      const tx = await gt.transferOwnership(newOwner);
      await sendTransaction(tx, "Transfer Ownership", "transferOwnershipBtn");
      clearCache();
      await refresh();
    } catch (e) {
      notify(cleanError(e), "error", "Transfer Ownership Failed", 0);
    }
  }

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  function showTab(name) {
    document.querySelectorAll(".section").forEach((section) => {
      section.classList.toggle("active", section.id === name);
    });

    document
      .querySelectorAll("#navBar .tab, #statsNav .tab")
      .forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === name);
      });

    const section = document.getElementById(name);
    if (name === "network" && account && gt) {
      void refreshExtendedNetwork(false);
    }
    if (section) {
      const header = document.querySelector("header");
      const headerHeight = header ? header.offsetHeight : 0;
      const sectionTop =
        section.getBoundingClientRect().top + window.pageYOffset;

      requestAnimationFrame(() => {
        window.scrollTo({
          top: sectionTop - headerHeight - 15,
          behavior: "smooth",
        });
      });
    }
  }

  window.showTab = showTab;

  // ============================================================
  // POLLING
  // ============================================================
  function startPolling() {
    clearInterval(refreshTimer);
    clearInterval(liveTimer);
    refreshTimer = setInterval(async () => {
      if (!account) return;
      const accounts = await window.ethereum
        ?.request({ method: "eth_accounts" })
        .catch(() => []);
      if (
        !accounts?.length ||
        accounts[0].toLowerCase() !== account.toLowerCase()
      ) {
        disconnectUI();
        return;
      }
      await refresh();
    }, CONFIG.refreshInterval);
    liveTimer = setInterval(refreshUserOnChain, CONFIG.pollingInterval);
    startHeartbeat();
  }

  // ============================================================
  // WALLET EVENTS
  // ============================================================
  function setupWalletEvents() {
    if (!window.ethereum) return;
    window.ethereum.on?.("accountsChanged", async (accounts) => {
      connectionGeneration++;
      if (!accounts?.length) {
        disconnectUI();
        notify(
          "Wallet has been disconnected from this app.",
          "info",
          "Wallet Disconnected",
          3500,
        );
        return;
      }
      await syncWalletState(false);
    });
    window.ethereum.on?.("chainChanged", async (chainId) => {
      connectionGeneration++;
      const id = Number(BigInt(chainId));
      if (id !== CONFIG.chainId) {
        account = null;
        signer = null;
        gt = null;
        token = null;
        clearUserUI();
        setWalletState(
          "yellow",
          '<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;Switch Network',
        );
        notify(
          `Please switch your wallet to ${CONFIG.chainName}.`,
          "warn",
          "Wrong Network",
          0,
        );
        return;
      }
      await syncWalletState(false);
    });
  }

  // ============================================================
  // CALCULATOR
  // ============================================================
  function calculateStaking() {
    const amountInput = document.getElementById("calcAmount");
    const roiInput = document.getElementById("calcRoi");
    const maxCapInput = document.getElementById("calcMaxCapPct");
    const downlineStakeInput = document.getElementById("calcDownlineStake");
    const includeReferral =
      document.getElementById("calcIncludeReferral").value === "true";
    const resultsDiv = document.getElementById("calcResults");

    const downlineCounts = [];
    for (let i = 1; i <= 10; i++) {
      const el = document.getElementById("calcDl" + i);
      downlineCounts.push(parseInt(el.value) || 0);
    }

    const amount = parseFloat(amountInput.value) || 0;
    const roiDailyPercent = parseFloat(roiInput.value) || 0.3;
    const maxCapPercent = parseFloat(maxCapInput.value) || 200;
    const downlineStake = parseFloat(downlineStakeInput.value) || 0;

    if (amount <= 0) {
      resultsDiv.innerHTML = `<div class="notice warn" style="text-align:center;padding:12px;font-size:10px;border-radius:var(--radius);"><i class="fa-solid fa-triangle-exclamation"></i> Enter a valid stake amount (greater than 0).</div>`;
      return;
    }

    const roiDaily = amount * (roiDailyPercent / 100);
    const maxCap = amount * (maxCapPercent / 100);

    const referralLevels =
      cached.levels.length > 0
        ? cached.levels.map((bps, index) => ({
            level: index + 1,
            bps: Number(bps),
            pct: Number(bps) / 100,
          }))
        : [
            { level: 1, bps: 1000, pct: 10 },
            { level: 2, bps: 300, pct: 3 },
            { level: 3, bps: 200, pct: 2 },
            { level: 4, bps: 150, pct: 1.5 },
            { level: 5, bps: 100, pct: 1 },
            { level: 6, bps: 75, pct: 0.75 },
            { level: 7, bps: 60, pct: 0.6 },
            { level: 8, bps: 50, pct: 0.5 },
            { level: 9, bps: 40, pct: 0.4 },
            { level: 10, bps: 25, pct: 0.25 },
          ];

    const downlineRoiDaily = downlineStake * (roiDailyPercent / 100);

    let totalReferralAllLevels = 0;
    let totalDownlineCount = 0;
    let levelDetails = [];

    referralLevels.forEach((level, index) => {
      const count = downlineCounts[index] || 0;
      totalDownlineCount += count;
      const referralPerDownline = (downlineRoiDaily * level.bps) / 10000;
      const totalReferral = referralPerDownline * count;
      totalReferralAllLevels += totalReferral;
      levelDetails.push({
        level: level.level,
        pct: level.pct,
        bps: level.bps,
        count: count,
        referralPerDownline: referralPerDownline,
        totalReferral: totalReferral,
      });
    });

    const dailyEarningWithReferral = includeReferral
      ? roiDaily + totalReferralAllLevels
      : roiDaily;
    const daysToMaxCap = Math.ceil(maxCap / dailyEarningWithReferral);

    const earnings = {
      daily: dailyEarningWithReferral,
      weekly: dailyEarningWithReferral * 7,
      monthly: dailyEarningWithReferral * 30,
      yearly: dailyEarningWithReferral * 365,
    };

    const roiOnly = {
      daily: roiDaily,
      weekly: roiDaily * 7,
      monthly: roiDaily * 30,
      yearly: roiDaily * 365,
    };

    const fmtNum = (num) => {
      if (num >= 1000)
        return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return num.toFixed(4);
    };

    const levelDisplay = referralLevels
      .map((l) => `L${l.level}: ${l.pct}%`)
      .join(" | ");

    let referralHtml = "";
    if (includeReferral && totalDownlineCount > 0) {
      referralHtml = `
                            <div class="calc-referral-dash">
                                <div class="title"><i class="fa-solid fa-users"></i> Referral Bonus per Day (${totalDownlineCount} active downlines)</div>
                                <div style="font-size:10px;color:var(--muted2);margin-bottom:4px;">
                                    Each downline stakes <strong>${fmtNum(downlineStake)} MEGAH</strong> → Daily ROI <strong>${fmtNum(downlineRoiDaily)} MEGAH</strong>
                                </div>
                                <div class="levels" style="grid-template-columns:repeat(5,1fr);">
                                    ${levelDetails
                                      .map(
                                        (l) => `
                                            <div class="lvl" style="${l.count === 0 ? "opacity:0.4;" : ""}">
                                                <span>L${l.level}</span>
                                                <span style="color:var(--green);">${l.pct}%</span>
                                                <span style="font-size:7px;color:var(--muted2);">${l.count}</span>
                                                <span style="font-size:7px;color:var(--text2);">+${fmtNum(l.totalReferral)}</span>
                                            </div>
                                        `,
                                      )
                                      .join("")}
                                </div>
                                <div class="total-referral" style="margin-top:4px;">
                                    <span>Total Referral Bonus per Day</span>
                                    <span style="font-size:13px;">${fmtNum(totalReferralAllLevels)} MEGAH</span>
                                </div>
                            </div>
                        `;
    } else if (includeReferral && totalDownlineCount === 0) {
      referralHtml = `<div class="notice warn small" style="margin-top:6px;font-size:9px;"><i class="fa-solid fa-info-circle"></i>&nbsp; No active downlines. Enter the number of downlines in each level to see the referral effect.</div>`;
    }

    const resultsHtml = `
                        <div style="margin-bottom:6px;font-size:9px;color:var(--muted2);text-align:center;border-bottom:1px solid rgba(245,158,11,0.06);padding-bottom:4px;">
                            📊 Referral Levels: ${levelDisplay}
                        </div>
                        <div class="calc-result-grid">
                            <div class="calc-result-item highlight">
                                <div class="label">⏱️ Cap Reached</div>
                                <div class="value green">${daysToMaxCap} Days</div>
                                <div class="sub">${includeReferral ? "With Referral" : "ROI Only"}</div>
                            </div>
                            <div class="calc-result-item highlight">
                                <div class="label">🎯 Max Cap</div>
                                <div class="value green">${fmtNum(maxCap)}</div>
                                <div class="sub">${maxCapPercent}% of ${fmtNum(amount)}</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">📅 Daily ROI</div>
                                <div class="value gold">${fmtNum(roiDaily)}</div>
                                <div class="sub">${roiDailyPercent}%</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">${includeReferral ? "📊 Total Daily" : "📊 Daily"}</div>
                                <div class="value blue">${fmtNum(dailyEarningWithReferral)}</div>
                                <div class="sub">${includeReferral ? `+${fmtNum(totalReferralAllLevels)} ref` : "ROI only"}</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">📆 1 Week</div>
                                <div class="value">${fmtNum(earnings.weekly)}</div>
                                <div class="sub">${includeReferral ? "with referral" : "ROI"}</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">📆 1 Month</div>
                                <div class="value">${fmtNum(earnings.monthly)}</div>
                                <div class="sub">${includeReferral ? "with referral" : "ROI"}</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">📆 1 Year</div>
                                <div class="value">${fmtNum(earnings.yearly)}</div>
                                <div class="sub">${includeReferral ? "with referral" : "ROI"}</div>
                            </div>
                            <div class="calc-result-item">
                                <div class="label">ROI Only</div>
                                <div class="value" style="color:var(--muted2);">${fmtNum(roiOnly.daily)}</div>
                                <div class="sub">daily</div>
                            </div>
                        </div>
                        <div class="calc-summary-dash">
                            <p><strong>Your Stake:</strong> ${fmtNum(amount)} MEGAH → Daily ROI <strong>${fmtNum(roiDaily)} MEGAH</strong></p>
                            ${
                              includeReferral && totalDownlineCount > 0
                                ? `
                                <p style="margin-top:3px;">
                                    <strong>${totalDownlineCount} downlines</strong> → Daily Referral <strong>${fmtNum(totalReferralAllLevels)} MEGAH</strong>
                                    <span style="font-size:9px;color:var(--muted);display:block;">Cap in <strong class="highlight-text">${daysToMaxCap} days</strong></span>
                                </p>
                            `
                                : ""
                            }
                        </div>
                        ${referralHtml}
                    `;
    resultsDiv.innerHTML = resultsHtml;
  }

  // ============================================================
  // DISCLAIMER POPUP
  // ============================================================
  function setupDisclaimerPopup() {
    const popup = document.getElementById("disclaimerPopup");
    const acceptBtn = document.getElementById("disclaimerAccept");
    const hasSeenPopup = sessionStorage.getItem("megah_disclaimer_seen");

    if (!hasSeenPopup) {
      setTimeout(function () {
        popup.classList.add("show");
        document.body.classList.add("modal-open");
      }, 15000);
    }

    acceptBtn.addEventListener("click", function () {
      popup.classList.remove("show");
      document.body.classList.remove("modal-open");
      sessionStorage.setItem("megah_disclaimer_seen", "true");
    });

    popup.addEventListener("click", function (e) {
      if (e.target === popup) {
        popup.classList.remove("show");
        document.body.classList.remove("modal-open");
        sessionStorage.setItem("megah_disclaimer_seen", "true");
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && popup.classList.contains("show")) {
        popup.classList.remove("show");
        document.body.classList.remove("modal-open");
        sessionStorage.setItem("megah_disclaimer_seen", "true");
      }
    });
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    try {
      buildLevelInputs();
      setupWalletEvents();
      setupDisclaimerPopup();

      document.querySelectorAll("#navBar .tab").forEach((button) => {
        button.addEventListener("click", () => showTab(button.dataset.tab));
      });

      document
        .querySelectorAll(".hero-actions button[data-tab]")
        .forEach((btn) => {
          btn.addEventListener("click", () => showTab(btn.dataset.tab));
        });

      $("connectBtn").addEventListener("click", async () => {
        if (isProcessing) {
          notify(
            "Please wait for the current process to finish.",
            "warn",
            "Processing",
            2000,
          );
          return;
        }
        if (account) {
          const ok = await syncWalletState(false);
          if (ok) {
            disconnectUI();
            notify(
              "Wallet disconnected from the app interface.",
              "ok",
              "Disconnected",
              3500,
            );
            return;
          }
        }
        await connect();
      });

      $("approveBtn").addEventListener("click", approve);
      $("stakeBtn").addEventListener("click", stake);
      $("maxBtn").addEventListener("click", maxAmount);
      $("claimRoiBtn").addEventListener("click", claimRoi);
      $("claimReferralBtn").addEventListener("click", claimReferral);
      $("copyReferral").addEventListener("click", copyReferral);

      $("setMinStake").addEventListener("click", updateMinStake);
      $("setRoi").addEventListener("click", updateRoi);
      $("setLeaderBps").addEventListener("click", updateLeaderBps);
      $("setLeader").addEventListener("click", setLeader);
      $("setLevels").addEventListener("click", setLevels);
      $("adminStake").addEventListener("click", adminStake);
      $("recoverBtn").addEventListener("click", recoverERC20);
      $("renounceOwnershipBtn").addEventListener("click", renounceOwnership);
      $("transferOwnershipBtn").addEventListener("click", transferOwnership);

      $("stakeAmount").addEventListener("input", function () {
        this.classList.remove("input-error");
        const val = this.value.trim();
        const validation = validateAmountInput(val);

        if (validation.valid) {
          $("stakeAmountError").style.display = "none";
          checkAllowance();
        } else {
          toggleStakeButtons(false);
          if (val) {
            $("stakeAmountError").textContent = validation.message;
            $("stakeAmountError").style.display = "block";
          } else {
            $("stakeAmountError").style.display = "none";
          }
        }
      });

      $("refreshBtn").addEventListener("click", async function () {
        if (!account) {
          notify(
            "Please connect your wallet first.",
            "warn",
            "Wallet Required",
            3000,
          );
          return;
        }
        const btn = $("refreshBtn");
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-small"></span>&nbsp;Loading...';
        try {
          clearCache();
          await refresh();
          await refreshNetworkIfVisible(true);
          const now = new Date();
          const timeStr = now.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          const timeEl = $("lastRefreshTime");
          if (timeEl) {
            timeEl.textContent = `Last refresh: ${timeStr}`;
          }
          notify(
            "✅ On-chain data successfully updated!",
            "ok",
            "Refresh Successful",
            2500,
          );
        } catch (e) {
          notify(
            "Failed to refresh data: " + cleanError(e),
            "error",
            "Refresh Failed",
            3000,
          );
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });

      await initReadProvider();

      let providerReady = false;
      for (let i = 0; i < 20; i++) {
        if (window.ethereum) {
          try {
            await window.ethereum.request({ method: "eth_chainId" });
            providerReady = true;
            break;
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      const accounts = await window.ethereum
        ?.request({ method: "eth_accounts" })
        .catch(() => []);
      if (accounts?.length && providerReady) {
        await syncWalletState(false);
      } else if (accounts?.length && !providerReady) {
        console.log(
          "Provider not ready yet, waiting for accountsChanged event",
        );
      } else {
        setWalletState(
          "red",
          '<i class="fa-solid fa-plug"></i>&nbsp;Connect Wallet',
        );
      }

      const ref = new URLSearchParams(location.search).get("ref");
      if (ref && validAddress(ref)) {
        $("referrer").value = ref;
      }
    } catch (e) {
      console.error("App initialization", e);
      console.warn("Non-critical init error:", cleanError(e));
    }
  }

  // ============================================================
  // DOM READY
  // ============================================================
  document.addEventListener("DOMContentLoaded", function () {
    const prev = $("downlinePrev"),
      next = $("downlineNext"),
      refreshNetwork = $("refreshNetworkBtn"),
      inspect = $("inspectRefPairBtn");
    prev?.addEventListener("click", async () => {
      if (downlineOffset >= DOWNLINE_PAGE_SIZE) {
        downlineOffset -= DOWNLINE_PAGE_SIZE;
        await loadDownlinesPage();
      }
    });
    next?.addEventListener("click", async () => {
      if (downlineOffset + DOWNLINE_PAGE_SIZE < referralNetwork.length) {
        downlineOffset += DOWNLINE_PAGE_SIZE;
        await loadDownlinesPage();
      }
    });
    refreshNetwork?.addEventListener("click", () =>
      refreshExtendedNetwork(true),
    );
    inspect?.addEventListener("click", inspectReferralPair);
    $("refPairWallet")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") inspectReferralPair();
    });

    init();

    setTimeout(() => {
      if (typeof calculateStaking === "function") {
        calculateStaking();
      }
    }, 500);

    const calcBtn = document.getElementById("calcBtn");
    const calcAmount = document.getElementById("calcAmount");
    const calcInclude = document.getElementById("calcIncludeReferral");
    const calcDownlineStake = document.getElementById("calcDownlineStake");

    if (calcBtn) {
      calcBtn.addEventListener("click", calculateStaking);
    }

    let calcTimeout;
    const inputs = [
      "calcAmount",
      "calcDownlineStake",
      "calcDl1",
      "calcDl2",
      "calcDl3",
      "calcDl4",
      "calcDl5",
      "calcDl6",
      "calcDl7",
      "calcDl8",
      "calcDl9",
      "calcDl10",
    ];

    inputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", () => {
          clearTimeout(calcTimeout);
          calcTimeout = setTimeout(calculateStaking, 500);
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") calculateStaking();
        });
      }
    });

    if (calcInclude) {
      calcInclude.addEventListener("change", calculateStaking);
    }
  });
})();
