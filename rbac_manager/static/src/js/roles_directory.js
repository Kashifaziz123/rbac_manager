/* @odoo-module */

import {Component, onMounted, onWillStart, useState, useRef} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

const AVATAR_COLORS = [
    '#3a5bd9','#0d9488','#16a34a','#ca8a04','#ea580c',
    '#db2777','#0891b2','#dc2626','#475569','#2563eb',
];

function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initials(name) {
    const w = (name || '').trim().split(/\s+/);
    return w[1] ? (w[0][0] + w[1][0]).toUpperCase() : (w[0] || '').slice(0, 2).toUpperCase();
}

export class RBACRolesDirectory extends Component {
    static template = "rbac.RolesDirectory";

    setup() {
        super.setup();
        this.notification  = useService("notification");
        this.dialogService = useService("dialog");
        this.action        = useService("action");
        this.orm           = useService("orm");

        this.searchRef      = useRef("searchInput");
        this.panelNameRef   = useRef("panelName");
        this.panelDescRef   = useRef("panelDesc");
        this.permSearchRef  = useRef("permSearch");
        this.panelUserSearchRef = useRef("panelUserSearch");
        this.modalNameRef   = useRef("modalName");
        this.modalDescRef   = useRef("modalDesc");
        this.modalPermSearchRef = useRef("modalPermSearch");
        this.modalUserSearchRef = useRef("modalUserSearch");

        this.state = useState({
            roles: [],
            allGroups: [],
            allUsers: [],
            loading: true,
            search: '',
            panelOpen: false,
            modalOpen: false,
            activeRole: null,       // full role object from this.state.roles
            selectedGroupIds: [],   // groups selected in panel
            selectedUserIds: [],
            panelPermSearch: '',
            panelUserSearch: '',
            panelPermFilter: 'assigned',
            panelPermCategory: '',
            panelUserFilter: 'assigned',
            panelPermManagerOpen: false,
            panelUserManagerOpen: false,
            modalPermSearch: '',
            modalPermCategory: '',
            modalSelectedGroupIds: [],
            modalUserSearch: '',
            modalSelectedUserIds: [],
            saving: false,
            deleting: false,
            activityLoading: false,
            activityRecords: [],
            activityLoaded: 0,
            activityTotal: 0,
        });

        onWillStart(async () => { await this.loadData(); });
        onMounted(() => {});
    }

    // ── Data ──────────────────────────────────────────────────────────────────

