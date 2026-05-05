/* @odoo-module */

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

export class RBACAccessStudio extends Component {
    static template = "rbac.AccessStudio";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.orm = useService("orm");

        this.state = useState({
            // List page
            rules: [],
            loading: true,
            search: '',
            filterStatus: '',
            filterRisk: '',
            // Source data for dropdowns (loaded from backend)
            wAllRoles: [],
            wAllDepts: [],
            wAllUsers: [],
            wAllCompanies: [],
            wAllMenus: [],
            wAllModels: [],
            // Wizard control
            wizardOpen: false,
            wizardMode: 'new',      // 'new' | 'edit'
            wizardStep: 1,
            activeRule: null,
            // Step 1
            wName: '',
            wDesc: '',
            wType: 'Restriction',
            wPriority: 'Normal (50)',
            wActivate: true,
            // Step 2 selections (arrays of {id, name})
            wRoles: [],
            wDepts: [],
            wUsers: [],
            wCompanies: [],
            wExclude: [],
            // Step 3 selections
            wHideMenus: [],
            wModelItems: [],
            wRestrictTab: 'menu',
            // Step 3 global toggles
            wGlobalHideImport: false,
            wGlobalHideExport: false,
            wGlobalHideSpreadsheet: false,
            wGlobalHideAddProperty: false,
            wGlobalDisableDevMode: false,
            wGlobalHideTechSettings: false,
            wGlobalForceReadonly: false,
            wGlobalHideChatter: false,
            wGlobalHideSendMessage: false,
            wGlobalHideLogNote: false,
            wGlobalHideActivity: false,
            // Tokenizer state
            wOpenField: '',
            wSearches: {
                roles: '', depts: '', users: '', companies: '', exclude: '',
                menus: '', models: '',
            },
        });

