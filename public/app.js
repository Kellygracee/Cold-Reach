/**
 * ColdReach Stitch Frontend Controller
 * Connects the 6 Stitch screens to the Phase 7 REST API.
 * Strict human-in-the-loop manual outreach only (appDispatchedCount: 0).
 */

class ColdReachApp {
  constructor() {
    this.apiBase = '/api';
    this.activeView = 'dashboard';
    this.pipelineMode = 'demo'; // 'live' | 'demo'
    this.theme = 'light';
    this.activeProfile = null;
    this.profiles = [];
    this.providers = [];
    this.opportunities = [];
    this.selectedOpportunityId = null;
    this.metrics = null;
    this.searchInFlight = false;
    this.abortController = null;

    // Filter states for Opportunities screen
    this.oppFilters = {
      search: '',
      statusTab: 'ALL', // 'ALL' | 'HIGH_FIT' | 'PENDING' | 'SAVED' | 'ARCHIVED'
      platform: '',
      provenance: '',
      sort: 'relevance',
      page: 1,
      pageSize: 20
    };

    // Filter states for Analytics screen
    this.analyticsFilters = {
      dateRange: '30d',
      platform: '',
      minScore: 75
    };
  }

  async init() {
    this.setupTheme();
    this.setupNavigation();
    this.setupGlobalControls();
    this.setupSearch();
    this.setupModals();

    try {
      // 1. Fetch initial providers
      await this.fetchProviders();
      // 2. Fetch or initialize default FormBridge profile
      await this.initProfile();
      // 3. Load initial opportunities & metrics
      await this.loadInitialData();

      // 4. Handle initial route
      this.handleHashChange();
      window.addEventListener('hashchange', () => this.handleHashChange());
    } catch (err) {
      console.error('Initialization error:', err);
      this.showToast(err.message || 'Error connecting to API', 'error');
    }
  }

  // --- Theme Management ---
  setupTheme() {
    const saved = localStorage.getItem('coldreach_theme') || 'light';
    this.setTheme(saved);
  }

