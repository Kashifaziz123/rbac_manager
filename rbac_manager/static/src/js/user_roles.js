/* @odoo-module */

import {Component, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";


export class RBACUserRoles extends Component {
    static template = "rbac.UserRoles";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.dialogService  = useService("dialog");
        this.action         = useService("action");
        this.orm            = useService("orm");
        this.searchInput    = useRef("searchInput");

        this.record_id = this.props?.action?.context?.active_id;
        this.is_wizard = this.props?.action?.context?.is_wizard;
        this.user = [];
        this.roleState = useState({ name: '' });
        this.isNewRole = useState({ value: !!this.props?.action?.context?.is_new_role });
        this.uiState  = useState({ nameError: false });

        // All filtering/pagination parameters sent to Python on every fetch.
        this.filterState = useState({
            search:      '',
            riskLevels:  [],   // e.g. ['low', 'high'] — empty = no filter
            currentPage: 1,
            pageSize:    20,
        });

        // Pagination metadata returned by Python.
        this.pageInfo = useState({ total: 0, totalPages: 1 });

        // Current page of data (already filtered & paginated by Python).
        this.categories = useState({});

        // Accumulated user edits: { fieldName: newValue }.
        // Only entries the user actually changed are stored here; no full data clone needed.
        this.changes = {};

        this._searchTimer = null;

        useEffect(
            () => { this.enabled_inputs_length(); },
            () => [this.categories]
        );

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
        });

        onMounted(() => { this.enabled_inputs_length(); });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    enabled_inputs_length() {
        $('.category-section').each(function () {
            const $inputs = $(this).find('input');
            $(this).find('.enabled_count').text($inputs.filter(':checked:not(:disabled)').length);
        });
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

    /**
     * Return the value to display for a field, overlaying any unsaved local change
     * on top of the server-provided value.
     */
    getFieldValue(field, serverData) {
        return this.changes[field] !== undefined ? this.changes[field] : serverData.value;
    }

    // ── Category collapse ─────────────────────────────────────────────────────

    toggle_category_section(ev) {
        if ($(ev).closest('button').length) return;
        $(ev).closest('.category-header').toggleClass('closed');
    }

    toggle_category_all_checked_enabled(check, ev) {
        this._toggle_section_inputs(check, $(ev).closest('.category-section'));
    }

    _toggle_section_inputs(check, section) {
        section.find('input[type="checkbox"]').prop({checked: check, indeterminate: false});
        const $radios = section.find('input[type="radio"]');
        if (check) {
            const names = [...new Set($radios.map((_, el) => el.name).get().filter(Boolean))];
            names.forEach(name =>
                section.find(`input[type="radio"][name="${name}"]`).last().prop('checked', true)
            );
        } else {
            $radios.prop('checked', false);
        }
        section.find('input[type="checkbox"], input[type="radio"]').each((_, el) => {
            this.update_values(el);
        });
    }

    // ── Value change tracking ─────────────────────────────────────────────────

    update_values(ev) {
        const fieldName = $(ev).attr('name');
        let newValue = false;
        if ($(ev).filter(':checked:not(:disabled)').length) {
            newValue = $(ev).val();
        }
        // 'on' = checkbox with no explicit value → treat as boolean true
        newValue = newValue === 'on' ? true : parseInt(newValue);
        this.changes[fieldName] = newValue;
        this.enabled_inputs_length();
    }

    // ── Risk-level filter ─────────────────────────────────────────────────────

    is_risk_active(level) {
        return this.filterState.riskLevels.includes(level);
    }

    toggle_risk_level(level) {
        const idx = this.filterState.riskLevels.indexOf(level);
        if (idx >= 0) {
            this.filterState.riskLevels.splice(idx, 1);
        } else {
            this.filterState.riskLevels.push(level);
        }
        this.filterState.currentPage = 1;
        this.fetch_data();
    }

    // ── Search (debounced 300 ms) ─────────────────────────────────────────────

    apply_search() {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(async () => {
            this.filterState.search = this.searchInput.el?.value || '';
            this.filterState.currentPage = 1;
            await this.fetch_data();
        }, 300);
    }

    // ── Pagination ────────────────────────────────────────────────────────────

    getPageNumbers() {
        const total = this.pageInfo.totalPages;
        const current = this.filterState.currentPage;
        const max = 5;
        if (total <= max) return Array.from({length: total}, (_, i) => i + 1);
        let start = Math.max(1, current - Math.floor(max / 2));
        let end   = start + max - 1;
        if (end > total) { end = total; start = Math.max(1, end - max + 1); }
        return Array.from({length: end - start + 1}, (_, i) => start + i);
    }

    goToPage(page) {
        const p = parseInt(page, 10);
        if (p >= 1 && p <= this.pageInfo.totalPages) {
            this.filterState.currentPage = p;
            this.fetch_data();
        }
    }

    prevPage() { this.goToPage(this.filterState.currentPage - 1); }
    nextPage() { this.goToPage(this.filterState.currentPage + 1); }

    get paginationStart() {
        return this.pageInfo.total === 0
            ? 0
            : (this.filterState.currentPage - 1) * this.filterState.pageSize + 1;
    }

    get paginationEnd() {
        return Math.min(
            this.filterState.currentPage * this.filterState.pageSize,
            this.pageInfo.total
        );
    }

    // ── Data fetch (all heavy lifting done by Python) ─────────────────────────

    async fetch_data() {
        this.user = await this.orm.searchRead(
            "res.users",
            [['id', '=', this.record_id], ['is_user_role', '=', true], ['active', '=', false]],
            ["name"]
        );
        // For existing roles: always sync name from server.
        // For new roles being created: leave roleState.name as-is so the user's
        // typed value survives pagination and the placeholder shows on first load.
        if (!this.isNewRole.value) {
            this.roleState.name = this.user[0]?.name || '';
        }
        if (!this.user[0]?.name) {
            this.notification.add(
                _t("Record %s not found. It may have been deleted.", this.record_id),
                {sticky: true, type: "danger"}
            );
            this.action.doAction('rbac_manager.act_window_res_users_list_user_role',
                {clearBreadcrumbs: true});
            return;
        }

        // Python does the filtering, searching, and pagination.
        const result = await this.orm.call("rbac.model", "get_role_templates", [], {
            user_id:     this.record_id,
            page:        this.filterState.currentPage,
            page_size:   this.filterState.pageSize,
            search:      this.filterState.search,
            risk_levels: this.filterState.riskLevels,
        });

        // Replace reactive dict contents without breaking OWL tracking
        const newCats = result.categories || {};
        for (const k of Object.keys(this.categories)) delete this.categories[k];
        Object.assign(this.categories, newCats);

        this.pageInfo.total      = result.total      || 0;
        this.pageInfo.totalPages = result.total_pages || 1;

        // Clamp page if the result set shrank
        if (this.filterState.currentPage > this.pageInfo.totalPages) {
            this.filterState.currentPage = this.pageInfo.totalPages;
        }
    }

    // ── New Role ──────────────────────────────────────────────────────────────

    async newRole() {
        const action = await this.orm.call('res.users', 'action_create_new_user_role', []);
        await this.action.doAction(action);
    }

    async discardNewRole() {
        // Delete the blank role template that was just created and return to kanban
        if (this.record_id) {
            await this.orm.call('res.users', 'discard_new_user_role', [this.record_id]);
        }
        await this.action.doAction(
            'rbac_manager.act_window_res_users_list_user_role',
            { clearBreadcrumbs: true }
        );
    }

    async saveNewRole() {
        // Validate name
        const newName = this.roleState.name.trim();
        if (!newName) {
            this.uiState.nameError = true;
            this.notification.add(_t("Role name cannot be empty."), { type: "danger" });
            return;
        }
        const duplicate = await this.orm.searchCount(
            'res.users',
            [['name', '=', newName], ['is_user_role', '=', true], ['id', '!=', this.record_id]],
            { context: { active_test: false } }
        );
        if (duplicate > 0) {
            this.uiState.nameError = true;
            this.notification.add(
                _t('A role named "%s" already exists. Please choose a different name.', newName),
                { type: "danger" }
            );
            return;
        }
        this.uiState.nameError = false;
        await this.orm.write("res.users", [this.record_id], { name: newName });
        this.isNewRole.value = false;
        await this.fetch_data();
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    reset_data() {
        if (this.searchInput.el) this.searchInput.el.value = '';
        this.filterState.search      = '';
        this.filterState.riskLevels  = [];
        this.filterState.currentPage = 1;
        $('.category-header').removeClass('closed');
    }

    // ── Save / Discard ────────────────────────────────────────────────────────

    async writeRecord() {
        /**
         * Odoo 19: in_group_X / sel_groups_X_Y_Z fields are gone.
         * Convert this.changes directly into group_ids Many2many commands.
         */
        function toGroupIdCommands(changes) {
            const cmds = [];
            for (const [field, value] of Object.entries(changes)) {
                if (field.startsWith('in_group_')) {
                    const gid = parseInt(field.replace('in_group_', ''), 10);
                    cmds.push(value ? [4, gid] : [3, gid]);
                } else if (field.startsWith('sel_groups_')) {
                    const ids = field.replace('sel_groups_', '').split('_').map(Number);
                    for (const id of ids) cmds.push([3, id]);          // unlink all
                    if (value) cmds.push([4, parseInt(value, 10)]);    // link chosen
                }
            }
            return cmds;
        }

        // Validate name before showing confirmation dialog
        const newName = this.roleState.name.trim();
        if (!newName) {
            this.uiState.nameError = true;
            this.notification.add(_t("Role name cannot be empty."), { type: "danger" });
            return;
        }
        if (newName !== (this.user[0]?.name || '')) {
            const duplicate = await this.orm.searchCount(
                'res.users',
                [
                    ['name', '=', newName],
                    ['is_user_role', '=', true],
                    ['id', '!=', this.record_id],
                ],
                { context: { active_test: false } }
            );
            if (duplicate > 0) {
                this.uiState.nameError = true;
                this.notification.add(
                    _t('A role named "%s" already exists. Please choose a different name.', newName),
                    { type: "danger" }
                );
                return;
            }
        }
        this.uiState.nameError = false;

        this.dialogService.add(ConfirmationDialog, {
            body: _t("Are you sure you want to save the changes?"),
            cancelLabel:  _t("No"),
            confirmLabel: _t("Yes"),
            confirm: async () => {
                const cmds = toGroupIdCommands(this.changes);
                const writes = {};
                if (cmds.length) writes.group_ids = cmds;
                if (newName && newName !== (this.user[0]?.name || '')) {
                    writes.name = newName;
                }
                if (Object.keys(writes).length) {
                    await this.orm.write("res.users", [this.record_id], writes);
                }
                this.changes = {};           // clear pending edits after save
                this.isNewRole.value = false; // lock name after first save
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {},
        });
    }

    discardRecord() {
        this.dialogService.add(ConfirmationDialog, {
            body: _t("Are you sure you want to discard the changes?"),
            cancelLabel:  _t("No"),
            confirmLabel: _t("Yes"),
            confirm: async () => {
                this.changes = {};
                this.roleState.name = ''; // clear so fetch_data always reloads from server
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {},
        });
    }
}

registry.category("actions").add("rbac.user_role", RBACUserRoles);
