/* @odoo-module */

import {Component, onMounted, onWillStart, onWillUnmount, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {download} from "@web/core/network/download";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

const COLORS = ["#3a5bd9", "#7c3aed", "#16a34a", "#ea580c", "#0891b2", "#d99a00", "#0d9488"];

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function pickColor(seed) {
    let h = 0;
    for (const char of String(seed || "")) h = (h * 31 + char.charCodeAt(0)) & 0xfffffff;
    return COLORS[h % COLORS.length];
}

export class RBACUsersDirectory extends Component {
    static template = "rbac.UsersDirectory";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.userRef = useRef("requestUser");
        this.groupRef = useRef("requestGroup");
        this.categoryRef = useRef("requestCategory");
        this.durationRef = useRef("requestDuration");
        this.durationValueRef = useRef("requestDurationValue");
        this.durationUnitRef = useRef("requestDurationUnit");
        this.reasonRef = useRef("requestReason");
        this.cloneUserRef = useRef("cloneUser");

        this.state = useState({
            loading: true,
            saving: false,
            users: [],
            departments: [],
            roles: [],
            groups: [],
            companies: [],
            languages: [],
            timezones: [],
            calendars: [],
            defaults: {},
            search: "",
            userRoleFilter: "",
            panelOpen: false,
            createOpen: false,
            createUser: {},
            createErrors: {},
            createPermissionSearch: "",
            createPermissionCategory: "",
            actionOpen: false,
            listActionOpen: false,
            activeUser: null,
            selectedUserIds: [],
            permTab: "all",
            requestOpen: false,
            requestType: "grant",
            requestCategory: "",
            durationType: "permanent",
            roleModalOpen: false,
            roleModalMode: "single",
            selectedRoleIds: [],
            roleSearch: "",
            roleFilter: "all",
            permissionModalOpen: false,
            selectedExtraIds: [],
            selectedExcludedIds: [],
            permissionSearch: "",
            permissionCategory: "",
            permissionStateFilter: "all",
            cloneModalOpen: false,
            activityLoading: false,
            activityRecords: [],
            activityLoaded: 0,
            activityTotal: 0,
        });

        onWillStart(async () => this.loadData());
        onMounted(() => {
            this._onDocumentClick = (ev) => {
                if (this.state.actionOpen && !ev.target.closest(".ud_actions_wrap")) {
                    this.state.actionOpen = false;
                }
                if (this.state.listActionOpen && !ev.target.closest(".ud_list_actions_wrap")) {
                    this.state.listActionOpen = false;
                }
            };
            this._onDocumentKeydown = (ev) => {
                if (ev.key === "Escape" && this.state.actionOpen) {
                    this.state.actionOpen = false;
                }
                if (ev.key === "Escape" && this.state.listActionOpen) {
                    this.state.listActionOpen = false;
                }
            };
            document.addEventListener("click", this._onDocumentClick);
            document.addEventListener("keydown", this._onDocumentKeydown);
        });
        onWillUnmount(() => {
            document.removeEventListener("click", this._onDocumentClick);
            document.removeEventListener("keydown", this._onDocumentKeydown);
        });
    }

    async loadData() {
        this.state.loading = true;
        try {
            const data = await this.orm.call("rbac.model", "get_rbac_users_directory", [], {});
            this.state.users = data.users || [];
            this.state.departments = data.departments || [];
            this.state.roles = data.roles || [];
            this.state.groups = data.groups || [];
            this.state.companies = data.companies || [];
            this.state.languages = data.languages || [];
            this.state.timezones = data.timezones || [];
            this.state.calendars = data.calendars || [];
            this.state.defaults = data.defaults || {};
            if (this.state.activeUser) {
                const fresh = this.state.users.find((user) => user.id === this.state.activeUser.id);
                this.state.activeUser = fresh || null;
            }
        } finally {
            this.state.loading = false;
        }
    }

    get filteredUsers() {
        const query = this.state.search.trim().toLowerCase();
        return this.state.users.filter((user) => {
            const matchesQuery = !query || `${user.name} ${user.email} ${user.department} ${(user.roles || []).map((role) => role.name).join(" ")}`.toLowerCase().includes(query);
            const matchesRole = !this.state.userRoleFilter || (user.roles || []).some((role) => String(role.id) === String(this.state.userRoleFilter));
            return matchesQuery && matchesRole;
        });
    }

    get selectedUsers() {
        const selected = new Set(this.state.selectedUserIds);
        return (this.state.users || []).filter((user) => selected.has(user.id));
    }

    get allFilteredSelected() {
        return this.filteredUsers.length > 0 && this.filteredUsers.every((user) => this.state.selectedUserIds.includes(user.id));
    }

    get requestCategories() {
        return [...new Set((this.state.groups || []).map((group) => group.category || "Other"))].sort();
    }

    get requestGroups() {
        if (!this.state.requestCategory) {
            return this.state.groups;
        }
        return this.state.groups.filter((group) => group.category === this.state.requestCategory);
    }

    get panelPermissions() {
        const user = this.state.activeUser;
        if (!user) return [];
        if (this.state.permTab === "all") return user.permissions || [];
        return (user.permissions || []).filter((perm) => perm.type === this.state.permTab);
    }

    get permissionCategories() {
        return [...new Set((this.state.groups || []).map((group) => group.category || "Other"))].sort();
    }

    get permissionCatalog() {
        const query = this.state.permissionSearch.trim().toLowerCase();
        return (this.state.groups || []).filter((group) => {
            const matchesCategory = !this.state.permissionCategory || group.category === this.state.permissionCategory;
            const state = this.permissionState(group.id);
            const matchesState =
                this.state.permissionStateFilter === "all" ||
                state === this.state.permissionStateFilter ||
                (this.state.permissionStateFilter === "base" && state === "assigned");
            const text = `${group.full_name || ""} ${group.name || ""} ${group.category || ""}`.toLowerCase();
            const matchesQuery = !query || text.includes(query);
            return matchesCategory && matchesState && matchesQuery;
        });
    }

    get filteredRolesForModal() {
        const query = this.state.roleSearch.trim().toLowerCase();
        return (this.state.roles || []).filter((role) => {
            const assigned = this.isRoleChecked(role.id);
            const matchesFilter =
                this.state.roleFilter === "all" ||
                (this.state.roleFilter === "assigned" && assigned) ||
                (this.state.roleFilter === "unassigned" && !assigned);
            const matchesQuery = !query || `${role.name || ""}`.toLowerCase().includes(query);
            return matchesFilter && matchesQuery;
        });
    }

    get roleSummary() {
        const total = (this.state.roles || []).length;
        const assigned = this.state.selectedRoleIds.length;
        return {
            total,
            assigned,
            unassigned: Math.max(total - assigned, 0),
        };
    }

    get permissionSummary() {
        const groups = this.state.groups || [];
        return {
            total: groups.length,
            base: groups.filter((group) => this.permissionState(group.id) === "base" || this.permissionState(group.id) === "assigned").length,
            extra: this.state.selectedExtraIds.length,
            excluded: this.state.selectedExcludedIds.length,
            unassigned: groups.filter((group) => this.permissionState(group.id) === "none").length,
        };
    }

    initials(name) {
        return initials(name);
    }

    avatarStyle(name) {
        return `background:${pickColor(name)};`;
    }

    statusLabel(user) {
        return user.status?.label || "Standard Access";
    }

    statusKey(user) {
        return user.status?.key || "standard";
    }

    statusHelp(user) {
        return user.status_help || "";
    }

    roleNames(user) {
        return (user.roles || []).map((role) => role.name).join(", ");
    }

    onSearch(ev) {
        this.state.search = ev.target.value || "";
    }

    onUserRoleFilter(ev) {
        this.state.userRoleFilter = ev.target.value || "";
    }

    defaultCreateUser() {
        const defaults = this.state.defaults || {};
        return {
            name: "",
            email: "",
            login: "",
            phone: "",
            password: "",
            send_reset: true,
            role_ids: [],
            company_id: defaults.company_id || this.state.companies[0]?.id || 0,
            company_ids: [...(defaults.company_ids || (this.state.companies[0] ? [this.state.companies[0].id] : []))],
            lang: defaults.lang || this.state.languages[0]?.code || "en_US",
            tz: defaults.tz || "UTC",
            notification_type: defaults.notification_type || "email",
            resource_calendar_id: 0,
            signature: "",
            image_1920: "",
            extra_group_ids: [],
            excluded_group_ids: [],
        };
    }

    openCreateUser() {
        this.state.createUser = this.defaultCreateUser();
        this.state.createErrors = {};
        this.state.createPermissionSearch = "";
        this.state.createPermissionCategory = "";
        this.state.createOpen = true;
        this.state.actionOpen = false;
        this.state.listActionOpen = false;
    }

    closeCreateUser() {
        if (this.state.saving) return;
        this.state.createOpen = false;
        this.state.createErrors = {};
    }

    updateCreateField(field, value) {
        this.state.createUser = {
            ...this.state.createUser,
            [field]: value,
        };
        if (field === "email" && !this.state.createUser.login) {
            this.state.createUser.login = value;
        }
        if (this.state.createErrors[field]) {
            this.state.createErrors = {...this.state.createErrors, [field]: false};
        }
    }

    onCreateImageChange(ev) {
        const file = ev.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            this.updateCreateField("image_1920", result.includes(",") ? result.split(",").pop() : result);
        };
        reader.readAsDataURL(file);
    }

    removeCreateImage() {
        this.updateCreateField("image_1920", "");
    }

    toggleCreateRole(roleId) {
        const selected = this.state.createUser.role_ids || [];
        this.updateCreateField(
            "role_ids",
            selected.includes(roleId) ? selected.filter((id) => id !== roleId) : [...selected, roleId]
        );
    }

    toggleCreateCompany(companyId) {
        const selected = this.state.createUser.company_ids || [];
        const next = selected.includes(companyId) ? selected.filter((id) => id !== companyId) : [...selected, companyId];
        const fallbackCompany = next[0] || companyId;
        this.state.createUser = {
            ...this.state.createUser,
            company_ids: next,
            company_id: next.includes(this.state.createUser.company_id) ? this.state.createUser.company_id : fallbackCompany,
        };
        this.state.createErrors = {...this.state.createErrors, company_ids: false, company_id: false};
    }

    get createPermissionCategories() {
        return [...new Set((this.state.groups || []).map((group) => group.category || "Other"))].sort();
    }

    get createPermissionCatalog() {
        const query = this.state.createPermissionSearch.trim().toLowerCase();
        return (this.state.groups || []).filter((group) => {
            const matchesCategory = !this.state.createPermissionCategory || group.category === this.state.createPermissionCategory;
            const text = `${group.full_name || ""} ${group.name || ""} ${group.category || ""}`.toLowerCase();
            return matchesCategory && (!query || text.includes(query));
        });
    }

    createPermissionState(groupId) {
        if ((this.state.createUser.excluded_group_ids || []).includes(groupId)) return "excluded";
        if ((this.state.createUser.extra_group_ids || []).includes(groupId)) return "extra";
        return "default";
    }

    setCreatePermissionState(groupId, state) {
        const currentExtra = this.state.createUser.extra_group_ids || [];
        const currentExcluded = this.state.createUser.excluded_group_ids || [];
        const nextExtra = currentExtra.filter((id) => id !== groupId);
        const nextExcluded = currentExcluded.filter((id) => id !== groupId);
        if (state === "extra") {
            nextExtra.push(groupId);
        } else if (state === "excluded") {
            nextExcluded.push(groupId);
        }
        this.state.createUser = {
            ...this.state.createUser,
            extra_group_ids: nextExtra,
            excluded_group_ids: nextExcluded,
        };
    }

    onCreatePermissionSearch(ev) {
        this.state.createPermissionSearch = ev.target.value || "";
    }

    onCreatePermissionCategory(ev) {
        this.state.createPermissionCategory = ev.target.value || "";
    }

    validateCreateUser() {
        const user = this.state.createUser || {};
        const errors = {};
        if (!String(user.name || "").trim()) errors.name = true;
        if (!String(user.email || "").trim()) errors.email = true;
        if (!String(user.login || user.email || "").trim()) errors.login = true;
        if (!(user.company_ids || []).length) errors.company_ids = true;
        if (!user.company_id) errors.company_id = true;
        this.state.createErrors = errors;
        return !Object.keys(errors).length;
    }

    async createUser() {
        if (!this.validateCreateUser()) {
            this.notification.add(_t("Complete the highlighted required fields."), {type: "warning"});
            return;
        }
        this.state.saving = true;
        try {
            const card = await this.orm.call("rbac.model", "create_rbac_user_from_directory", [], {
                values: this.state.createUser,
            });
            this.notification.add(_t("User created."), {type: "success"});
            this.state.createOpen = false;
            await this.loadData();
            const fresh = this.state.users.find((user) => user.id === card.id) || card;
            this.openPanel(fresh);
        } finally {
            this.state.saving = false;
        }
    }

    toggleUserSelection(userId) {
        const idx = this.state.selectedUserIds.indexOf(userId);
        if (idx >= 0) {
            this.state.selectedUserIds.splice(idx, 1);
        } else {
            this.state.selectedUserIds.push(userId);
        }
        if (!this.state.selectedUserIds.length) {
            this.state.listActionOpen = false;
        }
    }

    toggleAllUsers() {
        const filteredIds = this.filteredUsers.map((user) => user.id);
        if (this.allFilteredSelected) {
            this.state.selectedUserIds = this.state.selectedUserIds.filter((id) => !filteredIds.includes(id));
        } else {
            this.state.selectedUserIds = [...new Set([...this.state.selectedUserIds, ...filteredIds])];
        }
        if (!this.state.selectedUserIds.length) {
            this.state.listActionOpen = false;
        }
    }

    toggleListActions() {
        if (!this.state.selectedUserIds.length) return;
        this.state.listActionOpen = !this.state.listActionOpen;
    }

    openPanel(user) {
        this.state.activeUser = user;
        this.state.panelOpen = true;
        this.state.permTab = "all";
        this.state.actionOpen = false;
        this.state.listActionOpen = false;
        this.resetActivity();
        this.loadUserActivity(false);
    }

    closePanel() {
        this.state.panelOpen = false;
        this.state.actionOpen = false;
    }

    setPermTab(tab) {
        this.state.permTab = tab;
    }

    toggleActions() {
        this.state.actionOpen = !this.state.actionOpen;
    }

    openRequestModal() {
        this.state.requestType = "grant";
        this.state.requestCategory = "";
        this.state.durationType = "permanent";
        this.state.requestOpen = true;
        this.state.actionOpen = false;
    }

    closeRequestModal() {
        this.state.requestOpen = false;
    }

    setRequestType(type) {
        this.state.requestType = type;
    }

    onRequestCategory(ev) {
        this.state.requestCategory = ev.target.value || "";
    }

    onDurationType(ev) {
        this.state.durationType = ev.target.value || "permanent";
    }

    async submitRequest() {
        const userId = this.state.activeUser?.id || Number(this.userRef.el?.value || 0);
        const groupId = Number(this.groupRef.el?.value || 0);
        const duration = this.durationRef.el?.value || "permanent";
        const durationValue = this.durationValueRef.el?.value || "";
        const durationUnit = this.durationUnitRef.el?.value || "";
        const reason = this.reasonRef.el?.value || "";
        const durationLabel = duration === "temporary"
            ? `Temporary: ${durationValue || 1} ${durationUnit || "days"}`
            : "Permanent";
        const description = [reason, `Duration: ${durationLabel}`].filter(Boolean).join("\n");
        this.state.saving = true;
        try {
            const result = await this.orm.call("request.rbac.permission", "create_request_from_dashboard", [], {
                values: {
                    user_id: userId,
                    group_id: groupId,
                    type: this.state.requestType,
                    description,
                },
            });
            if (result.error) {
                this.notification.add(result.message || _t("Unable to submit request."), {type: "danger"});
                return;
            }
            this.notification.add(result.message || _t("Request submitted."), {type: "success"});
            this.closeRequestModal();
            await this.refreshActiveUser();
        } finally {
            this.state.saving = false;
        }
    }

    async refreshActiveUser() {
        if (!this.state.activeUser) {
            await this.loadData();
            return;
        }
        const card = await this.orm.call("rbac.model", "get_rbac_user_card", [], {user_id: this.state.activeUser.id});
        if (card && card.id) {
            const idx = this.state.users.findIndex((user) => user.id === card.id);
            if (idx >= 0) this.state.users.splice(idx, 1, card);
            this.state.activeUser = card;
        } else {
            await this.loadData();
        }
        this.resetActivity();
        await this.loadUserActivity(false);
    }

    resetActivity() {
        this.state.activityRecords = [];
        this.state.activityLoaded = 0;
        this.state.activityTotal = 0;
    }

    async loadUserActivity(append = false) {
        const user = this.state.activeUser;
        if (!user || this.state.activityLoading) return;
        this.state.activityLoading = true;
        try {
            const limit = 15;
            const offset = append ? this.state.activityLoaded : 0;
            const result = await this.orm.call("rbac.model", "get_rbac_user_recent_activity", [], {
                user_id: user.id,
                limit,
                offset,
            });
            if (result?.error) {
                this.notification.add(result.message || _t("Unable to load recent changes."), {type: "danger"});
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
        return this.loadUserActivity(true);
    }

    showLessActivity() {
        this.resetActivity();
        return this.loadUserActivity(false);
    }

    activityIconClass(item) {
        return `fa ${item.icon || "fa-circle-o"}`;
    }

    confirmAction(title, body, confirmLabel, callback, danger = false) {
        this.state.actionOpen = false;
        this.dialog.add(ConfirmationDialog, {
            title,
            body,
            confirmLabel,
            cancelLabel: _t("Cancel"),
            confirmClass: danger ? "btn-danger" : "btn-primary",
            confirm: callback,
        });
    }

    grantAll() {
        const user = this.state.activeUser;
        this.confirmAction(_t("Grant All Permissions"), _t("Grant all available permissions to %s?", user.name), _t("Grant All"), async () => {
            await this.orm.call("res.users", "grant_all_permissions", [user.id]);
            this.notification.add(_t("All permissions granted."), {type: "success"});
            await this.refreshActiveUser();
        });
    }

    revokeAll() {
        const user = this.state.activeUser;
        this.confirmAction(_t("Revoke All Permissions"), _t("Revoke roles, extras, and exclusions for %s?", user.name), _t("Revoke All"), async () => {
            await this.orm.call("res.users", "revoke_all_permissions", [user.id]);
            this.notification.add(_t("Permissions revoked."), {type: "warning"});
            await this.refreshActiveUser();
        }, true);
    }

    openCloneModal() {
        this.state.cloneModalOpen = true;
        this.state.actionOpen = false;
    }

    closeCloneModal() {
        this.state.cloneModalOpen = false;
    }

    async clonePermissions() {
        const cloneUserId = Number(this.cloneUserRef.el?.value || 0);
        if (!cloneUserId || !this.state.activeUser) return;
        const result = await this.orm.call("rbac.model", "clone_groups_from_user", [], {
            user_id: this.state.activeUser.id,
            clone_user_id: cloneUserId,
        });
        if (result?.error) {
            this.notification.add(result.message || result.error, {type: "danger"});
            return;
        }
        this.notification.add(result?.message || _t("Permissions cloned."), {type: "success"});
        this.closeCloneModal();
        await this.refreshActiveUser();
    }

    openRoleModal() {
        this.state.selectedRoleIds = (this.state.activeUser?.roles || []).map((role) => role.id);
        this.state.roleModalMode = "single";
        this.state.roleSearch = "";
        this.state.roleFilter = "all";
        this.state.roleModalOpen = true;
        this.state.actionOpen = false;
    }

    openBulkRoleModal() {
        this.state.roleModalMode = "bulk";
        this.state.selectedRoleIds = [];
        this.state.roleSearch = "";
        this.state.roleFilter = "all";
        this.state.roleModalOpen = true;
        this.state.listActionOpen = false;
    }

    openBulkPermissionModal() {
        this.state.listActionOpen = false;
        this.notification.add(_t("Open one user to manage direct permission grants/exclusions. Bulk permission edits need stricter review."), {type: "info"});
    }

    closeRoleModal() {
        this.state.roleModalOpen = false;
    }

    isRoleChecked(roleId) {
        return this.state.selectedRoleIds.includes(roleId);
    }

    toggleRole(roleId) {
        const idx = this.state.selectedRoleIds.indexOf(roleId);
        if (idx >= 0) {
            this.state.selectedRoleIds.splice(idx, 1);
        } else {
            this.state.selectedRoleIds.push(roleId);
        }
    }

    onRoleSearch(ev) {
        this.state.roleSearch = ev.target.value || "";
    }

    setRoleFilter(filter) {
        this.state.roleFilter = filter;
    }

    async applyRoles() {
        if (this.state.roleModalMode === "bulk") {
            const userIds = [...this.state.selectedUserIds];
            const roleIds = [...this.state.selectedRoleIds];
            for (const userId of userIds) {
                for (const roleId of roleIds) {
                    await this.orm.call("res.users", "assign_role", [userId], {role_id: roleId});
                }
            }
            this.notification.add(_t("Roles assigned to selected users."), {type: "success"});
            this.closeRoleModal();
            this.state.selectedUserIds = [];
            await this.loadData();
            return;
        }
        const user = this.state.activeUser;
        const current = new Set((user.roles || []).map((role) => role.id));
        const target = new Set(this.state.selectedRoleIds);
        for (const roleId of target) {
            if (!current.has(roleId)) {
                await this.orm.call("res.users", "assign_role", [user.id], {role_id: roleId});
            }
        }
        for (const roleId of current) {
            if (!target.has(roleId)) {
                await this.orm.call("res.users", "remove_role", [user.id], {role_id: roleId});
            }
        }
        this.notification.add(_t("Roles updated."), {type: "success"});
        this.closeRoleModal();
        await this.refreshActiveUser();
    }

    bulkResetPassword() {
        const users = [...this.selectedUsers];
        this.state.listActionOpen = false;
        this.confirmAction(_t("Send Password Reset"), _t("Send password reset instructions to %s selected users?", users.length), _t("Send"), async () => {
            for (const user of users) {
                await this.orm.call("res.users", "action_reset_password", [[user.id]]);
            }
            this.notification.add(_t("Password reset instructions sent."), {type: "success"});
            this.state.selectedUserIds = [];
        });
    }

    bulkArchiveUsers() {
        const users = [...this.selectedUsers];
        this.state.listActionOpen = false;
        this.confirmAction(_t("Archive Users"), _t("Archive %s selected users?", users.length), _t("Archive"), async () => {
            await this.orm.write("res.users", users.map((user) => user.id), {active: false});
            this.notification.add(_t("Selected users archived."), {type: "warning"});
            this.state.selectedUserIds = [];
            await this.loadData();
        }, true);
    }

    openPermissionModal() {
        const user = this.state.activeUser;
        this.state.selectedExtraIds = [...(user?.extra_group_ids || [])];
        this.state.selectedExcludedIds = [...(user?.excluded_group_ids || [])];
        this.state.permissionSearch = "";
        this.state.permissionCategory = "";
        this.state.permissionStateFilter = "all";
        this.state.permissionModalOpen = true;
        this.state.actionOpen = false;
    }

    closePermissionModal() {
        this.state.permissionModalOpen = false;
    }

    onPermissionSearch(ev) {
        this.state.permissionSearch = ev.target.value || "";
    }

    onPermissionCategory(ev) {
        this.state.permissionCategory = ev.target.value || "";
    }

    setPermissionStateFilter(filter) {
        this.state.permissionStateFilter = filter;
    }

    permissionState(groupId) {
        if (this.state.selectedExcludedIds.includes(groupId)) return "excluded";
        if (this.state.selectedExtraIds.includes(groupId)) return "extra";
        if ((this.state.activeUser?.base_group_ids || []).includes(groupId)) return "base";
        if ((this.state.activeUser?.effective_group_ids || []).includes(groupId)) return "assigned";
        return "none";
    }

    permissionStateLabel(groupId) {
        const state = this.permissionState(groupId);
        if (state === "base") return "Base";
        if (state === "assigned") return "Assigned";
        if (state === "extra") return "+ Extra";
        if (state === "excluded") return "Excluded";
        return "Unassigned";
    }

    permissionStateHint(groupId) {
        const state = this.permissionState(groupId);
        if (state === "extra") return "Granted directly to this user.";
        if (state === "excluded") return "Blocked for this user even if a role grants it.";
        if (state === "base" || state === "assigned") return "Currently granted by role/default access.";
        return "Not currently granted to this user.";
    }

    setPermissionState(groupId, state) {
        this.state.selectedExtraIds = this.state.selectedExtraIds.filter((id) => id !== groupId);
        this.state.selectedExcludedIds = this.state.selectedExcludedIds.filter((id) => id !== groupId);
        if (state === "extra") {
            this.state.selectedExtraIds.push(groupId);
        } else if (state === "excluded") {
            this.state.selectedExcludedIds.push(groupId);
        }
    }

    async applyPermissions() {
        const user = this.state.activeUser;
        if (!user) return;
        const currentExtra = new Set(user.extra_group_ids || []);
        const currentExcluded = new Set(user.excluded_group_ids || []);
        const targetExtra = new Set(this.state.selectedExtraIds);
        const targetExcluded = new Set(this.state.selectedExcludedIds);

        for (const groupId of currentExtra) {
            if (!targetExtra.has(groupId)) {
                await this.orm.call("res.users", "remove_direct_group_additions", [user.id], {group_id: groupId});
            }
        }
        for (const groupId of currentExcluded) {
            if (!targetExcluded.has(groupId)) {
                await this.orm.call("res.users", "remove_direct_group_exclusions", [user.id], {group_id: groupId});
            }
        }
        for (const groupId of targetExtra) {
            if (!currentExtra.has(groupId)) {
                await this.orm.call("res.users", "add_direct_group_additions", [user.id], {group_id: groupId});
            }
        }
        for (const groupId of targetExcluded) {
            if (!currentExcluded.has(groupId)) {
                await this.orm.call("res.users", "add_direct_group_exclusions", [user.id], {group_id: groupId});
            }
        }
        this.notification.add(_t("Permissions updated."), {type: "success"});
        this.closePermissionModal();
        await this.refreshActiveUser();
    }

    async exportPermissions() {
        this.state.actionOpen = false;
        await download({
            data: {
                data: JSON.stringify(await this.orm.call("rbac.model", "export_permissions_csv", [], {user_id: this.state.activeUser.id})),
            },
            url: "/web/export/csv",
        });
    }

    async changePassword() {
        this.state.actionOpen = false;
        await this.action.doAction({
            type: "ir.actions.act_window",
            name: "Change Password",
            res_model: "change.password.wizard",
            views: [[false, "form"]],
            target: "new",
            context: {active_model: "res.users", active_ids: [this.state.activeUser.id]},
        });
    }

    async resetPassword() {
        this.state.actionOpen = false;
        await this.orm.call("res.users", "action_reset_password", [[this.state.activeUser.id]]);
        this.notification.add(_t("Password reset instructions sent."), {type: "success"});
    }

    async disable2FA() {
        const user = this.state.activeUser;
        this.confirmAction(_t("Disable Two-Factor Auth"), _t("Disable two-factor authentication for %s?", user.name), _t("Disable"), async () => {
            await this.orm.call("res.users", "action_totp_disable", [[user.id]]);
            this.notification.add(_t("Two-factor authentication disabled."), {type: "success"});
        }, true);
    }

    invite2FA() {
        this.state.actionOpen = false;
        this.notification.add(_t("Odoo sends 2FA enrollment from the user's preferences/security flow."), {type: "info"});
    }

    archiveUser() {
        const user = this.state.activeUser;
        this.confirmAction(_t("Archive User"), _t("Archive %s?", user.name), _t("Archive"), async () => {
            await this.orm.write("res.users", [user.id], {active: false});
            this.notification.add(_t("User archived."), {type: "success"});
            this.closePanel();
            await this.loadData();
        }, true);
    }

    deleteUser() {
        const user = this.state.activeUser;
        this.confirmAction(_t("Delete User"), _t("Permanently delete %s?", user.name), _t("Delete"), async () => {
            await this.orm.call("res.users", "unlink", [[user.id]]);
            this.notification.add(_t("User deleted."), {type: "success"});
            this.closePanel();
            await this.loadData();
        }, true);
    }
}

registry.category("actions").add("rbac.users_directory", RBACUsersDirectory);
