/* @odoo-module */

import {Component, onWillStart, useRef, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

const ROLE_COLORS = ["#3a5bd9", "#ea580c", "#7c3aed", "#0d9488", "#16a34a"];
const AVATAR_COLORS = ["#7c3aed", "#16a34a", "#ea580c", "#3a5bd9", "#0891b2"];

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function pickColor(seed, colors) {
    let h = 0;
    for (const char of String(seed || "")) h = (h * 31 + char.charCodeAt(0)) & 0xfffffff;
    return colors[h % colors.length];
}

export class RBACDashboard extends Component {
    static template = "rbac.Dashboard";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");
        this.userRef = useRef("requestUser");
        this.categoryRef = useRef("requestCategory");
        this.groupRef = useRef("requestGroup");
        this.durationRef = useRef("requestDuration");
        this.durationValueRef = useRef("requestDurationValue");
        this.durationUnitRef = useRef("requestDurationUnit");
        this.descRef = useRef("requestReason");
        this.roleNameRef = useRef("roleName");
        this.roleDescRef = useRef("roleDesc");
        this.state = useState({
            loading: true,
            saving: false,
            modalOpen: false,
            roleModalOpen: false,
            requestType: "grant",
            requestCategory: "",
            durationType: "permanent",
            roleSelectedGroupIds: [],
            roleSelectedUserIds: [],
            rolePermSearch: "",
            roleUserSearch: "",
            data: {
                stats: {},
                recent_activity: [],
                pending_requests: [],
                top_roles: [],
                permission_sources: {},
                active_rules: [],
                request_options: {users: [], groups: []},
                role_options: {users: [], groups: []},
            },
        });
        onWillStart(async () => this.loadData());
    }

    async loadData() {
        this.state.loading = true;
        try {
            this.state.data = await this.orm.call("rbac.model", "get_rbac_dashboard", [], {});
        } finally {
            this.state.loading = false;
        }
    }

    get stats() {
        return this.state.data.stats || {};
    }

    get requestUsers() {
        return this.state.data.request_options?.users || [];
    }

    get requestGroups() {
        return this.state.data.request_options?.groups || [];
    }

    get categories() {
        return [...new Set(this.requestGroups.map((group) => group.category || "Other"))].sort();
    }

    get modalGroups() {
        if (!this.state.requestCategory) {
            return this.requestGroups;
        }
        return this.requestGroups.filter((group) => group.category === this.state.requestCategory);
    }

    get roleGroups() {
        const query = this.state.rolePermSearch.trim().toLowerCase();
        const groups = this.state.data.role_options?.groups || [];
        if (!query) {
            return groups;
        }
        return groups.filter((group) => {
            const text = `${group.full_name || ""} ${group.name || ""} ${group.category || ""}`.toLowerCase();
            return text.includes(query);
        });
    }

    get roleUsers() {
        const query = this.state.roleUserSearch.trim().toLowerCase();
        const users = this.state.data.role_options?.users || [];
        if (!query) {
            return users;
        }
        return users.filter((user) => {
            const text = `${user.name || ""} ${user.email || ""}`.toLowerCase();
            return text.includes(query);
        });
    }

    isRoleGroupChecked(groupId) {
        return this.state.roleSelectedGroupIds.includes(groupId);
    }

    isRoleUserChecked(userId) {
        return this.state.roleSelectedUserIds.includes(userId);
    }

    initials(name) {
        return initials(name);
    }

    avatarStyle(name) {
        return `background:${pickColor(name, AVATAR_COLORS)};`;
    }

    roleColor(index) {
        return ROLE_COLORS[index % ROLE_COLORS.length];
    }

    activityIcon(activity) {
        if (activity.indicator === "added") return "fa-check";
        if (activity.indicator === "removed") return "fa-ban";
        if (activity.indicator === "modified") return "fa-pencil";
        return "fa-star-o";
    }

    async openAudit() {
        await this.action.doAction("rbac_manager.view_audit_client_rbac_audit");
    }

    openRequestModal() {
        this.state.requestType = "grant";
        this.state.requestCategory = "";
        this.state.durationType = "permanent";
        this.state.modalOpen = true;
    }

    closeRequestModal() {
        this.state.modalOpen = false;
    }

    setRequestType(type) {
        this.state.requestType = type;
    }

    onCategoryChange(ev) {
        this.state.requestCategory = ev.target.value;
    }

    onDurationTypeChange(ev) {
        this.state.durationType = ev.target.value;
    }

    async submitRequest() {
        const userId = Number(this.userRef.el?.value || 0);
        const groupId = Number(this.groupRef.el?.value || 0);
        const duration = this.durationRef.el?.value || "permanent";
        const durationValue = this.durationValueRef.el?.value || "";
        const durationUnit = this.durationUnitRef.el?.value || "";
        const reason = this.descRef.el?.value || "";
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
            await this.loadData();
        } finally {
            this.state.saving = false;
        }
    }

    async openRequestsPage() {
        await this.action.doAction("rbac_manager.request_rbac_permission_dashboard_action");
    }

    async openRoles() {
        await this.action.doAction("rbac_manager.act_client_rbac_roles_directory");
    }

    openRoleModal() {
        this.state.roleSelectedGroupIds = [];
        this.state.roleSelectedUserIds = [];
        this.state.rolePermSearch = "";
        this.state.roleUserSearch = "";
        this.state.roleModalOpen = true;
    }

    closeRoleModal() {
        this.state.roleModalOpen = false;
    }

    toggleRoleGroup(groupId) {
        const idx = this.state.roleSelectedGroupIds.indexOf(groupId);
        if (idx >= 0) {
            this.state.roleSelectedGroupIds.splice(idx, 1);
        } else {
            this.state.roleSelectedGroupIds.push(groupId);
        }
    }

    toggleRoleUser(userId) {
        const idx = this.state.roleSelectedUserIds.indexOf(userId);
        if (idx >= 0) {
            this.state.roleSelectedUserIds.splice(idx, 1);
        } else {
            this.state.roleSelectedUserIds.push(userId);
        }
    }

    onRolePermSearch(ev) {
        this.state.rolePermSearch = ev.target.value || "";
    }

    onRoleUserSearch(ev) {
        this.state.roleUserSearch = ev.target.value || "";
    }

    async submitRole() {
        const name = (this.roleNameRef.el?.value || "").trim();
        const description = this.roleDescRef.el?.value || "";
        if (!name) {
            this.notification.add(_t("Role name cannot be empty."), {type: "danger"});
            return;
        }
        const duplicate = await this.orm.searchCount(
            "res.users",
            [["name", "=", name], ["is_user_role", "=", true]],
            {context: {active_test: false}}
        );
        if (duplicate > 0) {
            this.notification.add(_t('A role named "%s" already exists.', name), {type: "danger"});
            return;
        }
        this.state.saving = true;
        try {
            await this.orm.call("rbac.model", "create_role_from_directory", [], {
                name,
                description,
                group_ids: this.state.roleSelectedGroupIds,
                user_ids: this.state.roleSelectedUserIds,
            });
            this.notification.add(_t("Role created."), {type: "success"});
            this.closeRoleModal();
            await this.loadData();
        } finally {
            this.state.saving = false;
        }
    }

    async openSuperAdmin() {
        await this.action.doAction("rbac_manager.act_window_res_users_list_super_admin");
    }
}

registry.category("actions").add("rbac.dashboard", RBACDashboard);
