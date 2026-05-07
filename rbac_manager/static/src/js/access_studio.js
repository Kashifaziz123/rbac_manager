/* @odoo-module */

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {browser} from "@web/core/browser/browser";

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
            // Delete confirm dialog
            confirmOpen: false,
            confirmRule: null,
            // Source data for dropdowns (loaded from backend)
            wAllRoles: [],
            wAllDepts: [],
            wAllUsers: [],
            wAllCompanies: [],
            wAllMenus: [],
            wAllModels: [],
            wAllFieldChoices: [],
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
            wFieldRules: [],
            wFieldModelId: '',
            wFieldModel: null,
            wFieldItems: [],
            wFieldInvisible: true,
            wFieldReadonly: false,
            wFieldRequired: false,
            wFieldExternalLink: false,
            wDomainRules: [],
            wDomainModel: null,
            wButtonRules: [],
            wButtonModel: null,
            wAllButtonChoices: [],
            wFilterRules: [],
            wFilterModel: null,
            wAllFilterChoices: [],
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
                menus: '', models: '', field_models: '', field_fields: '', domain_models: '',
                button_models: '', button_nodes: '', filter_models: '', filter_nodes: '',
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
            if (browser.sessionStorage.getItem('rbac_open_new_access_rule') === '1') {
                browser.sessionStorage.removeItem('rbac_open_new_access_rule');
                this.openNew();
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
            wHideMenus: [], wModelItems: [], wFieldRules: [],
            wFieldModelId: '', wFieldModel: null, wFieldItems: [], wAllFieldChoices: [],
            wFieldInvisible: true, wFieldReadonly: false, wFieldRequired: false, wFieldExternalLink: false,
            wDomainRules: [], wDomainModel: null,
            wButtonRules: [], wButtonModel: null, wAllButtonChoices: [],
            wFilterRules: [], wFilterModel: null, wAllFilterChoices: [],
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
                menus: '', models: '', field_models: '', field_fields: '', domain_models: '',
                button_models: '', button_nodes: '', filter_models: '', filter_nodes: '',
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
            wizardMode: 'edit', wizardStep: 4, activeRule: rule, wizardOpen: true,
            wName: rule.name || '', wDesc: rule.sub || '',
            wActivate: rule.status === 'active',
            wRoles:    (ad.roles     || []).map(item => this._normalizeOption(item)),
            wDepts:    (ad.depts     || []).map(item => this._normalizeOption(item)),
            wUsers:    (ad.users     || []).map(item => this._normalizeOption(item)),
            wCompanies:(ad.companies || []).map(item => this._normalizeOption(item)),
            wExclude:  (ad.exclude   || []).map(item => this._normalizeOption(item)),
            wHideMenus: (cfg.hide_menus || []).map(item => this._normalizeOption(item)),
            wModelItems: (cfg.models || []).map(item => this._normalizeModelOption(item, true)),
            wFieldRules: this._normalizeFieldRules(cfg.fields || []),
            wDomainRules: this._normalizeDomainRules(cfg.domain_access || []),
            wButtonRules: this._normalizeButtonRules(cfg.button_tab_access || []),
            wFilterRules: this._normalizeFilterRules(cfg.filter_group_access || []),
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

    get modelAccessOptions() {
        return [
            {key: 'readonly', label: 'Read-only'},
            {key: 'restrict_create', label: 'Create'},
            {key: 'restrict_edit', label: 'Edit'},
            {key: 'restrict_delete', label: 'Delete'},
            {key: 'restrict_archive', label: 'Archive'},
            {key: 'restrict_duplicate', label: 'Duplicate'},
            {key: 'restrict_import', label: 'Import'},
            {key: 'restrict_export', label: 'Export'},
        ];
    }

    _normalizeModelOption(item, preserveLegacy=false) {
        const base = this._normalizeOption(item);
        const raw = item || {};
        const hasFlags = this.modelAccessOptions.some(opt => Object.prototype.hasOwnProperty.call(raw, opt.key));
        const flags = {};
        for (const opt of this.modelAccessOptions) {
            flags[opt.key] = hasFlags ? !!raw[opt.key] : !!preserveLegacy;
        }
        return {...base, ...flags};
    }

    _normalizeFieldRule(item) {
        const fields = (item.fields || []).map(field => ({
            id: field.id,
            name: field.name || field.field_description || field.field_name,
            field_name: field.field_name || field.name,
            ttype: field.ttype,
        }));
        return {
            id: item.id || `${item.model || item.model_id}-${Date.now()}-${Math.random()}`,
            model_id: item.model_id,
            model_name: item.model_name || item.name || item.model,
            model: item.model,
            fields,
            invisible: !!item.invisible,
            readonly: !!item.readonly,
            required: !!item.required,
            external_link: !!item.external_link,
        };
    }

    _normalizeFieldRules(items) {
        const rulesByField = new Map();
        for (const item of items || []) {
            const rule = this._normalizeFieldRule(item);
            for (const field of rule.fields || []) {
                const fieldKey = field.field_name || field.name || field.id;
                const key = `${rule.model || rule.model_id}:${fieldKey}`;
                rulesByField.set(key, {
                    ...rule,
                    id: `${rule.model || rule.model_id}-${fieldKey}`,
                    fields: [field],
                });
            }
        }
        return [...rulesByField.values()];
    }

    _normalizeDomainRule(item) {
        const base = this._normalizeOption(item);
        return {
            id: item.id || base.id || `${item.model || item.model_id}-${Date.now()}-${Math.random()}`,
            model_id: item.model_id || base.id,
            name: item.name || base.name,
            model: item.model,
            read_right: item.read_right !== false,
            create_right: !!item.create_right,
            write_right: !!item.write_right,
            delete_right: !!item.delete_right,
            apply_domain: !!item.apply_domain,
            domain: item.domain || '[]',
        };
    }

    _normalizeDomainRules(items) {
        return (items || []).map(item => this._normalizeDomainRule(item)).filter(item => item.model);
    }

    _normalizeButtonRule(item) {
        return {
            id: item.id || `${item.model || item.model_id}-${Date.now()}-${Math.random()}`,
            model_id: item.model_id,
            model_name: item.model_name || item.name || item.model,
            model: item.model,
            nodes: (item.nodes || []).map(node => ({
                id: node.id || `${node.node_type}|${node.attribute_name}|${node.button_type || ''}|${node.attribute_string || node.name || ''}`,
                node_type: node.node_type,
                name: node.name || node.attribute_string,
                attribute_name: node.attribute_name || '',
                attribute_string: node.attribute_string || node.name || '',
                button_type: node.button_type || '',
                is_smart_button: !!node.is_smart_button,
            })).filter(node => node.node_type),
        };
    }

    _normalizeButtonRules(items) {
        return (items || []).map(item => this._normalizeButtonRule(item)).filter(item => item.model && item.nodes.length);
    }

    _normalizeFilterRule(item) {
        return {
            id: item.id || `${item.model || item.model_id}-${Date.now()}-${Math.random()}`,
            model_id: item.model_id,
            model_name: item.model_name || item.name || item.model,
            model: item.model,
            nodes: (item.nodes || []).map(node => ({
                id: node.id || `${node.node_type}|${node.attribute_name}|${node.attribute_string || node.name || ''}`,
                node_type: node.node_type,
                name: node.name || node.attribute_string,
                attribute_name: node.attribute_name || '',
                attribute_string: node.attribute_string || node.name || '',
                field_name: node.field_name || '',
            })).filter(node => node.node_type),
        };
    }

    _normalizeFilterRules(items) {
        return (items || []).map(item => this._normalizeFilterRule(item)).filter(item => item.model && item.nodes.length);
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
        if (this.state.wActivate) {
            this.notification.add(_t('Reloading to apply Access Studio changes…'), {type: 'info'});
            this.reloadWithAccessToken(savedRule.cache_token);
        }
    }

    reloadWithAccessToken(token) {
        const url = new URL(window.location.href);
        url.searchParams.set('rbac_access_reload', token || Date.now().toString());
        setTimeout(() => window.location.replace(url.toString()), 900);
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
                models: this.state.wModelItems.map(item => ({
                    id: item.id,
                    name: item.name,
                    model: item.model,
                    readonly: !!item.readonly,
                    restrict_create: !!item.restrict_create,
                    restrict_edit: !!item.restrict_edit,
                    restrict_delete: !!item.restrict_delete,
                    restrict_archive: !!item.restrict_archive,
                    restrict_duplicate: !!item.restrict_duplicate,
                    restrict_import: !!item.restrict_import,
                    restrict_export: !!item.restrict_export,
                })),
                fields: this.state.wFieldRules
                    .filter(item => this._fieldRuleHasAnyAttribute(item))
                    .map(item => ({
                    id: item.id,
                    model_id: item.model_id,
                    model_name: item.model_name,
                    model: item.model,
                    fields: item.fields.map(field => ({
                        id: field.id,
                        name: field.name,
                        field_name: field.field_name,
                        ttype: field.ttype,
                    })),
                    invisible: !!item.invisible,
                    readonly: !!item.readonly,
                    required: !!item.required,
                    external_link: !!item.external_link,
                })),
                domain_access: this.state.wDomainRules.map(item => ({
                    id: item.model_id || item.id,
                    model_id: item.model_id || item.id,
                    name: item.name,
                    model: item.model,
                    read_right: !!item.read_right,
                    create_right: !!item.create_right,
                    write_right: !!item.write_right,
                    delete_right: !!item.delete_right,
                    apply_domain: !!item.apply_domain,
                    domain: item.apply_domain ? (item.domain || '[]') : '[]',
                })),
                button_tab_access: this.state.wButtonRules.map(item => ({
                    id: item.model_id || item.id,
                    model_id: item.model_id || item.id,
                    model_name: item.model_name,
                    name: item.model_name,
                    model: item.model,
                    nodes: item.nodes.map(node => ({
                        id: node.id,
                        node_type: node.node_type,
                        name: node.name,
                        attribute_name: node.attribute_name,
                        attribute_string: node.attribute_string,
                        button_type: node.button_type,
                        is_smart_button: !!node.is_smart_button,
                    })),
                })),
                filter_group_access: this.state.wFilterRules.map(item => ({
                    id: item.model_id || item.id,
                    model_id: item.model_id || item.id,
                    model_name: item.model_name,
                    name: item.model_name,
                    model: item.model,
                    nodes: item.nodes.map(node => ({
                        id: node.id,
                        node_type: node.node_type,
                        name: node.name,
                        attribute_name: node.attribute_name,
                        attribute_string: node.attribute_string,
                        field_name: node.field_name,
                    })),
                })),
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
        if (this.state.wFieldRules.length) impact.push({label: 'Field Access', type: 'restrict'});
        if (this.state.wDomainRules.length) impact.push({label: 'Domain Access', type: 'restrict'});
        if (this.state.wButtonRules.length) impact.push({label: 'Button/Tab', type: 'hide'});
        if (this.state.wFilterRules.length) impact.push({label: 'Filter/Group By', type: 'hide'});
        if (this.state.wGlobalHideImport)  impact.push({label: 'No Import', type: 'disable'});
        if (this.state.wGlobalHideExport)  impact.push({label: 'No Export', type: 'disable'});
        if (this.state.wGlobalDisableDevMode) impact.push({label: 'Block Dev', type: 'restrict'});
        return impact;
    }

    _buildRisk() {
        if (this.state.wGlobalForceReadonly || this.state.wGlobalDisableDevMode || this.state.wModelItems.length || this.state.wDomainRules.length) {
            return 'high';
        }
        if (this.state.wHideMenus.length || this.state.wFieldRules.length || this.state.wButtonRules.length || this.state.wFilterRules.length || this.state.wGlobalHideImport || this.state.wGlobalHideExport) {
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
            models: this.state.wModelItems, field_fields: this.state.wFieldItems,
            domain_models: this.state.wDomainRules,
            button_models: this.state.wButtonModel ? [this.state.wButtonModel] : [],
            button_nodes: this._currentButtonRule()?.nodes || [],
            filter_models: this.state.wFilterModel ? [this.state.wFilterModel] : [],
            filter_nodes: this._currentFilterRule()?.nodes || [],
        };
        return map[field] || [];
    }

    _sourceList(field) {
        const map = {
            roles: this.state.wAllRoles, depts: this.state.wAllDepts,
            users: this.state.wAllUsers, companies: this.state.wAllCompanies,
            exclude: this.state.wAllUsers, menus: this.state.wAllMenus,
            models: this.state.wAllModels, field_fields: this.state.wAllFieldChoices,
            domain_models: this.state.wAllModels,
            button_models: this.state.wAllModels, button_nodes: this.state.wAllButtonChoices,
            filter_models: this.state.wAllModels, filter_nodes: this.state.wAllFilterChoices,
        };
        return map[field] || [];
    }

    getFiltered(field) {
        const src = this._sourceList(field);
        const sel = this._selectedList(field);
        const selIds = new Set(sel.map(s => s.id));
        const q = (this.state.wSearches[field] || '').toLowerCase().trim();
        let filtered = src.filter(opt => !selIds.has(opt.id));
        if (field === 'field_fields' && this.state.wFieldModel) {
            filtered = filtered.filter(opt => !this._fieldAlreadyConfigured(this.state.wFieldModel.model, opt));
        }
        if (field === 'button_nodes' && this.state.wButtonModel) {
            filtered = filtered.filter(opt => !this._buttonNodeAlreadyConfigured(this.state.wButtonModel.model, opt));
        }
        if (field === 'filter_nodes' && this.state.wFilterModel) {
            filtered = filtered.filter(opt => !this._filterNodeAlreadyConfigured(this.state.wFilterModel.model, opt));
        }
        if (q) {
            filtered = filtered.filter((opt) => {
                const name = (opt.name || '').toLowerCase();
                const model = (opt.model || '').toLowerCase();
                const fieldName = (opt.field_name || '').toLowerCase();
                const attrName = (opt.attribute_name || '').toLowerCase();
                const attrString = (opt.attribute_string || '').toLowerCase();
                const nodeType = (opt.node_type || '').toLowerCase();
                return name.includes(q) || model.includes(q) || fieldName.includes(q) ||
                    attrName.includes(q) || attrString.includes(q) || nodeType.includes(q);
            });
        }
        const limit = field === 'menus' || field === 'models' || field === 'field_fields' || field === 'domain_models' || field === 'button_nodes' || field === 'button_models' || field === 'filter_nodes' || field === 'filter_models' ? 60 : 15;
        return filtered.slice(0, limit);
    }

    getFilteredFieldModels() {
        const selectedId = this.state.wFieldModel?.id;
        const q = (this.state.wSearches.field_models || '').toLowerCase().trim();
        let models = this.state.wAllModels.filter(model => model.id !== selectedId);
        if (q) {
            models = models.filter((model) => {
                const name = (model.name || '').toLowerCase();
                const technical = (model.model || '').toLowerCase();
                return name.includes(q) || technical.includes(q);
            });
        }
        return models.slice(0, 60);
    }

    openDropdown(field) {
        this.state.wOpenField = field;
    }

    closeDropdown() {
        this.state.wOpenField = '';
    }

    blurActiveInput() {
        const active = document.activeElement;
        if (active && typeof active.blur === 'function') {
            active.blur();
        }
    }

    scheduleClose(field) {
        setTimeout(() => {
            if (this.state.wOpenField === field) this.state.wOpenField = '';
        }, 150);
    }

    selectOption(field, opt) {
        if (field === 'field_fields') {
            this.addFieldRuleFromField(opt);
            this.state.wSearches[field] = '';
            this.state.wOpenField = '';
            this.blurActiveInput();
            return;
        }
        if (field === 'domain_models') {
            this.addDomainRule(opt);
            this.state.wSearches[field] = '';
            this.state.wOpenField = '';
            this.blurActiveInput();
            return;
        }
        if (field === 'button_nodes') {
            this.addButtonNode(opt);
            this.state.wSearches[field] = '';
            this.state.wOpenField = '';
            this.blurActiveInput();
            return;
        }
        if (field === 'filter_nodes') {
            this.addFilterNode(opt);
            this.state.wSearches[field] = '';
            this.state.wOpenField = '';
            this.blurActiveInput();
            return;
        }
        if (field === 'button_models') {
            this.selectButtonModel(opt);
            return;
        }
        if (field === 'filter_models') {
            this.selectFilterModel(opt);
            return;
        }
        const list = this._selectedList(field);
        if (!list.find(i => i.id === opt.id)) {
            if (field === 'models') {
                list.push(this._normalizeModelOption(opt, true));
            } else {
                list.push({id: opt.id, name: opt.name, model: opt.model});
            }
        }
        this.state.wSearches[field] = '';
        this.state.wOpenField = '';
        this.blurActiveInput();
    }

    onTokenizerKeydown(ev, field) {
        if (ev.key !== 'Backspace' || (this.state.wSearches[field] || '').length) {
            return;
        }
        const list = this._selectedList(field);
        if (list.length) {
            ev.preventDefault();
            list.pop();
        }
    }

    toggleModelAccess(modelId, key) {
        const item = this.state.wModelItems.find(model => model.id === modelId);
        if (item) {
            item[key] = !item[key];
        }
    }

    get selectedFieldModelName() {
        return this.state.wFieldModel?.name || '';
    }

    async selectFieldModel(model) {
        this.state.wFieldModelId = model ? String(model.id) : '';
        this.state.wFieldModel = model || null;
        this.state.wFieldItems = [];
        this.state.wAllFieldChoices = [];
        this.state.wSearches.field_models = '';
        this.state.wSearches.field_fields = '';
        this.state.wOpenField = model ? 'field_fields' : '';
        if (!model) return;
        try {
            this.state.wAllFieldChoices = await this.orm.call('rbac.model', 'get_access_studio_model_fields', [], {
                model_id: Number(model.id),
            });
            this.state.wOpenField = '';
            this.blurActiveInput();
        } catch (error) {
            console.warn('Field choices load failed:', error);
            this.notification.add(_t("Field list could not be loaded. Restart/upgrade rbac_manager if this was just installed."), {
                type: "danger",
            });
        }
    }

    async selectButtonModel(model) {
        this.state.wButtonModel = model || null;
        this.state.wAllButtonChoices = [];
        this.state.wSearches.button_models = '';
        this.state.wSearches.button_nodes = '';
        this.state.wOpenField = model ? 'button_nodes' : '';
        if (!model) return;
        try {
            this.state.wAllButtonChoices = await this.orm.call('rbac.model', 'get_access_studio_view_nodes', [], {
                model_id: Number(model.id),
            });
            this.state.wOpenField = '';
            this.blurActiveInput();
        } catch (error) {
            console.warn('Button/tab choices load failed:', error);
            this.notification.add(_t("Button/tab list could not be loaded."), {type: "danger"});
        }
    }

    async selectFilterModel(model) {
        this.state.wFilterModel = model || null;
        this.state.wAllFilterChoices = [];
        this.state.wSearches.filter_models = '';
        this.state.wSearches.filter_nodes = '';
        this.state.wOpenField = model ? 'filter_nodes' : '';
        if (!model) return;
        try {
            this.state.wAllFilterChoices = await this.orm.call('rbac.model', 'get_access_studio_search_nodes', [], {
                model_id: Number(model.id),
            });
            this.state.wOpenField = '';
            this.blurActiveInput();
        } catch (error) {
            console.warn('Filter/group choices load failed:', error);
            this.notification.add(_t("Filter/group-by list could not be loaded."), {type: "danger"});
        }
    }

    async onFieldModelChange(ev) {
        const modelId = ev.target.value;
        const model = this.state.wAllModels.find(item => String(item.id) === String(modelId)) || null;
        await this.selectFieldModel(model);
    }

    clearFieldModel() {
        this.state.wFieldModelId = '';
        this.state.wFieldModel = null;
        this.state.wFieldItems = [];
        this.state.wAllFieldChoices = [];
        this.state.wSearches.field_models = '';
        this.state.wSearches.field_fields = '';
        this.state.wOpenField = '';
    }

    onFieldModelInput(ev) {
        this.state.wSearches.field_models = ev.target.value;
        this.state.wOpenField = 'field_models';
    }

    onFieldModelKeydown(ev) {
        if (ev.key !== 'Backspace' || (this.state.wSearches.field_models || '').length || !this.state.wFieldModel) {
            return;
        }
        ev.preventDefault();
        this.clearFieldModel();
    }

    onButtonModelInput(ev) {
        this.state.wSearches.button_models = ev.target.value;
        this.state.wOpenField = 'button_models';
    }

    onButtonModelKeydown(ev) {
        if (ev.key !== 'Backspace' || (this.state.wSearches.button_models || '').length || !this.state.wButtonModel) {
            return;
        }
        ev.preventDefault();
        this.clearButtonModel();
    }

    clearButtonModel() {
        this.state.wButtonModel = null;
        this.state.wAllButtonChoices = [];
        this.state.wSearches.button_models = '';
        this.state.wSearches.button_nodes = '';
        this.state.wOpenField = '';
    }

    onFilterModelInput(ev) {
        this.state.wSearches.filter_models = ev.target.value;
        this.state.wOpenField = 'filter_models';
    }

    onFilterModelKeydown(ev) {
        if (ev.key !== 'Backspace' || (this.state.wSearches.filter_models || '').length || !this.state.wFilterModel) {
            return;
        }
        ev.preventDefault();
        this.clearFilterModel();
    }

    clearFilterModel() {
        this.state.wFilterModel = null;
        this.state.wAllFilterChoices = [];
        this.state.wSearches.filter_models = '';
        this.state.wSearches.filter_nodes = '';
        this.state.wOpenField = '';
    }

    addFieldRule() {
        if (!this.state.wFieldModel || !this.state.wFieldItems.length) return;
        if (!this._currentFieldRuleHasAnyAttribute()) return;
        for (const field of this.state.wFieldItems) {
            this.addFieldRuleFromField(field);
        }
        this.state.wFieldItems = [];
        this.state.wSearches.field_fields = '';
    }

    addFieldRuleFromField(field) {
        if (!this.state.wFieldModel || !field || this._fieldAlreadyConfigured(this.state.wFieldModel.model, field)) {
            return;
        }
        this._removeFieldFromExistingRules(this.state.wFieldModel.model, field);
        this.state.wFieldRules.push({
            id: `${this.state.wFieldModel.id}-${field.id}-${Date.now()}`,
            model_id: this.state.wFieldModel.id,
            model_name: this.state.wFieldModel.name,
            model: this.state.wFieldModel.model,
            fields: [{
                id: field.id,
                name: field.name,
                field_name: field.field_name,
                ttype: field.ttype,
            }],
            invisible: true,
            readonly: false,
            required: false,
            external_link: false,
        });
    }

    _fieldAlreadyConfigured(modelName, field) {
        return this.state.wFieldRules.some(rule => {
            if (rule.model !== modelName) {
                return false;
            }
            return (rule.fields || []).some(ruleField => {
                const sameId = ruleField.id && field.id && String(ruleField.id) === String(field.id);
                const sameName = ruleField.field_name && field.field_name && ruleField.field_name === field.field_name;
                return sameId || sameName;
            });
        });
    }

    _removeFieldFromExistingRules(modelName, field) {
        for (let index = this.state.wFieldRules.length - 1; index >= 0; index--) {
            const rule = this.state.wFieldRules[index];
            if (rule.model !== modelName) {
                continue;
            }
            rule.fields = rule.fields.filter(ruleField => {
                const sameId = ruleField.id && field.id && String(ruleField.id) === String(field.id);
                const sameName = ruleField.field_name && field.field_name && ruleField.field_name === field.field_name;
                return !(sameId || sameName);
            });
            if (!rule.fields.length) {
                this.state.wFieldRules.splice(index, 1);
            }
        }
    }

    _currentFieldRuleHasAnyAttribute() {
        return !!(
            this.state.wFieldInvisible ||
            this.state.wFieldReadonly ||
            this.state.wFieldRequired ||
            this.state.wFieldExternalLink
        );
    }

    _fieldRuleFieldNames(rule) {
        return (rule.fields || []).map(field => field.name).join(', ');
    }

    _fieldRuleTechnicalNames(rule) {
        return (rule.fields || []).map(field => field.field_name).filter(Boolean).join(', ');
    }

    _fieldRuleAttributeCount(rule) {
        return ['invisible', 'readonly', 'required', 'external_link'].filter(key => rule[key]).length;
    }

    _fieldRuleAttributeLabel(rule) {
        const count = this._fieldRuleAttributeCount(rule);
        if (!count) return 'No attributes active';
        if (count === 1) return '1 active';
        return `${count} active`;
    }

    get fieldRuleAttributeOptions() {
        return [
            {key: 'invisible', label: 'Hide', icon: 'fa fa-eye-slash'},
            {key: 'readonly', label: 'Read', icon: 'fa fa-lock'},
            {key: 'required', label: 'Req', icon: 'fa fa-asterisk'},
            {key: 'external_link', label: 'Link', icon: 'fa fa-external-link'},
        ];
    }

    _fieldRuleHasAnyAttribute(rule) {
        return !!(rule.invisible || rule.readonly || rule.required || rule.external_link);
    }

    setFieldRuleAttribute(ruleId, key, value) {
        const rule = this.state.wFieldRules.find(item => item.id === ruleId);
        if (!rule || !['invisible', 'readonly', 'required', 'external_link'].includes(key)) {
            return;
        }
        rule[key] = !!value;
    }

    removeFieldRule(id) {
        const idx = this.state.wFieldRules.findIndex(rule => rule.id === id);
        if (idx >= 0) this.state.wFieldRules.splice(idx, 1);
    }

    _currentButtonRule() {
        if (!this.state.wButtonModel) {
            return null;
        }
        return this.state.wButtonRules.find(rule => rule.model === this.state.wButtonModel.model) || null;
    }

    addButtonNode(node) {
        if (!this.state.wButtonModel || !node || this._buttonNodeAlreadyConfigured(this.state.wButtonModel.model, node)) {
            return;
        }
        let rule = this._currentButtonRule();
        if (!rule) {
            rule = {
                id: this.state.wButtonModel.id,
                model_id: this.state.wButtonModel.id,
                model_name: this.state.wButtonModel.name,
                model: this.state.wButtonModel.model,
                nodes: [],
            };
            this.state.wButtonRules.push(rule);
        }
        rule.nodes.push({
            id: node.id,
            node_type: node.node_type,
            name: node.name,
            attribute_name: node.attribute_name,
            attribute_string: node.attribute_string,
            button_type: node.button_type || '',
            is_smart_button: !!node.is_smart_button,
        });
    }

    _buttonNodeAlreadyConfigured(modelName, node) {
        return this.state.wButtonRules.some(rule => rule.model === modelName && (rule.nodes || []).some(existing => existing.id === node.id));
    }

    removeButtonNode(ruleId, nodeId) {
        const rule = this.state.wButtonRules.find(item => item.id === ruleId);
        if (!rule) return;
        const idx = rule.nodes.findIndex(node => node.id === nodeId);
        if (idx >= 0) rule.nodes.splice(idx, 1);
        if (!rule.nodes.length) {
            this.removeButtonRule(ruleId);
        }
    }

    removeButtonRule(ruleId) {
        const idx = this.state.wButtonRules.findIndex(rule => rule.id === ruleId);
        if (idx >= 0) this.state.wButtonRules.splice(idx, 1);
    }

    _currentFilterRule() {
        if (!this.state.wFilterModel) {
            return null;
        }
        return this.state.wFilterRules.find(rule => rule.model === this.state.wFilterModel.model) || null;
    }

    addFilterNode(node) {
        if (!this.state.wFilterModel || !node || this._filterNodeAlreadyConfigured(this.state.wFilterModel.model, node)) {
            return;
        }
        let rule = this._currentFilterRule();
        if (!rule) {
            rule = {
                id: this.state.wFilterModel.id,
                model_id: this.state.wFilterModel.id,
                model_name: this.state.wFilterModel.name,
                model: this.state.wFilterModel.model,
                nodes: [],
            };
            this.state.wFilterRules.push(rule);
        }
        rule.nodes.push({
            id: node.id,
            node_type: node.node_type,
            name: node.name,
            attribute_name: node.attribute_name,
            attribute_string: node.attribute_string,
            field_name: node.field_name || '',
        });
    }

    _filterNodeAlreadyConfigured(modelName, node) {
        return this.state.wFilterRules.some(rule => rule.model === modelName && (rule.nodes || []).some(existing => existing.id === node.id));
    }

    removeFilterNode(ruleId, nodeId) {
        const rule = this.state.wFilterRules.find(item => item.id === ruleId);
        if (!rule) return;
        const idx = rule.nodes.findIndex(node => node.id === nodeId);
        if (idx >= 0) rule.nodes.splice(idx, 1);
        if (!rule.nodes.length) {
            this.removeFilterRule(ruleId);
        }
    }

    removeFilterRule(ruleId) {
        const idx = this.state.wFilterRules.findIndex(rule => rule.id === ruleId);
        if (idx >= 0) this.state.wFilterRules.splice(idx, 1);
    }

    addDomainRule(model) {
        if (!model || this.state.wDomainRules.some(rule => rule.model === model.model)) {
            return;
        }
        this.state.wDomainRules.push({
            id: model.id,
            model_id: model.id,
            name: model.name,
            model: model.model,
            read_right: true,
            create_right: false,
            write_right: false,
            delete_right: false,
            apply_domain: true,
            domain: '[]',
        });
    }

    toggleDomainRight(ruleId, key) {
        const rule = this.state.wDomainRules.find(item => item.id === ruleId);
        if (!rule || !['read_right', 'create_right', 'write_right', 'delete_right', 'apply_domain'].includes(key)) {
            return;
        }
        rule[key] = !rule[key];
        if (!rule.read_right) {
            rule.create_right = false;
            rule.write_right = false;
            rule.delete_right = false;
            rule.apply_domain = true;
            rule.domain = '[["id","=",False]]';
        }
        if ((key === 'create_right' || key === 'write_right' || key === 'delete_right') && rule[key]) {
            rule.read_right = true;
        }
        if (key === 'delete_right' && rule.delete_right) {
            rule.write_right = true;
        }
        if (!rule.apply_domain) {
            rule.domain = '[]';
        }
    }

    setDomainValue(ruleId, value) {
        const rule = this.state.wDomainRules.find(item => item.id === ruleId);
        if (rule) {
            rule.domain = value;
        }
    }

    removeDomainRule(ruleId) {
        const idx = this.state.wDomainRules.findIndex(rule => rule.id === ruleId);
        if (idx >= 0) this.state.wDomainRules.splice(idx, 1);
    }

    setModelPreset(modelId, preset) {
        const item = this.state.wModelItems.find(model => model.id === modelId);
        if (!item) return;
        for (const opt of this.modelAccessOptions) {
            item[opt.key] = false;
        }
        if (preset === 'readonly') {
            item.readonly = true;
        } else if (preset === 'all') {
            for (const opt of this.modelAccessOptions) {
                item[opt.key] = true;
            }
        }
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

    // ── Stepper navigation ────────────────────────────────────────────────────

    goToStep(step) {
        if (this.state.wizardMode === 'edit') {
            this.state.wizardStep = step;
            return;
        }
        // In new mode only allow going back to already-visited steps
        if (step < this.state.wizardStep) {
            this.state.wizardStep = step;
        }
    }

    // ── Rule row actions ──────────────────────────────────────────────────────

    async toggleRuleStatus(rule, ev) {
        ev.stopPropagation();
        try {
            const result = await this.orm.call(
                'rbac.model', 'toggle_access_rule_status', [], {rule_id: rule.id}
            );
            const newActive = typeof result === 'object' ? result.active : result;
            if (newActive === null || newActive === undefined) return;
            const newStatus = newActive ? 'active' : 'draft';
            const idx = this.state.rules.findIndex(r => r.id === rule.id);
            if (idx >= 0) {
                this.state.rules[idx] = {...this.state.rules[idx], status: newStatus};
            }
            const label = newStatus === 'active' ? _t('enabled') : _t('disabled');
            this.notification.add(
                _t('Rule "%s" %s. Reloading menus…', rule.name, label),
                {type: 'success'}
            );
            this.reloadWithAccessToken(typeof result === 'object' ? result.cache_token : null);
        } catch (e) {
            this.notification.add(_t('Failed to toggle rule status.'), {type: 'danger'});
        }
    }

    deleteRule(rule, ev) {
        ev.stopPropagation();
        this.state.confirmRule = rule;
        this.state.confirmOpen = true;
    }

    cancelDelete() {
        this.state.confirmOpen = false;
        this.state.confirmRule = null;
    }

    async confirmDelete() {
        const rule = this.state.confirmRule;
        this.state.confirmOpen = false;
        this.state.confirmRule = null;
        if (!rule) return;
        try {
            const result = await this.orm.call('rbac.model', 'delete_access_rule', [], {rule_id: rule.id});
            const idx = this.state.rules.findIndex(r => r.id === rule.id);
            if (idx >= 0) this.state.rules.splice(idx, 1);
            this.notification.add(_t('Rule "%s" deleted. Reloading menus…', rule.name), {type: 'warning'});
            this.reloadWithAccessToken(typeof result === 'object' ? result.cache_token : null);
        } catch (e) {
            this.notification.add(_t('Failed to delete rule.'), {type: 'danger'});
        }
    }

    ruleStatusTitle(rule) {
        return rule.status === 'active' ? _t('Disable rule') : _t('Enable rule');
    }

    ruleStatusIcon(rule) {
        return rule.status === 'active' ? 'fa fa-pause' : 'fa fa-play';
    }

    ruleStatusButtonClass(rule) {
        return rule.status === 'active' ? 'as_row_btn_disable' : 'as_row_btn_enable';
    }

    get confirmDeleteTitle() {
        return this.state.confirmRule?.name || '';
    }
}

registry.category("actions").add("rbac.access_studio", RBACAccessStudio);