        onWillStart(async () => {
            try {
                const data = await this.orm.call('rbac.model', 'get_access_studio_data', [], {});
                this.state.wAllRoles    = data.roles     || [];
                this.state.wAllDepts    = data.depts     || [];
                this.state.wAllUsers    = data.users     || [];
                this.state.wAllCompanies = data.companies || [];
                this.state.wAllMenus    = data.menus     || [];
                this.state.wAllModels   = data.models    || [];
                this.state.rules        = data.rules     || [];
            } catch (e) {
                console.warn('Access Studio data load failed:', e);
            } finally {
                this.state.loading = false;
            }
        });
    }

    // ── List helpers ──────────────────────────────────────────────────────────

    get filteredRules() {
        let rules = this.state.rules;
        const q = this.state.search.trim().toLowerCase();
        if (q) rules = rules.filter(r =>
            (r.name || '').toLowerCase().includes(q) ||
            (r.sub || '').toLowerCase().includes(q)
        );
        if (this.state.filterStatus) rules = rules.filter(r => r.status === this.state.filterStatus);
        if (this.state.filterRisk)   rules = rules.filter(r => r.risk   === this.state.filterRisk);
        return rules;
    }

    onSearch(ev)       { this.state.search = ev.target.value; }
    onStatusFilter(ev) { this.state.filterStatus = ev.target.value; }
    onRiskFilter(ev)   { this.state.filterRisk = ev.target.value; }

    // ── Wizard open/close ─────────────────────────────────────────────────────

    _resetWizardFields() {
        Object.assign(this.state, {
            wName: '', wDesc: '', wType: 'Restriction', wPriority: 'Normal (50)', wActivate: true,
            wRoles: [], wDepts: [], wUsers: [], wCompanies: [], wExclude: [],
            wHideMenus: [], wModelItems: [],
            wRestrictTab: 'menu',
            wGlobalHideImport: false, wGlobalHideExport: false,
            wGlobalHideSpreadsheet: false, wGlobalHideAddProperty: false,
            wGlobalDisableDevMode: false, wGlobalHideTechSettings: false,
            wGlobalForceReadonly: false, wGlobalHideChatter: false,
            wGlobalHideSendMessage: false, wGlobalHideLogNote: false,
            wGlobalHideActivity: false,
            wOpenField: '',
            wSearches: {
                roles: '', depts: '', users: '', companies: '', exclude: '',
                menus: '', models: '',
            },
        });
    }

    openNew() {
        this._resetWizardFields();
        Object.assign(this.state, {wizardMode: 'new', wizardStep: 1, activeRule: null, wizardOpen: true});
    }

    openEdit(rule) {
        this._resetWizardFields();
        const ad = rule.audience_detail || {};
        const cfg = rule.config || {};
        Object.assign(this.state, {
            wizardMode: 'edit', wizardStep: 1, activeRule: rule, wizardOpen: true,
            wName: rule.name || '', wDesc: rule.sub || '',
            wActivate: rule.status === 'active',
            wRoles:    (ad.roles     || []).map(item => this._normalizeOption(item)),
            wDepts:    (ad.depts     || []).map(item => this._normalizeOption(item)),
            wUsers:    (ad.users     || []).map(item => this._normalizeOption(item)),
            wCompanies:(ad.companies || []).map(item => this._normalizeOption(item)),
            wExclude:  (ad.exclude   || []).map(item => this._normalizeOption(item)),
            wHideMenus: (cfg.hide_menus || []).map(item => this._normalizeOption(item)),
            wModelItems: (cfg.models || []).map(item => this._normalizeOption(item)),
            wGlobalHideImport: !!cfg.hide_import,
            wGlobalHideExport: !!cfg.hide_export,
            wGlobalHideSpreadsheet: !!cfg.hide_spreadsheet,
            wGlobalHideAddProperty: !!cfg.hide_add_property,
            wGlobalDisableDevMode: !!cfg.disable_dev_mode,
            wGlobalHideTechSettings: !!cfg.hide_technical_settings,
            wGlobalForceReadonly: !!cfg.force_readonly,
            wGlobalHideChatter: !!cfg.hide_chatter,
            wGlobalHideSendMessage: !!cfg.hide_send_message,
            wGlobalHideLogNote: !!cfg.hide_log_note,
            wGlobalHideActivity: !!cfg.hide_activity,
        });
    }

    _normalizeOption(item) {
        if (typeof item === 'object' && item !== null) {
            return {id: item.id, name: item.name, model: item.model};
        }
        return {id: item, name: item};
    }

    closeWizard() {
        this.state.wizardOpen = false;
    }

    // ── Wizard navigation ─────────────────────────────────────────────────────

    get wizardStepLabel() {
        return {1: 'Define Rule', 2: 'Select Audience', 3: 'Configure Restrictions', 4: 'Review & Publish'}[this.state.wizardStep] || '';
    }

    async wizardNext() {
        if (this.state.wizardStep === 1 && !this.state.wName.trim()) {
            const el = document.querySelector('.as_wizard_name_input');
            if (el) {
                el.classList.add('rd_input_error');
                el.scrollIntoView({behavior: 'smooth', block: 'center'});
                el.focus();
                const clear = () => { el.classList.remove('rd_input_error'); el.removeEventListener('input', clear); };
                el.addEventListener('input', clear);
            }
            return;
        }
        if (this.state.wizardStep < 4) {
            this.state.wizardStep++;
        } else {
            await this.saveRule();
        }
    }

    wizardBack() {
        if (this.state.wizardStep > 1) this.state.wizardStep--;
    }

    async saveRule() {
        const isEdit = this.state.wizardMode === 'edit';
        const payload = this._buildRulePayload();
        const savedRule = await this.orm.call('rbac.model', 'save_access_studio_rule', [], {
            values: payload,
        });
        if (isEdit && this.state.activeRule) {
            const idx = this.state.rules.findIndex(r => r.id === this.state.activeRule.id);
            if (idx >= 0) {
                this.state.rules[idx] = savedRule;
            }
            this.notification.add(_t('Rule "%s" updated.', this.state.wName), {type: 'success'});
        } else {
            this.state.rules.unshift(savedRule);
            this.notification.add(_t('Rule "%s" created.', this.state.wName), {type: 'success'});
        }
        this.closeWizard();
    }

    _buildRulePayload() {
        return {
            id: this.state.activeRule?.id || false,
            name: this.state.wName,
            description: this.state.wDesc || this._buildSubLabel(),
            rule_type: this.state.wType,
            priority: this.state.wPriority,
            active: this.state.wActivate,
            risk: this._buildRisk(),
            audience_detail: {
                roles: this.state.wRoles.map(item => ({id: item.id, name: item.name})),
                depts: this.state.wDepts.map(item => ({id: item.id, name: item.name})),
                users: this.state.wUsers.map(item => ({id: item.id, name: item.name})),
                companies: this.state.wCompanies.map(item => ({id: item.id, name: item.name})),
                exclude: this.state.wExclude.map(item => ({id: item.id, name: item.name})),
            },
            impact: this._buildImpact(),
            config: {
                hide_menus: this.state.wHideMenus.map(item => ({id: item.id, name: item.name})),
                models: this.state.wModelItems.map(item => ({id: item.id, name: item.name, model: item.model})),
                hide_import: this.state.wGlobalHideImport,
                hide_export: this.state.wGlobalHideExport,
                hide_spreadsheet: this.state.wGlobalHideSpreadsheet,
                hide_add_property: this.state.wGlobalHideAddProperty,
                disable_dev_mode: this.state.wGlobalDisableDevMode,
                hide_technical_settings: this.state.wGlobalHideTechSettings,
                force_readonly: this.state.wGlobalForceReadonly,
                hide_chatter: this.state.wGlobalHideChatter,
                hide_send_message: this.state.wGlobalHideSendMessage,
                hide_log_note: this.state.wGlobalHideLogNote,
                hide_activity: this.state.wGlobalHideActivity,
            },
        };
    }

    _buildSubLabel() {
        const parts = [];
        if (this.state.wRoles.length) parts.push(`${this.state.wRoles.map(r => r.name).join(', ')} role(s)`);
        if (this.state.wUsers.length) parts.push(`${this.state.wUsers.length} direct user(s)`);
        return parts.join(' + ') || 'New rule';
    }

    _buildImpact() {
        const impact = [];
        if (this.state.wHideMenus.length) impact.push({label: 'Hide Menus', type: 'hide'});
        if (this.state.wModelItems.length) impact.push({label: 'Model Access', type: 'restrict'});
        if (this.state.wGlobalHideImport)  impact.push({label: 'No Import', type: 'disable'});
        if (this.state.wGlobalHideExport)  impact.push({label: 'No Export', type: 'disable'});
        if (this.state.wGlobalDisableDevMode) impact.push({label: 'Block Dev', type: 'restrict'});
        return impact;
    }

    _buildRisk() {
        if (this.state.wGlobalForceReadonly || this.state.wGlobalDisableDevMode || this.state.wModelItems.length) {
            return 'high';
        }
        if (this.state.wHideMenus.length || this.state.wGlobalHideImport || this.state.wGlobalHideExport) {
            return 'medium';
        }
        return 'low';
    }

    async saveAsDraft() {
        this.state.wActivate = false;
        await this.saveRule();
    }

    // ── Tokenizer helpers ─────────────────────────────────────────────────────

    _selectedList(field) {
        const map = {
            roles: this.state.wRoles, depts: this.state.wDepts,
            users: this.state.wUsers, companies: this.state.wCompanies,
            exclude: this.state.wExclude, menus: this.state.wHideMenus,
            models: this.state.wModelItems,
        };
        return map[field] || [];
    }

    _sourceList(field) {
        const map = {
            roles: this.state.wAllRoles, depts: this.state.wAllDepts,
            users: this.state.wAllUsers, companies: this.state.wAllCompanies,
            exclude: this.state.wAllUsers, menus: this.state.wAllMenus,
            models: this.state.wAllModels,
        };
        return map[field] || [];
    }

    getFiltered(field) {
        const src = this._sourceList(field);
        const sel = this._selectedList(field);
        const selIds = new Set(sel.map(s => s.id));
        const q = (this.state.wSearches[field] || '').toLowerCase().trim();
        let filtered = src.filter(opt => !selIds.has(opt.id));
        if (q) filtered = filtered.filter(opt => (opt.name || '').toLowerCase().includes(q));
        return filtered.slice(0, 15);
    }

    openDropdown(field) {
        this.state.wOpenField = field;
    }

    scheduleClose(field) {
        setTimeout(() => {
            if (this.state.wOpenField === field) this.state.wOpenField = '';
        }, 150);
    }

    selectOption(field, opt) {
        const list = this._selectedList(field);
        if (!list.find(i => i.id === opt.id)) {
            list.push({id: opt.id, name: opt.name, model: opt.model});
        }
        this.state.wSearches[field] = '';
        this.state.wOpenField = '';
    }

    removeWItem(field, id) {
        const list = this._selectedList(field);
        const idx = list.findIndex(i => i.id === id);
        if (idx >= 0) list.splice(idx, 1);
    }

    onTokenizerInput(ev, field) {
        this.state.wSearches[field] = ev.target.value;
        this.state.wOpenField = field;
    }

    // ── Step 3 ────────────────────────────────────────────────────────────────

    setRestrictTab(tab) {
        this.state.wRestrictTab = tab;
        this.state.wOpenField = '';
    }

    toggleGlobal(key) {
        this.state[key] = !this.state[key];
    }
}

registry.category("actions").add("rbac.access_studio", RBACAccessStudio);