    async loadData() {
        this.state.loading = true;
        try {
            const result = await this.orm.call("rbac.model", "get_roles_directory", [], {});
            this.state.roles     = result.roles     || [];
            this.state.allGroups = result.all_groups || [];
            this.state.allUsers  = result.all_users || [];
        } finally {
            this.state.loading = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    avatarColor(name) { return avatarColor(name); }
    initials(name)    { return initials(name); }

    markInvalid(el) {
        if (!el) return;
        el.classList.add('rd_input_error');
        el.scrollIntoView({behavior: 'smooth', block: 'center'});
        el.focus();
        const clear = () => {
            el.classList.remove('rd_input_error');
            el.removeEventListener('input', clear);
            el.removeEventListener('change', clear);
        };
        el.addEventListener('input', clear);
        el.addEventListener('change', clear);
    }

    get filteredRoles() {
        const q = this.state.search.trim().toLowerCase();
        if (!q) return this.state.roles;
        return this.state.roles.filter(r =>
            r.name.toLowerCase().includes(q) ||
            (r.description || '').toLowerCase().includes(q)
        );
    }

    get panelGroups() {
        const q = this.state.panelPermSearch.trim().toLowerCase();
        return this.state.allGroups.filter(g => {
            const assigned = this.isPanelGroupChecked(g.id);
            const matchesFilter =
                this.state.panelPermFilter === 'all' ||
                (this.state.panelPermFilter === 'assigned' && assigned) ||
                (this.state.panelPermFilter === 'unassigned' && !assigned);
            const matchesQuery = !q ||
                String(g.full_name || "").toLowerCase().includes(q) ||
                String(g.category || "Other").toLowerCase().includes(q);
            return matchesFilter && matchesQuery;
        });
    }

    groupPermissions(groups) {
        const buckets = new Map();
        for (const group of groups || []) {
            const category = String(group.category || 'Other');
            if (!buckets.has(category)) {
                buckets.set(category, []);
            }
            buckets.get(category).push(group);
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
            .map(([category, items]) => ({
                category,
                items: items.sort((a, b) => String(a.full_name || a.name || '').localeCompare(String(b.full_name || b.name || ''))),
            }));
    }

    get panelPermissionGroups() {
        return this.groupPermissions(this.panelGroups);
    }

    get panelPermissionCategories() {
        return this.permissionCategories(this.state.allGroups);
    }

    get filteredPanelCategoryGroups() {
        const categories = this.panelPermissionGroups;
        const selected = this.state.panelPermCategory || categories[0]?.category || '';
        return categories.find((cat) => cat.category === selected)?.items || [];
    }

    get modalGroups() {
        const q = this.state.modalPermSearch.trim().toLowerCase();
        if (!q) return this.state.allGroups;
        return this.state.allGroups.filter(g =>
            String(g.full_name || "").toLowerCase().includes(q) ||
            String(g.category || "Other").toLowerCase().includes(q)
        );
    }

    get modalPermissionGroups() {
        return this.groupPermissions(this.modalGroups);
    }

    get modalPermissionCategories() {
        return this.permissionCategories(this.state.allGroups);
    }

    get filteredModalCategoryGroups() {
        const categories = this.modalPermissionGroups;
        const selected = this.state.modalPermCategory || categories[0]?.category || '';
        return categories.find((cat) => cat.category === selected)?.items || [];
    }

    permissionCategories(groups) {
        const counts = new Map();
        for (const group of groups || []) {
            const category = String(group.category || 'Other');
            counts.set(category, (counts.get(category) || 0) + 1);
        }
        return [...counts.entries()]
            .sort(([a], [b]) => String(a).localeCompare(String(b)))
            .map(([category, count]) => ({category, count}));
    }

    panelCategoryCount(category) {
        return this.panelPermissionGroups.find((cat) => cat.category === category)?.items.length || 0;
    }

    modalCategoryCount(category) {
        return this.modalPermissionGroups.find((cat) => cat.category === category)?.items.length || 0;
    }

    get modalUsers() {
        const q = this.state.modalUserSearch.trim().toLowerCase();
        const users = this.state.allUsers || [];
        if (!q) return users.slice(0, 18);
        return users.filter(u =>
            (u.name || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q)
        ).slice(0, 18);
    }

    get panelUsers() {
        const q = this.state.panelUserSearch.trim().toLowerCase();
        const users = this.state.allUsers || [];
        return users.filter(u => {
            const assigned = this.isPanelUserChecked(u.id);
            const matchesFilter =
                this.state.panelUserFilter === 'all' ||
                (this.state.panelUserFilter === 'assigned' && assigned) ||
                (this.state.panelUserFilter === 'unassigned' && !assigned);
            const matchesQuery = !q ||
                (u.name || '').toLowerCase().includes(q) ||
                (u.email || '').toLowerCase().includes(q);
            return matchesFilter && matchesQuery;
        });
    }

    get panelAssignedGroups() {
        return (this.state.allGroups || []).filter(g => this.isPanelGroupChecked(g.id));
    }

    get panelAssignedUsers() {
        return (this.state.allUsers || []).filter(u => this.isPanelUserChecked(u.id));
    }

    get panelPermissionSummary() {
        const total = (this.state.allGroups || []).length;
        const assigned = this.state.selectedGroupIds.length;
        return {total, assigned, unassigned: Math.max(total - assigned, 0)};
    }

    get panelUserSummary() {
        const total = (this.state.allUsers || []).length;
        const assigned = this.state.selectedUserIds.length;
        return {total, assigned, unassigned: Math.max(total - assigned, 0)};
    }

    isPanelGroupChecked(groupId) {
        return this.state.selectedGroupIds.includes(groupId);
    }

    isPanelUserChecked(userId) {
        return this.state.selectedUserIds.includes(userId);
    }

    isModalGroupChecked(groupId) {
        return this.state.modalSelectedGroupIds.includes(groupId);
    }

    isModalUserChecked(userId) {
        return this.state.modalSelectedUserIds.includes(userId);
    }

    // ── Search ────────────────────────────────────────────────────────────────

    onSearch(ev) {
        this.state.search = ev.target.value;
    }

    onPanelPermSearch(ev) {
        this.state.panelPermSearch = ev.target.value;
        this.state.panelPermCategory = '';
    }

    onPanelUserSearch(ev) {
        this.state.panelUserSearch = ev.target.value;
    }

    setPanelPermFilter(filter) {
        this.state.panelPermFilter = filter;
        this.state.panelPermCategory = '';
    }

    setPanelPermCategory(category) {
        this.state.panelPermCategory = category;
    }

    setPanelUserFilter(filter) {
        this.state.panelUserFilter = filter;
    }

    onModalPermSearch(ev) {
        this.state.modalPermSearch = ev.target.value;
        this.state.modalPermCategory = '';
    }

    setModalPermCategory(category) {
        this.state.modalPermCategory = category;
    }

    onModalUserSearch(ev) {
        this.state.modalUserSearch = ev.target.value;
    }

    // ── Panel (edit existing role) ────────────────────────────────────────────

    openPanel(role) {
        this.state.activeRole        = role;
        this.state.selectedGroupIds  = [...(role.group_ids || [])];
        this.state.selectedUserIds   = [...(role.user_ids || [])];
        this.state.panelPermSearch   = '';
        this.state.panelUserSearch   = '';
        this.state.panelPermFilter   = 'assigned';
        this.state.panelPermCategory = '';
        this.state.panelUserFilter   = 'assigned';
        this.state.panelPermManagerOpen = false;
        this.state.panelUserManagerOpen = false;
        this.state.panelOpen         = true;
        this.resetActivity();
        this.loadRoleActivity(false);
    }

    closePanel() {
        this.state.panelOpen  = false;
        this.state.activeRole = null;
        this.state.panelPermManagerOpen = false;
        this.state.panelUserManagerOpen = false;
        this.resetActivity();
    }

    resetActivity() {
        this.state.activityRecords = [];
        this.state.activityLoaded = 0;
        this.state.activityTotal = 0;
    }

    async loadRoleActivity(append = false) {
        const role = this.state.activeRole;
        if (!role || this.state.activityLoading) return;
        this.state.activityLoading = true;
        try {
            const limit = 15;
            const offset = append ? this.state.activityLoaded : 0;
            const result = await this.orm.call("rbac.model", "get_rbac_role_recent_activity", [], {
                role_id: role.id,
                limit,
                offset,
            });
            if (result?.error) {
                this.notification.add(result.message || _t("Unable to load role changes."), {type: "danger"});
                return;
            }
            const records = result.records || [];
            this.state.activityTotal = result.total_count || 0;
            if (append) {
                this.state.activityRecords.push(...records);
                this.state.activityLoaded += records.length;
            } else {
                this.state.activityRecords = records;
                this.state.activityLoaded = records.length;
            }
        } finally {
            this.state.activityLoading = false;
        }
    }

    showMoreActivity() {
        return this.loadRoleActivity(true);
    }

    showLessActivity() {
        this.resetActivity();
        return this.loadRoleActivity(false);
    }

    activityIconClass(item) {
        return `fa ${item.icon || "fa-circle-o"}`;
    }

    openPanelPermManager() {
        this.state.panelPermSearch = '';
        this.state.panelPermFilter = 'assigned';
        this.state.panelPermCategory = this.panelPermissionGroups[0]?.category || '';
        this.state.panelPermManagerOpen = true;
    }

    closePanelPermManager() {
        this.state.panelPermManagerOpen = false;
    }

    openPanelUserManager() {
        this.state.panelUserSearch = '';
        this.state.panelUserFilter = 'assigned';
        this.state.panelUserManagerOpen = true;
    }

    closePanelUserManager() {
        this.state.panelUserManagerOpen = false;
    }

    togglePanelGroup(groupId) {
        const idx = this.state.selectedGroupIds.indexOf(groupId);
        if (idx >= 0) {
            this.state.selectedGroupIds.splice(idx, 1);
        } else {
            this.state.selectedGroupIds.push(groupId);
        }
    }

    togglePanelUser(userId) {
        const idx = this.state.selectedUserIds.indexOf(userId);
        if (idx >= 0) {
            this.state.selectedUserIds.splice(idx, 1);
        } else {
            this.state.selectedUserIds.push(userId);
        }
    }

    async savePanel() {
        if (!this.state.activeRole) return;
        const nameEl = this.panelNameRef.el;
        const descEl = this.panelDescRef.el;
        const name = (nameEl ? nameEl.value : this.state.activeRole.name).trim();
        const desc = descEl ? descEl.value : (this.state.activeRole.description || '');

        if (!name) {
            this.markInvalid(nameEl);
            return;
        }

        const dup = await this.orm.searchCount(
            'res.users',
            [['name', '=', name], ['is_user_role', '=', true], ['id', '!=', this.state.activeRole.id]],
            {context: {active_test: false}}
        );
        if (dup > 0) {
            this.notification.add(
                _t('A role named "%s" already exists.', name), {type: "danger"}
            );
            return;
        }

        this.state.saving = true;
        try {
            await this.orm.call("rbac.model", "update_role_from_directory", [], {
                role_id: this.state.activeRole.id,
                name,
                description: desc,
                group_ids: this.state.selectedGroupIds,
                user_ids: this.state.selectedUserIds,
            });
            this.notification.add(_t("Role saved."), {type: "success"});
            this.closePanel();
            await this.loadData();
        } finally {
            this.state.saving = false;
        }
    }

    deleteRole() {
        if (!this.state.activeRole) return;
        this.dialogService.add(ConfirmationDialog, {
            body: _t('Delete role "%s"? This cannot be undone.', this.state.activeRole.name),
            cancelLabel:  _t("Cancel"),
            confirmLabel: _t("Delete"),
            confirm: async () => {
                this.state.deleting = true;
                try {
                    await this.orm.call("rbac.model", "delete_role_from_directory", [], {
                        role_id: this.state.activeRole.id,
                    });
                    this.notification.add(_t("Role deleted."), {type: "success"});
                    this.closePanel();
                    await this.loadData();
                } finally {
                    this.state.deleting = false;
                }
            },
            cancel: () => {},
        });
    }

    openFullEditor(role) {
        this.action.doAction({
            type: 'ir.actions.client',
            tag:  'rbac.user_role',
            name: role.name,
            context: {active_id: role.id},
        });
    }

    // ── Modal (create new role) ───────────────────────────────────────────────

    openModal() {
        this.state.modalSelectedGroupIds = [];
        this.state.modalSelectedUserIds  = [];
        this.state.modalPermSearch       = '';
        this.state.modalPermCategory     = this.modalPermissionGroups[0]?.category || '';
        this.state.modalUserSearch       = '';
        this.state.modalOpen             = true;
    }

    closeModal() {
        this.state.modalOpen = false;
    }

    toggleModalGroup(groupId) {
        const idx = this.state.modalSelectedGroupIds.indexOf(groupId);
        if (idx >= 0) {
            this.state.modalSelectedGroupIds.splice(idx, 1);
        } else {
            this.state.modalSelectedGroupIds.push(groupId);
        }
    }

    toggleModalUser(userId) {
        const idx = this.state.modalSelectedUserIds.indexOf(userId);
        if (idx >= 0) {
            this.state.modalSelectedUserIds.splice(idx, 1);
        } else {
            this.state.modalSelectedUserIds.push(userId);
        }
    }

    async createRole() {
        const nameEl = this.modalNameRef.el;
        const descEl = this.modalDescRef.el;
        const name = (nameEl ? nameEl.value : '').trim();
        const desc = descEl ? descEl.value : '';

        if (!name) {
            this.markInvalid(nameEl);
            return;
        }

        const dup = await this.orm.searchCount(
            'res.users',
            [['name', '=', name], ['is_user_role', '=', true]],
            {context: {active_test: false}}
        );
        if (dup > 0) {
            this.notification.add(
                _t('A role named "%s" already exists.', name), {type: "danger"}
            );
            return;
        }

        this.state.saving = true;
        try {
            await this.orm.call("rbac.model", "create_role_from_directory", [], {
                name,
                description: desc,
                group_ids: this.state.modalSelectedGroupIds,
                user_ids: this.state.modalSelectedUserIds,
            });
            this.notification.add(_t('Role "%s" created.', name), {type: "success"});
            this.closeModal();
            await this.loadData();
        } finally {
            this.state.saving = false;
        }
    }
}

registry.category("actions").add("rbac.roles_directory", RBACRolesDirectory);