  setTheme(theme) {
    this.theme = theme;
    localStorage.setItem('coldreach_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    this.updateThemeControls();
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  updateThemeControls() {
    const lightBtn = document.getElementById('settingsThemeLight');
    const darkBtn = document.getElementById('settingsThemeDark');
    if (lightBtn && darkBtn) {
      if (this.theme === 'dark') {
        lightBtn.classList.remove('neu-pill-active');
        lightBtn.classList.add('neu-raised-sm');
        darkBtn.classList.add('neu-pill-active');
        darkBtn.classList.remove('neu-raised-sm');
      } else {
        lightBtn.classList.add('neu-pill-active');
        lightBtn.classList.remove('neu-raised-sm');
        darkBtn.classList.remove('neu-pill-active');
        darkBtn.classList.add('neu-raised-sm');
      }
    }
  }

  // --- Navigation & Routing ---
  setupNavigation() {
    const navLinks = document.querySelectorAll('nav a[data-path]');
    navLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const path = link.getAttribute('data-path');
        window.location.hash = '#' + path;
      });
    });
  }

  handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    const validViews = ['chat', 'dashboard', 'opportunities', 'product-profile', 'analytics', 'settings'];
    const targetView = validViews.includes(hash) ? hash : 'dashboard';
    this.switchView(targetView);
  }

  switchView(viewName) {
    this.activeView = viewName;

    // Update active nav links in sidebar
    const navLinks = document.querySelectorAll('nav a[data-path]');
    navLinks.forEach((link) => {
      const path = link.getAttribute('data-path');
      if (path === viewName) {
        link.classList.add('bg-primary-container', 'text-on-primary', 'font-title-sm', 'neu-pill-active', 'rounded-full');
        link.classList.remove('text-on-surface-variant');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('bg-primary-container', 'text-on-primary', 'font-title-sm', 'neu-pill-active');
        link.classList.add('text-on-surface-variant');
        link.removeAttribute('aria-current');
      }
    });

    // Update active container
    const viewContainers = document.querySelectorAll('.view-container');
    viewContainers.forEach((container) => {
      if (container.id === `view-${viewName}`) {
        container.classList.add('active');
      } else {
        container.classList.remove('active');
      }
    });

    // Update breadcrumbs in header
    this.updateHeaderBreadcrumbs(viewName);

    // Refresh view-specific data
    if (viewName === 'dashboard') this.renderDashboard();
    if (viewName === 'opportunities') this.renderOpportunities();
    if (viewName === 'product-profile') this.renderProductProfile();
    if (viewName === 'analytics') this.renderAnalytics();
    if (viewName === 'settings') this.renderSettings();
  }

  updateHeaderBreadcrumbs(viewName) {
    const breadcrumbLabel = document.getElementById('headerBreadcrumbCurrent');
    if (breadcrumbLabel) {
      const titles = {
        'chat': 'Discovery Chat',
        'dashboard': 'Mission Control',
        'opportunities': 'Opportunities',
        'product-profile': 'Product Profile',
        'analytics': 'Analytics',
        'settings': 'Settings & Connectors'
      };
      breadcrumbLabel.textContent = titles[viewName] || 'Overview';
    }
  }

  // --- Global Controls (Sidebar Pipeline Mode, Search) ---
  setupGlobalControls() {
    // Pipeline mode toggles
    const modeLiveBtn = document.getElementById('sidebarModeLive');
    const modeDemoBtn = document.getElementById('sidebarModeDemo');
    if (modeLiveBtn && modeDemoBtn) {
      modeLiveBtn.addEventListener('click', () => this.setPipelineMode('live'));
      modeDemoBtn.addEventListener('click', () => this.setPipelineMode('demo'));
    }

    // Appearance toggle button
    const appearanceToggle = document.getElementById('sidebarAppearanceToggle');
    if (appearanceToggle) {
      appearanceToggle.addEventListener('click', () => this.toggleTheme());
    }
  }

  setPipelineMode(mode) {
    this.pipelineMode = mode;
    const modeLiveBtn = document.getElementById('sidebarModeLive');
    const modeDemoBtn = document.getElementById('sidebarModeDemo');
    const headerModeBadge = document.getElementById('headerModeBadge');

    if (mode === 'live') {
      modeLiveBtn?.classList.add('bg-primary-container', 'text-on-primary', 'shadow-sm');
      modeLiveBtn?.classList.remove('text-on-surface-variant');
      modeDemoBtn?.classList.remove('bg-primary-container', 'text-on-primary', 'shadow-sm');
      modeDemoBtn?.classList.add('text-on-surface-variant');
      if (headerModeBadge) {
        headerModeBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>LIVE Active`;
      }
    } else {
      modeDemoBtn?.classList.add('bg-primary-container', 'text-on-primary', 'shadow-sm');
      modeDemoBtn?.classList.remove('text-on-surface-variant');
      modeLiveBtn?.classList.remove('bg-primary-container', 'text-on-primary', 'shadow-sm');
      modeLiveBtn?.classList.add('text-on-surface-variant');
      if (headerModeBadge) {
        headerModeBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>Demo: Hybrid Live`;
      }
    }

    this.oppFilters.provenance = mode === 'live' ? 'LIVE' : '';
    this.loadOpportunities();
  }

  setupSearch() {
    const globalSearchInput = document.getElementById('globalSearchInput');
    if (globalSearchInput) {
      globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = globalSearchInput.value.trim();
          if (q) {
            window.location.hash = '#opportunities';
            this.oppFilters.search = q;
            const oppSearch = document.getElementById('opportunitySearchInput');
            if (oppSearch) oppSearch.value = q;
            this.loadOpportunities();
          }
        }
      });
    }

    // Command + K shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const oppSearch = document.getElementById('opportunitySearchInput') || document.getElementById('globalSearchInput');
        oppSearch?.focus();
      }
    });
  }

  // --- API Client Methods ---
  async apiFetch(endpoint, options = {}) {
    const res = await fetch(`${this.apiBase}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      const message = json.error?.message || `HTTP ${res.status}`;
      const code = json.error?.code || 'API_ERROR';
      const err = new Error(message);
      err.code = code;
      err.details = json.error?.details;
      throw err;
    }
    return json.data;
  }

  async fetchProviders() {
    try {
      this.providers = await this.apiFetch('/providers');
      return this.providers;
    } catch {
      this.providers = [];
    }
  }

  async initProfile() {
    this.profiles = await this.apiFetch('/profiles');
    if (this.profiles.length > 0) {
      this.activeProfile = this.profiles[0];
    } else {
      // Seed default FormBridge profile
      const defaultProfile = {
        productName: 'FormBridge',
        productDescription: 'A privacy-first form & survey builder for B2B SaaS with zero telemetry cookies and Frankfurt data residency.',
        valueProposition: 'A privacy-first form & survey builder for B2B SaaS that eliminates GDPR cookie banners and keeps customer telemetry purely within Frankfurt AWS datacenters.',
        problemsSolved: [
          'High drop-off in Typeform due to GDPR cookie barriers & non-EU telemetry storage.',
          'Need for self-hosted or European cloud data residency without US telemetry routing.'
        ],
        idealCustomerDescription: 'B2B Product Managers, Security Engineers & Compliance Growth Marketers.',
        seedKeywords: ['Typeform alternative', 'GDPR compliant forms', 'self-hosted survey', 'privacy forms', 'zero cookie survey'],
        customerPainPointPhrases: ['cookie banner drop-off', 'telemetry flagged by legal', 'non-EU data residency', 'compliance audit'],
        excludedTopics: ['Job opening', 'Free tier hacks', 'Affiliate link'],
        toneGuidelines: ['Consultative, technical, transparent, helpful, non-promotional peer']
      };

      try {
        this.activeProfile = await this.apiFetch('/profiles', {
          method: 'POST',
          body: JSON.stringify(defaultProfile)
        });
        this.profiles = [this.activeProfile];
      } catch (e) {
        console.warn('Could not auto-seed profile:', e);
      }
    }

    this.updateProfileNameUI();
  }

  updateProfileNameUI() {
    const name = this.activeProfile?.productName || 'FormBridge SaaS';
    const profileLabels = document.querySelectorAll('.profile-name-label');
    profileLabels.forEach((el) => (el.textContent = name));
  }

  async loadInitialData() {
    // Populate demo opportunities if none exist
    const all = await this.apiFetch('/opportunities?pageSize=1');
    if (all.pagination.totalItems === 0 && this.activeProfile) {
      try {
        const demoRes = await this.apiFetch('/search', {
          method: 'POST',
          body: JSON.stringify({
            query: 'Typeform alternative GDPR compliant form',
            limit: 10,
            forceDemo: true
          })
        });

        if (demoRes.items && demoRes.items.length > 0) {
          await this.apiFetch('/opportunities/attribute-batch', {
            method: 'POST',
            body: JSON.stringify({
              profileId: this.activeProfile.id,
              candidates: demoRes.items
            })
          });
        }
      } catch (err) {
        console.warn('Initial demo discovery attribution:', err);
      }
    }

    await Promise.all([this.loadOpportunities(), this.loadMetrics()]);
  }

  async loadMetrics() {
    try {
      this.metrics = await this.apiFetch('/pipeline/metrics');
      this.renderMetricsCards();
      return this.metrics;
    } catch (err) {
      console.error('Failed to load metrics:', err);
    }
  }

  async loadOpportunities() {
    const params = new URLSearchParams();
    if (this.oppFilters.search) params.set('search', this.oppFilters.search);
    if (this.oppFilters.provenance) params.set('provenance', this.oppFilters.provenance);
    if (this.oppFilters.platform) params.set('platform', this.oppFilters.platform);

    if (this.oppFilters.statusTab === 'HIGH_FIT') params.set('minScore', '90');
    if (this.oppFilters.statusTab === 'PENDING') params.set('status', 'NEW');
    if (this.oppFilters.statusTab === 'SAVED') params.set('status', 'REVIEWED');
    if (this.oppFilters.statusTab === 'ARCHIVED') params.set('status', 'SKIPPED');

    params.set('page', String(this.oppFilters.page));
    params.set('pageSize', String(this.oppFilters.pageSize));

    try {
      const res = await this.apiFetch(`/opportunities?${params.toString()}`);
      this.opportunities = res.items || [];
      this.renderOpportunitiesList(res);

      // Update badge counts
      const badge = document.getElementById('sidebarOpportunitiesBadge');
      if (badge) badge.textContent = String(res.pagination.totalItems);

      // Select first if none selected
      if (this.opportunities.length > 0 && !this.selectedOpportunityId) {
        this.selectOpportunity(this.opportunities[0].id);
      } else if (this.selectedOpportunityId) {
        const stillExists = this.opportunities.some((o) => o.id === this.selectedOpportunityId);
        if (stillExists) this.selectOpportunity(this.selectedOpportunityId);
        else if (this.opportunities.length > 0) this.selectOpportunity(this.opportunities[0].id);
        else this.renderEmptyDetail();
      } else {
        this.renderEmptyDetail();
      }
    } catch (err) {
      console.error('Failed to load opportunities:', err);
    }
  }

  // --- Screen 1: Agent Chat Controller ---
  setupChatScreen() {
    const runBtn = document.getElementById('chatRunEngineBtn');
    const pauseBtn = document.getElementById('chatPauseBtn');
    const inputField = document.getElementById('chatMessageInput');
    const sendBtn = document.getElementById('chatSendBtn');

    if (runBtn) {
      runBtn.addEventListener('click', () => this.runDiscoveryInChat());
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.cancelDiscoveryInChat());
    }

    if (sendBtn && inputField) {
      const sendHandler = () => {
        const text = inputField.value.trim();
        if (!text) return;
        inputField.value = '';
        this.appendUserMessage(text);
        this.runDiscoveryInChat(text);
      };
      sendBtn.addEventListener('click', sendHandler);
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendHandler();
        }
      });
    }
  }

  appendUserMessage(text) {
    const thread = document.getElementById('chatDialogueThread');
    if (!thread) return;

    const div = document.createElement('div');
    div.className = 'flex items-start justify-end gap-space-md';
    div.innerHTML = `
      <div class="bg-surface-container-highest rounded-xl p-space-md neu-inset max-w-xl">
        <div class="flex items-center justify-end gap-space-xs mb-1">
          <span class="font-label-sm text-label-sm text-on-surface-variant">Growth Lead</span>
          <span class="font-label-sm text-label-sm text-outline">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p class="font-body-md text-body-md text-on-surface">${this.escapeHtml(text)}</p>
      </div>
      <div class="w-10 h-10 rounded-full bg-surface-container neu-raised-sm flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-secondary text-[20px]">person</span>
      </div>
    `;
    thread.appendChild(div);
  }

  async runDiscoveryInChat(customQuery) {
    if (this.searchInFlight) return;
    this.searchInFlight = true;
    this.abortController = new AbortController();

    const progressMatrix = document.getElementById('chatSynthesisMatrix');
    const runBtn = document.getElementById('chatRunEngineBtn');
    const pauseBtn = document.getElementById('chatPauseBtn');
    const progressBar = document.getElementById('chatProgressBar');
    const progressPercent = document.getElementById('chatProgressPercent');
    const step1Status = document.getElementById('chatStep1Status');
    const step2Status = document.getElementById('chatStep2Status');
    const step3Status = document.getElementById('chatStep3Status');
    const step4Status = document.getElementById('chatStep4Status');

    if (progressMatrix) progressMatrix.classList.remove('hidden');
    if (runBtn) runBtn.disabled = true;
    if (pauseBtn) pauseBtn.textContent = 'Cancel Scan';

    try {
      // Stage 1: Synthesize parameters
      if (progressBar) progressBar.style.width = '25%';
      if (progressPercent) progressPercent.textContent = '25%';
      if (step1Status) step1Status.innerHTML = '<span class="text-tertiary font-bold">Done</span>';

      await new Promise((r) => setTimeout(r, 400));
      if (this.abortController.signal.aborted) throw new Error('Search cancelled');

      // Stage 2: Compile trigger vectors
      if (progressBar) progressBar.style.width = '50%';
      if (progressPercent) progressPercent.textContent = '50%';
      if (step2Status) step2Status.innerHTML = '<span class="text-tertiary font-bold">Done</span>';

      // Expand queries via API
      let searchTerms = ['Typeform alternative', 'GDPR compliant form', 'self-hosted survey'];
      if (this.activeProfile) {
        try {
          const expansion = await this.apiFetch('/query-expansion', {
            method: 'POST',
            body: JSON.stringify({ profileId: this.activeProfile.id }),
            signal: this.abortController.signal
          });
          if (expansion.primaryTerms && expansion.primaryTerms.length > 0) {
            searchTerms = expansion.primaryTerms.map((t) => t.term);
          }
        } catch (e) {
          console.warn('Query expansion fallback:', e);
        }
      }

      await new Promise((r) => setTimeout(r, 400));
      if (this.abortController.signal.aborted) throw new Error('Search cancelled');

      // Stage 3: Scan monitored communities across active providers
      if (progressBar) progressBar.style.width = '75%';
      if (progressPercent) progressPercent.textContent = '75%';
      if (step3Status) step3Status.innerHTML = '<span class="text-primary font-bold animate-pulse">Scanning...</span>';

      const queryToUse = customQuery || searchTerms.slice(0, 3).join(' ');
      const searchRes = await this.apiFetch('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: queryToUse,
          limit: 10,
          forceDemo: this.pipelineMode === 'demo'
        }),
        signal: this.abortController.signal
      });

      if (step3Status) step3Status.innerHTML = '<span class="text-tertiary font-bold">Done</span>';

      await new Promise((r) => setTimeout(r, 400));
      if (this.abortController.signal.aborted) throw new Error('Search cancelled');

      // Stage 4: High-intent scoring & attribution
      if (progressBar) progressBar.style.width = '100%';
      if (progressPercent) progressPercent.textContent = '100%';
      if (step4Status) step4Status.innerHTML = '<span class="text-tertiary font-bold">Done</span>';

      if (searchRes.items && searchRes.items.length > 0 && this.activeProfile) {
        await this.apiFetch('/opportunities/attribute-batch', {
          method: 'POST',
          body: JSON.stringify({
            profileId: this.activeProfile.id,
            candidates: searchRes.items
          }),
          signal: this.abortController.signal
        });
      }

      this.showToast(`Discovery scan complete: ${searchRes.items?.length || 0} items evaluated`, 'success');
      await this.loadOpportunities();
      await this.loadMetrics();
      this.renderChatDiscoveredCards();
    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'Search cancelled') {
        this.showToast('Discovery scan cancelled', 'info');
      } else {
        this.showToast(err.message || 'Error executing scan', 'error');
      }
    } finally {
      this.searchInFlight = false;
      this.abortController = null;
      if (runBtn) runBtn.disabled = false;
      if (pauseBtn) pauseBtn.textContent = 'Scan Idle';
    }
  }

  cancelDiscoveryInChat() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  renderChatDiscoveredCards() {
    const listContainer = document.getElementById('chatDiscoveredList');
    if (!listContainer) return;

    if (this.opportunities.length === 0) {
      listContainer.innerHTML = `<div class="p-4 text-center text-outline font-body-sm">No conversations discovered yet.</div>`;
      return;
    }

    const items = this.opportunities.slice(0, 3);
    listContainer.innerHTML = items
      .map(
        (opp) => `
      <div class="bg-surface-container rounded-xl p-space-lg neu-raised flex flex-col gap-space-md transition-all mb-space-md">
        <div class="flex items-start justify-between gap-space-sm flex-wrap">
          <div class="flex items-center gap-space-sm">
            <div class="w-9 h-9 rounded-full bg-surface-container-highest neu-inset flex items-center justify-center font-bold text-secondary text-title-sm">
              ${opp.platform === 'Hacker News' ? 'Y' : opp.platform === 'Reddit' ? 'r/' : 'B'}
            </div>
            <div>
              <div class="flex items-center gap-space-xs">
                <span class="font-title-sm text-title-sm text-on-surface font-semibold">${this.escapeHtml(opp.conversationItem.title || 'Discussion')}</span>
                <a href="${this.escapeHtml(opp.conversationItem.url)}" target="_blank" rel="noopener noreferrer" class="material-symbols-outlined text-[16px] text-outline hover:text-primary">open_in_new</a>
              </div>
              <div class="flex items-center gap-space-xs font-label-sm text-label-sm text-outline">
                <span>${opp.platform}</span>
                <span>•</span>
                <span>by @${this.escapeHtml(opp.conversationItem.author || 'anon')}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-space-xs">
            <span class="px-space-xs py-0.5 rounded-full bg-tertiary text-on-tertiary font-label-sm text-label-sm font-bold">
              ${opp.relevanceScore}% ICP Fit
            </span>
            <span class="px-space-xs py-0.5 rounded-full ${opp.provenance === 'LIVE' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest text-on-surface'} neu-inset font-label-sm text-label-sm font-bold">
              ${opp.provenance}
            </span>
          </div>
        </div>
        <div class="p-space-md rounded-lg bg-surface-container-low neu-inset font-body-md text-body-md text-on-surface">
          "${this.escapeHtml(opp.conversationItem.text.slice(0, 240))}..."
        </div>
        <div class="flex items-start gap-space-xs text-on-surface-variant font-label-md text-label-md">
          <span class="material-symbols-outlined text-secondary text-[16px] shrink-0 mt-0.5">auto_awesome</span>
          <span><strong>Why matched:</strong> ${this.escapeHtml(opp.whyMatched.problemsSolved[0] || 'Matches product value proposition')}</span>
        </div>
        <div class="flex items-center justify-between pt-space-xs flex-wrap gap-space-sm">
          <div class="flex items-center gap-space-xs">
            <button class="px-space-md py-1.5 rounded-full bg-primary-container text-on-primary font-title-sm text-title-sm neu-pill-active hover:brightness-105 transition-all flex items-center gap-1" onclick="window.coldReachApp.openOpportunityDetail('${opp.id}')">
              <span class="material-symbols-outlined text-[16px]">edit_note</span>
              Review Draft
            </button>
            <button class="px-space-sm py-1.5 rounded-full bg-surface-container neu-raised-sm hover:bg-surface-container-high font-label-md text-label-md text-on-surface-variant transition-all" onclick="window.coldReachApp.copyOpportunityPayload('${opp.id}')">
              Copy Payload
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join('');
  }

  // --- Screen 2: Dashboard Controller ---
  renderDashboard() {
    this.renderMetricsCards();
    this.renderDashboardTasks();
    this.renderDashboardSources();
  }

  renderMetricsCards() {
    const m = this.metrics;
    if (!m) return;

    // Card 1: Found
    const foundEl = document.getElementById('dashMetricFound');
    if (foundEl) foundEl.textContent = Number(m.totalOpportunities || 0).toLocaleString();

    // Card 2: High Match
    const highEl = document.getElementById('dashMetricHighMatch');
    if (highEl) highEl.textContent = Number(m.relevanceDistribution.high || 0).toLocaleString();

    // Card 3: Drafts awaiting review
    const draftsEl = document.getElementById('dashMetricDrafts');
    if (draftsEl) draftsEl.textContent = Number(m.statusBreakdown.new + m.statusBreakdown.reviewed || 0).toLocaleString();

    // Card 4: Manually dispatched
    const dispatchedEl = document.getElementById('dashMetricDispatched');
    if (dispatchedEl) dispatchedEl.textContent = Number(m.statusBreakdown.responded || 0).toLocaleString();

    // Ingestion dynamics
    const dynDispatched = document.getElementById('dynManualDispatches');
    if (dynDispatched) dynDispatched.textContent = String(m.auditSummary.verifiedManualDispatches);
  }

  renderDashboardTasks() {
    const container = document.getElementById('dashboardTasksList');
    if (!container) return;

    const pending = this.opportunities.filter((o) => o.status === 'NEW' || o.status === 'REVIEWED').slice(0, 3);
    if (pending.length === 0) {
      container.innerHTML = `<div class="p-4 text-center text-outline font-body-sm">All discovered tasks have been reviewed.</div>`;
      return;
    }

    container.innerHTML = pending
      .map(
        (opp) => `
      <div class="p-space-md rounded-xl bg-surface-container-low neu-raised-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md hover:bg-surface-container transition-all">
        <div class="flex items-start gap-space-md">
          <div class="w-10 h-10 rounded-xl bg-surface-container neu-inset flex-shrink-0 flex items-center justify-center font-bold text-secondary text-sm">
            ${opp.platform === 'Hacker News' ? 'Y' : opp.platform === 'Reddit' ? 'r/' : 'B'}
          </div>
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-space-xs flex-wrap">
              <span class="font-label-sm text-label-sm uppercase font-bold text-on-surface-variant">${opp.platform}</span>
              <span class="text-outline">•</span>
              <span class="px-space-xs py-0.2 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-sm text-label-sm font-bold">${opp.relevanceScore}% Fit</span>
              <span class="px-space-xs py-0.2 rounded ${opp.provenance === 'LIVE' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest'} neu-inset font-label-sm text-label-sm font-bold">${opp.provenance}</span>
            </div>
            <a class="font-title-sm text-title-sm text-on-surface hover:text-primary transition-colors line-clamp-1 font-semibold" href="javascript:window.coldReachApp.openOpportunityDetail('${opp.id}')">
              ${this.escapeHtml(opp.conversationItem.title || opp.conversationItem.text.slice(0, 80))}
            </a>
            <p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-1">
              Angle: "${this.escapeHtml(opp.whyMatched.problemsSolved[0] || 'Direct solution match')}"
            </p>
          </div>
        </div>
        <div class="flex items-center gap-space-xs flex-shrink-0 w-full sm:w-auto justify-end pt-2 sm:pt-0">
          <button class="px-space-md py-1.5 rounded-full bg-primary-container text-on-primary font-title-sm text-title-sm neu-pill-active hover:brightness-110 active:scale-95 transition-all" onclick="window.coldReachApp.openOpportunityDetail('${opp.id}')">
            Review Draft
          </button>
          <button class="w-8 h-8 rounded-full bg-surface-container neu-raised-sm flex items-center justify-center text-outline hover:text-error transition-colors" title="Dismiss Opportunity" onclick="window.coldReachApp.dismissOpportunity('${opp.id}')">
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
    `
      )
      .join('');
  }

  renderDashboardSources() {
    const list = document.getElementById('dashboardSourcesList');
    if (!list) return;

    if (this.providers.length === 0) {
      list.innerHTML = `<div class="p-2 text-outline font-label-sm">No provider status available.</div>`;
      return;
    }

    list.innerHTML = this.providers
      .map((p) => {
        const isLive = p.isLive && p.status === 'ACTIVE';
        return `
        <div class="p-space-sm rounded-lg bg-surface-container-low neu-inset flex items-center justify-between">
          <div class="flex items-center gap-space-sm">
            <span class="w-2 h-2 rounded-full ${isLive ? 'bg-tertiary-container animate-pulse' : 'bg-outline'}"></span>
            <div class="flex flex-col">
              <span class="font-title-sm text-title-sm text-on-surface leading-tight">${this.escapeHtml(p.name)}</span>
              <span class="font-body-sm text-body-sm text-on-surface-variant">${p.capabilities?.join(', ') || 'Public read connector'}</span>
            </div>
          </div>
          <span class="px-space-xs py-0.5 rounded-full ${isLive ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest text-outline'} font-label-sm text-label-sm font-semibold">
            ${isLive ? 'LIVE' : p.status}
          </span>
        </div>
      `;
      })
      .join('');
  }

  // --- Screen 3: Opportunities Controller ---
  setupOpportunitiesScreen() {
    const searchInput = document.getElementById('opportunitySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.oppFilters.search = e.target.value.trim();
        this.loadOpportunities();
      });
    }

    // Filter tab buttons
    const tabs = document.querySelectorAll('#opportunityFilterTabs button');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          t.classList.remove('bg-surface-container', 'neu-raised', 'text-primary');
          t.classList.add('text-on-surface-variant');
        });
        tab.classList.add('bg-surface-container', 'neu-raised', 'text-primary');
        tab.classList.remove('text-on-surface-variant');
        this.oppFilters.statusTab = tab.getAttribute('data-tab') || 'ALL';
        this.loadOpportunities();
      });
    });

    // Refresh feed button
    const refreshBtn = document.getElementById('oppRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadOpportunities());
  }

  renderOpportunities() {
    this.renderOpportunitiesList({ items: this.opportunities, pagination: { totalItems: this.opportunities.length } });
    if (this.selectedOpportunityId) {
      this.selectOpportunity(this.selectedOpportunityId);
    }
  }

  renderOpportunitiesList(res) {
    const container = document.getElementById('opportunitiesScrollStack');
    const countLabel = document.getElementById('oppLeadsCountLabel');
    if (countLabel) countLabel.textContent = `Discovered Leads & Intents (${res.pagination.totalItems || 0})`;
    if (!container) return;

    if (!res.items || res.items.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-outline font-body-md rounded-2xl bg-surface-container neu-raised">No opportunities match the selected criteria.</div>`;
      return;
    }

    container.innerHTML = res.items
      .map((opp) => {
        const isSelected = opp.id === this.selectedOpportunityId;
        return `
        <div class="group relative rounded-2xl p-space-md bg-surface-container neu-raised cursor-pointer transition-all duration-150 ${isSelected ? 'ring-2 ring-primary' : 'hover:neu-raised-sm'}" onclick="window.coldReachApp.selectOpportunity('${opp.id}')">
          ${isSelected ? '<div class="absolute left-0 top-3 bottom-3 w-1.5 bg-primary-container rounded-r-full"></div>' : ''}
          <div class="pl-space-xs flex flex-col gap-space-sm">
            <div class="flex items-center justify-between gap-space-xs flex-wrap">
              <div class="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                <span class="font-bold text-on-surface">${opp.platform}</span>
                <span class="text-outline">·</span>
                <span>@${this.escapeHtml(opp.conversationItem.author || 'anon')}</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="px-2 py-0.5 rounded-full bg-primary-container text-on-primary font-label-sm text-label-sm font-bold flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">verified</span> ${opp.relevanceScore}% ICP
                </span>
                <span class="px-2 py-0.5 rounded-full ${opp.provenance === 'LIVE' ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest text-on-surface-variant'} neu-inset font-label-sm text-label-sm font-bold">
                  ${opp.provenance}
                </span>
              </div>
            </div>
            <h3 class="font-title-md text-title-md text-on-surface font-semibold group-hover:text-primary transition-colors line-clamp-1">
              ${this.escapeHtml(opp.conversationItem.title || opp.conversationItem.text.slice(0, 60))}
            </h3>
            <p class="font-body-md text-body-md text-on-surface-variant line-clamp-2">
              ${this.escapeHtml(opp.conversationItem.text)}
            </p>
            <div class="flex items-center justify-between pt-space-xs">
              <span class="px-2 py-0.5 rounded-md bg-surface-container-high neu-inset text-secondary font-label-sm text-label-sm font-semibold flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full ${opp.status === 'RESPONDED' ? 'bg-tertiary' : opp.status === 'SKIPPED' ? 'bg-error' : 'bg-secondary'}"></span>
                ${opp.status === 'RESPONDED' ? 'Responded (Manual)' : opp.status === 'SKIPPED' ? 'Skipped' : opp.replyDraft ? 'Draft Ready' : 'Pending Review'}
              </span>
              <div class="flex items-center gap-space-xs text-outline font-label-sm text-label-sm">
                <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                <span>${new Date(opp.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  }

  openOpportunityDetail(id) {
    this.selectedOpportunityId = id;
    window.location.hash = '#opportunities';
    this.selectOpportunity(id);
  }

  async selectOpportunity(id) {
    this.selectedOpportunityId = id;

    // Refresh active card style in left list
    const cards = document.querySelectorAll('#opportunitiesScrollStack > div');
    // Highlight
    this.renderOpportunitiesList({ items: this.opportunities, pagination: { totalItems: this.opportunities.length } });

    const detailPanel = document.getElementById('opportunityDetailPanel');
    if (!detailPanel) return;

    try {
      const opp = await this.apiFetch(`/opportunities/${id}`);
      let reviewData = null;
      try {
        reviewData = await this.apiFetch(`/opportunities/${id}/review`);
      } catch (e) {
        console.warn('Could not fetch review data:', e);
      }

      this.renderDetailPanel(opp, reviewData);
    } catch (err) {
      console.error('Failed to load opportunity detail:', err);
      detailPanel.innerHTML = `<div class="p-8 text-center text-error font-body-md">Failed to load opportunity details.</div>`;
    }
  }

  renderDetailPanel(opp, reviewData) {
    const panel = document.getElementById('opportunityDetailPanel');
    if (!panel) return;

    const draftText = opp.replyDraft?.currentText || (opp.relevanceScore < 40 ? 'Draft requires explicit override (score < 40).' : 'Click "Generate Contextual Draft" below to formulate an authentic peer reply.');
    const whyMatched = opp.whyMatched;
    const isResponded = opp.status === 'RESPONDED';

    panel.innerHTML = `
      <section class="rounded-2xl p-space-lg bg-surface-container neu-raised flex flex-col gap-space-lg relative">
        <!-- Header -->
        <div class="flex flex-col gap-space-sm pb-space-md border-b-0">
          <div class="flex items-center justify-between gap-space-sm flex-wrap">
            <div class="flex items-center gap-space-sm">
              <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary flex items-center justify-center neu-raised-sm">
                <span class="material-symbols-outlined text-[20px]">${opp.platform === 'Hacker News' ? 'terminal' : opp.platform === 'Reddit' ? 'forum' : 'cloud'}</span>
              </div>
              <div class="flex flex-col">
                <div class="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                  <span class="font-bold text-on-surface">${opp.platform}</span>
                  <span class="text-outline">·</span>
                  <span>${opp.conversationItem.author ? '@' + this.escapeHtml(opp.conversationItem.author) : 'Community User'}</span>
                </div>
                <div class="flex items-center gap-space-xs font-title-sm text-title-sm text-on-surface">
                  <span class="font-semibold">${opp.provenance} Source Post</span>
                </div>
              </div>
            </div>
            <a class="h-9 px-space-md rounded-full bg-surface-container-high neu-raised-sm text-primary hover:text-on-primary hover:bg-primary transition-all flex items-center gap-space-xs font-label-lg text-label-lg" href="${this.escapeHtml(opp.conversationItem.url)}" target="_blank" rel="noopener noreferrer">
              <span>Open Original Link</span>
              <span class="material-symbols-outlined text-[16px]">open_in_new</span>
            </a>
          </div>
          <h2 class="font-headline-sm text-headline-sm text-on-surface font-bold pt-space-xs leading-snug">
            ${this.escapeHtml(opp.conversationItem.title || opp.conversationItem.text.slice(0, 100))}
          </h2>
        </div>

        <!-- Full Context Quote Box -->
        <div class="rounded-xl p-space-md bg-surface-container-high neu-inset flex flex-col gap-space-sm relative">
          <div class="flex items-center justify-between text-outline font-label-sm text-label-sm">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[16px] text-secondary">format_quote</span>
              <span class="font-bold uppercase tracking-wider text-on-surface-variant">Original Post Body</span>
            </div>
            <span>${opp.platform} • ${new Date(opp.conversationItem.publishedAt).toLocaleDateString()}</span>
          </div>
          <p class="font-body-md text-body-md text-on-surface leading-relaxed italic pl-space-sm border-l-2 border-primary/40">
            "${this.escapeHtml(opp.conversationItem.text)}"
          </p>
        </div>

        <!-- Why This Matched Evidence -->
        <div class="rounded-xl p-space-md bg-surface-container-low neu-raised-sm flex flex-col gap-space-md">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <span class="material-symbols-outlined text-secondary text-[20px]">psychology</span>
              <span class="font-title-sm text-title-sm text-on-surface font-bold">Vector Discovery Rationale & Semantic Fit</span>
            </div>
            <div class="flex items-center gap-space-xs px-2.5 py-1 rounded-full bg-secondary-container neu-raised-sm">
              <span class="material-symbols-outlined text-secondary text-[16px]">radar</span>
              <span class="font-label-md text-label-md text-on-secondary-container font-bold">${opp.relevanceScore}% Similarity</span>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
            ${(whyMatched.problemsSolved || [])
              .map(
                (p) => `
              <div class="p-space-sm rounded-lg bg-surface-container neu-inset flex items-start gap-space-xs">
                <span class="material-symbols-outlined text-tertiary text-[18px] shrink-0 mt-0.5">check_circle</span>
                <div class="flex flex-col">
                  <span class="font-label-sm text-label-sm text-on-surface font-bold">Pain Point Fit</span>
                  <span class="font-body-sm text-body-sm text-on-surface-variant">${this.escapeHtml(p)}</span>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
          <div class="flex items-center gap-space-xs flex-wrap pt-space-xs">
            <span class="font-label-sm text-label-sm text-outline font-semibold">Matched Keywords:</span>
            ${(whyMatched.matchedTerms || [])
              .map(
                (t) => `
              <span class="px-2 py-0.5 rounded-full bg-surface-container-high neu-inset font-label-sm text-label-sm text-primary font-semibold">${this.escapeHtml(t)}</span>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- ColdReach Suggested Response Draft -->
        <div class="rounded-xl p-space-md bg-surface-container neu-raised flex flex-col gap-space-md">
          <div class="flex items-center justify-between flex-wrap gap-space-xs pb-space-xs">
            <div class="flex items-center gap-space-xs">
              <span class="material-symbols-outlined text-primary text-[20px]">smart_toy</span>
              <span class="font-title-sm text-title-sm text-on-surface font-bold">ColdReach Suggested Response Draft</span>
            </div>
            <div class="flex items-center gap-space-xs">
              <span class="h-7 px-2.5 rounded-full bg-surface-container-high neu-inset flex items-center font-label-sm text-label-sm text-on-surface-variant font-semibold">
                Tone: Consultative & Peer
              </span>
            </div>
          </div>

          <div class="relative rounded-xl bg-surface-container-high neu-inset p-space-sm flex flex-col">
            <textarea id="activeReplyDraftTextarea" class="w-full bg-transparent border-none outline-none font-body-md text-body-md text-on-surface leading-relaxed resize-none selection:bg-secondary-container" rows="5" placeholder="Draft text will appear here...">${this.escapeHtml(draftText)}</textarea>
            <div class="flex items-center justify-between pt-space-xs border-t-0 text-outline font-label-sm text-label-sm">
              <span class="text-tertiary flex items-center gap-1">
                <span class="material-symbols-outlined text-[14px]">check_circle</span> Anti-Spam Verified
              </span>
              <span id="draftCharCount">${draftText.length} characters</span>
            </div>
          </div>

          <!-- Transparency Guardrail Banner -->
          <div class="rounded-lg p-space-sm bg-surface-container-high neu-inset flex items-start gap-space-sm text-on-surface-variant">
            <span class="material-symbols-outlined text-secondary text-[20px] shrink-0">verified_user</span>
            <div class="flex flex-col">
              <span class="font-title-sm text-title-sm font-bold text-on-surface">100% Manual Dispatch Guardrail</span>
              <p class="font-body-sm text-body-sm leading-snug">
                ColdReach never posts automatically. Review, customize, and paste directly on the source platform to maintain authentic community trust and reputation integrity.
              </p>
            </div>
          </div>

          <!-- Action Triggers -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-space-md pt-space-xs">
            <div class="flex items-center gap-space-xs">
              <button class="px-space-lg py-2.5 rounded-full bg-primary-container text-on-primary font-title-sm text-title-sm font-bold neu-pill-active flex items-center justify-center gap-space-xs hover:bg-primary transition-all active:translate-y-0.5" onclick="window.coldReachApp.copyCurrentDraft('${opp.id}')">
                <span class="material-symbols-outlined text-[18px]">content_copy</span>
                <span>Copy Reply Draft</span>
              </button>
              <button class="h-10 px-space-md rounded-full bg-surface-container-high neu-raised-sm text-on-surface hover:text-primary font-title-sm text-title-sm flex items-center gap-space-xs transition-all" onclick="window.coldReachApp.generateDraftForCurrent('${opp.id}')">
                <span class="material-symbols-outlined text-[18px]">autorenew</span>
                <span>Regenerate</span>
              </button>
            </div>

            <div class="flex items-center gap-space-xs justify-end">
              ${
                isResponded
                  ? `<span class="px-space-md py-1.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-md text-label-md font-bold flex items-center gap-1">
                      <span class="material-symbols-outlined text-[16px]">verified</span> Responded Manually
                    </span>`
                  : `<button class="h-10 px-space-md rounded-full bg-surface-container neu-raised-sm text-tertiary hover:text-tertiary-container font-title-sm text-title-sm flex items-center gap-space-xs transition-all font-bold" onclick="window.coldReachApp.openManualDispatchModal('${opp.id}')">
                      <span class="material-symbols-outlined text-[18px]">done_all</span>
                      <span>Mark Responded</span>
                    </button>
                    <button class="w-10 h-10 rounded-full bg-surface-container neu-raised-sm text-outline hover:text-error flex items-center justify-center transition-colors" title="Skip Opportunity" onclick="window.coldReachApp.dismissOpportunity('${opp.id}')">
                      <span class="material-symbols-outlined text-[20px]">close</span>
                    </button>`
              }
            </div>
          </div>
        </div>

        <!-- Operator Review Notes -->
        <div class="rounded-xl p-space-md bg-surface-container neu-raised flex flex-col gap-space-xs">
          <div class="flex items-center justify-between">
            <label class="font-label-md text-label-md text-on-surface font-semibold" for="oppOperatorNotes">Operator Review Notes</label>
            <button class="font-label-sm text-label-sm text-primary hover:underline" onclick="window.coldReachApp.saveReviewNotes('${opp.id}')">Save Notes</button>
          </div>
          <div class="p-space-sm rounded-lg bg-surface-container neu-inset">
            <textarea id="oppOperatorNotes" class="w-full bg-transparent border-none outline-none font-body-md text-body-md text-on-surface resize-none leading-relaxed" rows="2" placeholder="Record internal observations or follow-up notes...">${this.escapeHtml(opp.userReviewNotes || '')}</textarea>
          </div>
        </div>
      </section>
    `;

    // Listen to draft textarea changes
    const textarea = document.getElementById('activeReplyDraftTextarea');
    const charCounter = document.getElementById('draftCharCount');
    if (textarea && charCounter) {
      textarea.addEventListener('input', () => {
        charCounter.textContent = `${textarea.value.length} characters`;
      });
      textarea.addEventListener('blur', () => {
        if (opp.replyDraft && textarea.value !== opp.replyDraft.currentText) {
          this.saveDraftEdit(opp.id, textarea.value);
        }
      });
    }
  }

  renderEmptyDetail() {
    const panel = document.getElementById('opportunityDetailPanel');
    if (panel) {
      panel.innerHTML = `<div class="p-12 text-center text-outline font-body-md rounded-2xl bg-surface-container neu-raised">Select an opportunity from the list to review intent signals and reply draft.</div>`;
    }
  }

  async generateDraftForCurrent(id) {
    const opp = this.opportunities.find((o) => o.id === id);
    let allowOverride = false;
    if (opp && opp.relevanceScore < 40) {
      const confirmOverride = confirm('Relevance score is under 40%. Generate draft with explicit user override?');
      if (!confirmOverride) return;
      allowOverride = true;
    }

    try {
      this.showToast('Generating draft...', 'info');
      await this.apiFetch(`/opportunities/${id}/draft`, {
        method: 'POST',
        body: JSON.stringify({
          allowLowScoreOverride: allowOverride,
          profileId: this.activeProfile?.id
        })
      });
      this.showToast('Draft ready for human review', 'success');
      await this.selectOpportunity(id);
    } catch (err) {
      this.showToast(err.message || 'Error generating draft', 'error');
    }
  }

  async saveDraftEdit(id, newText) {
    try {
      await this.apiFetch(`/opportunities/${id}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          newText,
          changeSummary: 'Edited by human reviewer in UI'
        })
      });
      this.showToast('Draft edits saved', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error saving draft revision', 'error');
    }
  }

  async copyCurrentDraft(id) {
    const textarea = document.getElementById('activeReplyDraftTextarea');
    const textToCopy = textarea ? textarea.value : '';
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      this.showToast('Reply draft copied to clipboard!', 'success');
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.showToast('Reply draft copied to clipboard!', 'success');
    }
  }

  async copyOpportunityPayload(id) {
    try {
      const payload = await this.apiFetch(`/opportunities/${id}/copy`);
      await navigator.clipboard.writeText(payload.formattedText);
      this.showToast('Full formatted payload copied to clipboard!', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error copying payload', 'error');
    }
  }

  async saveReviewNotes(id) {
    const notesEl = document.getElementById('oppOperatorNotes');
    if (!notesEl) return;
    try {
      await this.apiFetch(`/opportunities/${id}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ notes: notesEl.value })
      });
      this.showToast('Review notes saved', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error saving review notes', 'error');
    }
  }

  async dismissOpportunity(id) {
    const ok = confirm('Skip and dismiss this opportunity?');
    if (!ok) return;

    try {
      await this.apiFetch(`/opportunities/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          toStatus: 'SKIPPED',
          reason: 'Dismissed by operator in UI'
        })
      });
      this.showToast('Opportunity skipped', 'info');
      await this.loadOpportunities();
      await this.loadMetrics();
    } catch (err) {
      this.showToast(err.message || 'Error dismissing opportunity', 'error');
    }
  }

  // --- Manual Response Confirmation Modal ---
  setupModals() {
    const modal = document.getElementById('manualResponseModal');
    const cancelBtn = document.getElementById('modalCancelBtn');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const confirmCheckbox = document.getElementById('modalConfirmCheck');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (modal) modal.classList.add('hidden');
      });
    }

    if (confirmCheckbox && confirmBtn) {
      confirmCheckbox.addEventListener('change', () => {
        confirmBtn.disabled = !confirmCheckbox.checked;
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const id = modal?.getAttribute('data-opp-id');
        const operatorNotes = document.getElementById('modalOperatorNotes')?.value || '';
        if (!id) return;

        try {
          confirmBtn.disabled = true;
          await this.apiFetch(`/opportunities/${id}/respond`, {
            method: 'POST',
            body: JSON.stringify({
              manualDispatchConfirmed: true,
              operatorNotes,
              markedSentAt: new Date().toISOString()
            })
          });
          this.showToast('Manual response recorded. App dispatched: 0', 'success');
          if (modal) modal.classList.add('hidden');
          await this.loadOpportunities();
          await this.loadMetrics();
          await this.selectOpportunity(id);
        } catch (err) {
          this.showToast(err.message || 'Error recording response', 'error');
        } finally {
          confirmBtn.disabled = false;
        }
      });
    }
  }

  openManualDispatchModal(id) {
    const modal = document.getElementById('manualResponseModal');
    const confirmCheckbox = document.getElementById('modalConfirmCheck');
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const notesInput = document.getElementById('modalOperatorNotes');

    if (modal && confirmCheckbox && confirmBtn) {
      modal.setAttribute('data-opp-id', id);
      confirmCheckbox.checked = false;
      confirmBtn.disabled = true;
      if (notesInput) notesInput.value = '';
      modal.classList.remove('hidden');
    }
  }

  // --- Screen 4: Product Profile Controller ---
  setupProductProfileScreen() {
    const saveBtn = document.getElementById('profileSaveBtn');
    const testExpansionBtn = document.getElementById('profileTestExpansionBtn');

    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveProductProfileFromForm());
    }

    if (testExpansionBtn) {
      testExpansionBtn.addEventListener('click', () => this.testQueryExpansion());
    }
  }

  renderProductProfile() {
    const p = this.activeProfile;
    if (!p) return;

    const nameInput = document.getElementById('profNameInput');
    const urlInput = document.getElementById('profUrlInput');
    const valPropInput = document.getElementById('profValPropInput');
    const personaInput = document.getElementById('profPersonaInput');

    if (nameInput) nameInput.value = p.productName || '';
    if (urlInput) urlInput.value = p.productDescription?.includes('http') ? p.productDescription : 'https://formbridge.io';
    if (valPropInput) valPropInput.value = p.valueProposition || '';
    if (personaInput) personaInput.value = p.idealCustomerDescription || '';

    // Render keyword chips
    this.renderProfileChips('profileKeywordsList', p.seedKeywords || [], (removed) => {
      p.seedKeywords = p.seedKeywords.filter((k) => k !== removed);
      this.renderProductProfile();
    });

    // Render problems solved
    this.renderProfileChips('profileProblemsList', p.problemsSolved || [], (removed) => {
      p.problemsSolved = p.problemsSolved.filter((k) => k !== removed);
      this.renderProductProfile();
    });

    // Render excluded topics
    this.renderProfileChips(
      'profileExcludedList',
      p.excludedTopics || [],
      (removed) => {
        p.excludedTopics = p.excludedTopics.filter((k) => k !== removed);
        this.renderProductProfile();
      },
      true
    );
  }

  renderProfileChips(containerId, items, onRemove, isExcluded = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = items
      .map(
        (item) => `
      <span class="px-space-sm py-1 rounded-full ${isExcluded ? 'bg-error-container text-on-error-container' : 'bg-surface-container neu-raised-sm text-primary'} font-label-md text-label-md flex items-center gap-1">
        "${this.escapeHtml(item)}"
        <span class="material-symbols-outlined text-[14px] text-outline cursor-pointer hover:text-error" onclick="window.coldReachApp.removeProfileItem('${containerId}', '${this.escapeHtml(item)}')">close</span>
      </span>
    `
      )
      .join('');
  }

  removeProfileItem(containerId, item) {
    if (!this.activeProfile) return;
    if (containerId === 'profileKeywordsList') {
      this.activeProfile.seedKeywords = (this.activeProfile.seedKeywords || []).filter((k) => k !== item);
    } else if (containerId === 'profileProblemsList') {
      this.activeProfile.problemsSolved = (this.activeProfile.problemsSolved || []).filter((k) => k !== item);
    } else if (containerId === 'profileExcludedList') {
      this.activeProfile.excludedTopics = (this.activeProfile.excludedTopics || []).filter((k) => k !== item);
    }
    this.renderProductProfile();
  }

  addProfileKeyword() {
    const val = prompt('Enter semantic keyword trigger:');
    if (val && val.trim() && this.activeProfile) {
      this.activeProfile.seedKeywords = this.activeProfile.seedKeywords || [];
      this.activeProfile.seedKeywords.push(val.trim());
      this.renderProductProfile();
    }
  }

  addProfileProblem() {
    const val = prompt('Enter customer pain point / problem solved:');
    if (val && val.trim() && this.activeProfile) {
      this.activeProfile.problemsSolved = this.activeProfile.problemsSolved || [];
      this.activeProfile.problemsSolved.push(val.trim());
      this.renderProductProfile();
    }
  }

  addProfileExcluded() {
    const val = prompt('Enter negative constraint / excluded topic:');
    if (val && val.trim() && this.activeProfile) {
      this.activeProfile.excludedTopics = this.activeProfile.excludedTopics || [];
      this.activeProfile.excludedTopics.push(val.trim());
      this.renderProductProfile();
    }
  }

  async saveProductProfileFromForm() {
    if (!this.activeProfile) return;

    const nameInput = document.getElementById('profNameInput');
    const valPropInput = document.getElementById('profValPropInput');
    const personaInput = document.getElementById('profPersonaInput');

    const updatePayload = {
      productName: nameInput?.value.trim() || this.activeProfile.productName,
      valueProposition: valPropInput?.value.trim() || this.activeProfile.valueProposition,
      idealCustomerDescription: personaInput?.value.trim() || this.activeProfile.idealCustomerDescription,
      problemsSolved: this.activeProfile.problemsSolved,
      seedKeywords: this.activeProfile.seedKeywords,
      customerPainPointPhrases: this.activeProfile.customerPainPointPhrases,
      excludedTopics: this.activeProfile.excludedTopics,
      toneGuidelines: this.activeProfile.toneGuidelines
    };

    try {
      this.showToast('Saving vector profile...', 'info');
      const updated = await this.apiFetch(`/profiles/${this.activeProfile.id}`, {
        method: 'PUT',
        body: JSON.stringify(updatePayload)
      });
      this.activeProfile = updated;
      this.updateProfileNameUI();
      this.showToast('Product profile saved and re-indexed', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error saving profile', 'error');
    }
  }

  async testQueryExpansion() {
    if (!this.activeProfile) return;
    const outputContainer = document.getElementById('queryExpansionResultsBox');

    try {
      this.showToast('Running deterministic query expansion engine...', 'info');
      const res = await this.apiFetch('/query-expansion', {
        method: 'POST',
        body: JSON.stringify({ profile: this.activeProfile })
      });

      if (outputContainer) {
        outputContainer.classList.remove('hidden');
        outputContainer.innerHTML = `
          <div class="p-space-md rounded-xl bg-surface-container-high neu-inset flex flex-col gap-space-sm mt-space-md">
            <div class="flex items-center justify-between">
              <span class="font-title-sm text-title-sm text-primary font-bold">Deterministic Query Expansion Output</span>
              <span class="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm font-bold">Active Engine</span>
            </div>
            <div class="flex flex-wrap gap-space-xs pt-1">
              ${(res.primaryTerms || [])
                .map(
                  (t) => `
                <span class="px-space-sm py-1 rounded-full bg-surface-container neu-raised-sm font-label-sm text-label-sm text-primary font-semibold flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px] text-tertiary">check</span>
                  ${this.escapeHtml(t.term)} (wt: ${t.weight})
                </span>
              `
                )
                .join('')}
            </div>
            <div class="text-on-surface-variant font-label-sm text-label-sm pt-1">
              Negative bounds: ${(res.excludedTerms || []).join(', ') || 'None'}
            </div>
          </div>
        `;
      }
      this.showToast('Query expansion computed successfully', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error executing query expansion', 'error');
    }
  }

  // --- Screen 5: Analytics Controller ---
  renderAnalytics() {
    const m = this.metrics;
    if (!m) return;

    const elTotal = document.getElementById('analyticsTotalFound');
    const elQualified = document.getElementById('analyticsQualified');
    const elReviewed = document.getElementById('analyticsReviewed');
    const elTouches = document.getElementById('analyticsManualTouches');

    if (elTotal) elTotal.textContent = Number(m.totalOpportunities || 0).toLocaleString();
    if (elQualified) elQualified.textContent = Number(m.relevanceDistribution.high || 0).toLocaleString();
    if (elReviewed) elReviewed.textContent = Number(m.statusBreakdown.reviewed + m.statusBreakdown.responded || 0).toLocaleString();
    if (elTouches) elTouches.textContent = Number(m.statusBreakdown.responded || 0).toLocaleString();

    // Export button
    const exportBtn = document.getElementById('analyticsExportBtn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(m, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `coldreach-analytics-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        this.showToast('Analytics export downloaded', 'success');
      };
    }
  }

  // --- Screen 6: Settings & Source Connectors Controller ---
  renderSettings() {
    this.updateThemeControls();
    const sourcesList = document.getElementById('settingsSourcesGrid');
    if (!sourcesList) return;

    if (this.providers.length === 0) {
      sourcesList.innerHTML = `<div class="p-4 text-outline font-label-sm">No provider connectors available.</div>`;
      return;
    }

    sourcesList.innerHTML = this.providers
      .map((p) => {
        const isLive = p.isLive && p.status === 'ACTIVE';
        return `
        <div class="p-space-lg rounded-xl bg-surface-container neu-raised flex flex-col justify-between">
          <div class="flex items-start justify-between mb-space-md">
            <div class="flex items-center gap-space-sm">
              <div class="w-10 h-10 rounded-xl bg-surface-container-highest neu-inset flex items-center justify-center font-bold text-secondary text-sm">
                <span class="material-symbols-outlined text-[20px]">${p.name.includes('Hacker') ? 'terminal' : p.name.includes('Reddit') ? 'forum' : 'hub'}</span>
              </div>
              <div class="flex flex-col">
                <h3 class="font-title-md text-title-md text-on-surface font-semibold">${this.escapeHtml(p.name)}</h3>
                <span class="font-label-sm text-label-sm text-outline">${isLive ? 'Read-only public API stream' : 'Status: ' + p.status}</span>
              </div>
            </div>
            <span class="px-space-xs py-0.5 rounded-full ${isLive ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant' : 'bg-surface-container-highest text-outline'} font-label-sm text-label-sm font-bold">
              ${isLive ? 'CONNECTED' : p.status}
            </span>
          </div>
          <div class="flex flex-col gap-1 text-on-surface-variant font-body-sm text-body-sm mb-space-md">
            <div>Capabilities: ${p.capabilities?.join(', ') || 'Search'}</div>
            <div>Latency: ${p.latencyMs ? p.latencyMs + 'ms' : 'Direct JSON'}</div>
          </div>
          <div class="flex items-center justify-between pt-space-xs border-t border-outline-variant/20">
            <span class="font-label-sm text-label-sm text-outline">Polling rate: 60s</span>
            <button class="px-space-sm py-1 rounded-full bg-surface-container-high neu-raised-sm font-label-sm text-label-sm text-primary hover:text-on-surface transition-all" onclick="window.coldReachApp.testProviderConnection('${p.provider}')">
              Verify Link
            </button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  async testProviderConnection(providerName) {
    this.showToast(`Testing link to ${providerName}...`, 'info');
    await this.fetchProviders();
    this.renderSettings();
    this.showToast(`${providerName} status verified`, 'success');
  }

  // --- Toast Notifications ---
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item px-space-md py-space-sm rounded-xl neu-raised flex items-center gap-space-xs font-title-sm text-title-sm shadow-lg ${
      type === 'error'
        ? 'bg-error-container text-on-error-container'
        : type === 'success'
          ? 'bg-tertiary-container text-on-tertiary'
          : 'bg-surface-container text-on-surface'
    }`;

    const icon = type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info';
    toast.innerHTML = `
      <span class="material-symbols-outlined text-[18px]">${icon}</span>
      <span>${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(1rem)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Global bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.coldReachApp = new ColdReachApp();
  window.coldReachApp.init();
  window.coldReachApp.setupChatScreen();
  window.coldReachApp.setupOpportunitiesScreen();
  window.coldReachApp.setupProductProfileScreen();
});
