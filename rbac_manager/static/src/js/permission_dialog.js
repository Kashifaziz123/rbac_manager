/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {useService} from "@web/core/utils/hooks";
import {onWillStart} from "@odoo/owl";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useState} from "@odoo/owl";
export class RBACPermissionsDialog extends ConfirmationDialog {
    static template = "rbac.PermissionsDialog";
    static props = { ...ConfirmationDialog.props };

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.resId;
        this.parentComponent = this.props?.parentComponent;

        this.custom_props = { original_data: {}, changed_data: {} };

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
        });
    }

    search_permissions(ev) {
        const searchVal = ev.target.value.toLowerCase().trim();
        const type = $("select[name='type']").val();
        const permissions = this.custom_props.original_data.permissions?.[type] || [];

        const $suggestions = $("#suggestions").empty();
        if (!searchVal) return $suggestions.hide();

        const filtered = permissions.filter(p => p.name.toLowerCase().includes(searchVal));
        if (!filtered.length)
            return $suggestions.html("<div class='no-results'>No matches</div>").show();

        $suggestions
            .html(
                filtered
                    .map(
                        p =>
                            `<div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">${p.name}</div>`
                    )
                    .join("")
            )
            .off("click")
            .on("click", ".suggestion-item", ev => this.select_permission(ev))
            .show();
    }
    select_permission(ev) {
        const $item = $(ev.currentTarget);
        const name = $item.data("name");
        const id = $item.data("id");

        $("#selectedPermission")
            .html(
                `<div class="selected-item" data-id="${id}">
                    <strong>${name}</strong>
                    <span class="remove">❌</span>
                </div>`
            )
            .off("click")
            .on("click", ".remove", () => this.clear_selection())
            .show();

        $("#permissionSearch").val("");
        $("#permissionId").val(id);
        $("#suggestions").hide();
    }
    clear_selection() {
        $("#selectedPermission").hide().empty();
        $("#permissionId").val("");
    }
    async submitRecord() {
        const values = Object.fromEntries(new FormData($("form")[0]));
        values.user_id = this.record_id;
        const payload = JSON.stringify(values);

        try {
            const record = await this.orm.call(
                "request.rbac.permission",
                "submit_manage_permission_record",
                [],
                { values: payload }
            );
            const type = record.error ? "danger" : "info";
            this.notification.add(record.message, { type });
            this._cancel();
            await this.parentComponent.fetch_data();
            this.parentComponent.render();
        } catch (err) {
            console.error("Submit error:", err);
            this.notification.add("Error submitting permission request.", { type: "danger" });
        }
    }

    async fetch_data() {
        this.user = await this.orm.searchRead(
            "res.users",
            [["id", "=", this.record_id], ["is_user_role", "=", false]],
            ["name", "email"]
        );

        this.data = await this.orm.call("rbac.model", "get_manage_permissions_json", [
            this.record_id,
        ]);

        if (this.data.error) {
            const message = _t(
                "It seems the records with IDs %s cannot be found. They might have been deleted.",
                this.record_id
            );
            this.notification.add(message, { sticky: true, type: "danger" });
            this.action.doAction("rbac_manager.act_window_res_users_list_user_permission", {
                clearBreadcrumbs: true,
            });
        }

        this.custom_props.original_data = JSON.parse(JSON.stringify(this.data || {}));
        this.custom_props.changed_data = { ...this.custom_props.original_data };
    }
}
export class RBACRolesDialog extends ConfirmationDialog {
    static template = "rbac.RolesDialog";
    static props = {
        ...ConfirmationDialog.props,
    };

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.resId;
        this.parentComponent = this.props?.parentComponent;
         this.state = useState({
            searchText: "",
            filters: [
                { label: "All Roles", value: "all", active: true },
                { label: "✓ Assigned", value: "assigned" },
            ],
            roles: [],
        });
        onWillStart(async () => {
        await this.fetch_data();
            await ensureJQuery();
        });

    }
    getFilteredRoles() {
    // Always start from the full data, not from this.state.roles
    let roles = [
        ...(this.data.assigned_roles || []),
        ...(this.data.available_roles || []),
    ];

    // Build assigned set for quick lookup
    const assignedIds = new Set((this.data.assigned_roles || []).map(r => r.id));

    // Apply active filter
    const activeFilter = this.state.filters.find(f => f.active)?.value;
    if (activeFilter === "assigned") {
        roles = roles.filter(r => assignedIds.has(r.id));
    }

    // Apply search filter
    const query = (this.state.searchText || "").trim().toLowerCase();
    if (query) {
        roles = roles.filter(r =>
            (r.name && r.name.toLowerCase().includes(query)) ||
            (r.description && r.description.toLowerCase().includes(query))
        );
    }

    // Return normalized roles with assigned flags
    return roles.map(r => ({
        ...r,
        assigned: assignedIds.has(r.id),
    }));
}
    filterRoles(category) {
        this.state.filters.forEach((f) => (f.active = f.value === category));
        this.state.roles = this.getFilteredRoles();
    }
    onInputSearch(ev) {
        this.state.searchText = ev.target.value;
        this.state.roles = this.getFilteredRoles();
    }
    async fetch_data() {
    this.user = await this.orm.searchRead(
        "res.users",
        [['id', '=', this.record_id], ['is_user_role', '=', false]],
        ["name", "email"]
    );
    this.data = await this.orm.call("rbac.model", "get_manage_permissions_json", [this.record_id]);
    if (this.data.error) {
        const message = _t(
            "It seems the records with IDs %s cannot be found. They might have been deleted.",
            this.record_id
        );
        this.notification.add(message, { sticky: true, type: "danger" });
        this.action.doAction("rbac_manager.act_window_res_users_list_user_permission", {
            clearBreadcrumbs: true,
        });
        return;
    }
    const assigned_ids = (this.data.assigned_roles || []).map(r => r.id);
    const all_roles = [
        ...(this.data.assigned_roles || []),
        ...(this.data.available_roles || []),
    ];
    this.state.roles = all_roles.map(r => ({
        ...r,
        assigned: assigned_ids.includes(r.id),
    }));
    this.state.roles = this.getFilteredRoles();
}
    async assignRole(role) {
    try {
        const result = await this.orm.call("res.users", "assign_role", [this.record_id], { role_id: role.id });
        if (result) {
            const idx = this.state.roles.findIndex(r => r.id === role.id);
            if (idx !== -1) this.state.roles[idx].assigned = true;
            const alreadyExists = (this.data.assigned_roles || []).some(r => r.id === role.id);
            if (!alreadyExists) {
                this.data.assigned_roles.push(role);
            }
            this.data.available_roles = (this.data.available_roles || []).filter(r => r.id !== role.id);
            this.state.roles = this.getFilteredRoles();
            this.notification.add(`✓ Role "${role.name}" has been assigned successfully!`, { type: "success" });
            await this.parentComponent.fetch_data();
            this.parentComponent.render();
        } else {
            this.notification.add(result.message || "Error assigning role.", { type: "danger" });
        }
    } catch (err) {
        console.error(err);
        this.notification.add("Failed to assign role. Please try again.", { type: "danger" });
    }
}
    async removeRole(role) {
    try {
        const result = await this.orm.call("res.users", "remove_role", [this.record_id], { role_id: role.id });
        if (result) {
            const idx = this.state.roles.findIndex(r => r.id === role.id);
            if (idx !== -1) this.state.roles[idx].assigned = false;
            this.data.assigned_roles = (this.data.assigned_roles || []).filter(r => r.id !== role.id);
            const alreadyAvailable = (this.data.available_roles || []).some(r => r.id === role.id);
            if (!alreadyAvailable) {
                this.data.available_roles.push(role);
            }
            this.state.roles = this.getFilteredRoles();
            this.notification.add(`⚠️ Role "${role.name}" has been removed successfully!`, { type: "warning" });
            await this.parentComponent.fetch_data();
            this.parentComponent.render();
        } else {
            this.notification.add(result.message || "Error removing role.", { type: "danger" });
        }
    } catch (err) {
        console.error(err);
        this.notification.add("Failed to remove role. Please try again.", { type: "danger" });
    }
}

}