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
    static props = { ...ConfirmationDialog.props };

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.resId;
        this.parentComponent = this.props?.parentComponent;

        this.state = useState({
            loading: true,
            search: "",
            filter: "all",
            roles: [],
        });

        onWillStart(async () => {
            await this.loadRoles();
        });
    }

    // ------------------------------
    // 🔹 Core: Fetch & Normalize Roles
    // ------------------------------
    async loadRoles() {
        try {
            const [user, data] = await Promise.all([
                this.orm.searchRead("res.users", [['id', '=', this.record_id]], ["name", "email"]),
                this.orm.call("rbac.model", "get_manage_permissions_json", [this.record_id]),
            ]);

            if (data?.error) {
                this.notification.add("User record not found or deleted.", { type: "danger", sticky: true });
                this.action.doAction("rbac_manager.act_window_res_users_list_user_permission", {
                    clearBreadcrumbs: true,
                });
                return;
            }

            const assignedIds = new Set((data.assigned_roles || []).map((r) => r.id));
            const roles = [
                ...(data.assigned_roles || []),
                ...(data.available_roles || []),
            ].map((r) => ({
                ...r,
                assigned: assignedIds.has(r.id),
            }));

            Object.assign(this.state, { roles, loading: false });
        } catch (err) {
            console.error("Error loading roles:", err);
            this.notification.add("Failed to load roles.", { type: "danger" });
        }
    }

    // ------------------------------
    // 🔹 Computed Roles (Dynamic Filter)
    // ------------------------------
    get filteredRoles() {
        let roles = this.state.roles;
        const q = this.state.search.trim().toLowerCase();

        if (this.state.filter === "assigned") {
            roles = roles.filter((r) => r.assigned);
        }
        if (q) {
            roles = roles.filter(
                (r) =>
                    (r.name && r.name.toLowerCase().includes(q)) ||
                    (r.description && r.description.toLowerCase().includes(q))
            );
        }
        return roles;
    }

    // ------------------------------
    // 🔹 UI Event Handlers
    // ------------------------------
    onSearch(ev) {
        this.state.search = ev.target.value;
    }

    onFilterChange(value) {
        this.state.filter = value;
    }

    // ------------------------------
    // 🔹 Assign / Remove Role
    // ------------------------------
    async toggleRole(role, assign = true) {
        const method = assign ? "assign_role" : "remove_role";
        const msg = assign ? "assigned" : "removed";
        const type = assign ? "success" : "warning";

        try {
            const result = await this.orm.call("res.users", method, [this.record_id], { role_id: role.id });
            if (!result) {
                this.notification.add("Unexpected response from server.", { type: "danger" });
                return;
            }

            role.assigned = assign;
            this.notification.add(`✓ Role "${role.name}" ${msg} successfully!`, { type });
            await this.parentComponent?.fetch_data?.();
            this.parentComponent.render();

        } catch (err) {
            console.error(err);
            this.notification.add(`Failed to ${msg} role "${role.name}".`, { type: "danger" });
        }
    }
}
