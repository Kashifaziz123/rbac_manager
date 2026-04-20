/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {useService} from "@web/core/utils/hooks";
import {useState, onWillStart} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";

export class RBACPermissionsDialog extends ConfirmationDialog {
    static template = "rbac.PermissionsDialog";
    static props = {
        ...ConfirmationDialog.props,
        resId: {type: Number, optional: true},
        parentComponent: {type: Object, optional: true},
    };

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");

        this.record_id = this.props?.resId;
        this.parentComponent = this.props?.parentComponent;

        this.state = useState({
            loading: true,
            type: "grant",
            search: "",
            permissions: {},
            filtered: [],
            selected: null,
            description: "",
        });

        onWillStart(async () => {
            await this.fetch_data();
        });
    }

    async fetch_data() {
        try {
            const data = await this.orm.call("rbac.model", "get_manage_permissions_json", [this.record_id]);
            if (data?.error) {
                this.notification.add(
                    _t("It seems the record for this user could not be found or was deleted."),
                    {type: "danger", sticky: true}
                );
                return;
            }
            this.state.permissions = data.permissions || {};
            this.state.loading = false;
        } catch (err) {
            console.error("fetch_data error:", err);
            this.notification.add("Error loading permissions.", {type: "danger"});
        }
    }

    searchPermissions(ev) {
        this.state.search = ev.target.value.toLowerCase();
        const list = this.state.permissions[this.state.type] || [];
        this.state.filtered = list.filter(p => p.name.toLowerCase().includes(this.state.search));
    }

    selectPermission(permission) {
        this.state.selected = permission;
        this.state.filtered = [];
        this.state.search = "";
    }

    clearSelection() {
        this.state.selected = null;
    }

    async submitRecord() {
        const selected = this.state.selected;
        if (!selected) {
            this.notification.add("Please select a permission before submitting.", {type: "warning"});
            return;
        }
        const payload = {
            user_id: this.record_id,
            type: this.state.type,
            group_id: selected.id,
            description: this.state.description,
        };
        try {
            const record = await this.orm.call(
                "request.rbac.permission",
                "submit_manage_permission_record",
                [],
                {values: JSON.stringify(payload)}
            );
            const type = record.error ? "danger" : "info";
            this.notification.add(record.message, {type});
            this._cancel();
            await this.parentComponent?.fetch_data?.();
            this.parentComponent?.render?.();
        } catch (err) {
            console.error("Submit error:", err);
            this.notification.add("Error submitting permission request.", {type: "danger"});
        }
    }
}

export class RBACRolesDialog extends ConfirmationDialog {
    static template = "rbac.RolesDialog";
    static props = {
        ...ConfirmationDialog.props,
        resId: {type: Number, optional: true},
        parentComponent: {type: Object, optional: true},
    };

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

    async loadRoles() {
        try {
            const data = await this.orm.call("rbac.model", "get_manage_permissions_json", [this.record_id]);
            if (data?.error) {
                this.notification.add(_t("User record not found or deleted."), {type: "danger", sticky: true});
                return;
            }
            const assignedIds = new Set((data.assigned_roles || []).map(r => r.id));
            const roles = [
                ...(data.assigned_roles || []),
                ...(data.available_roles || []),
            ].map(r => ({...r, assigned: assignedIds.has(r.id)}));

            this.state.roles = roles;
            this.state.loading = false;
        } catch (err) {
            console.error("Error loading roles:", err);
            this.notification.add(_t("Failed to load roles."), {type: "danger"});
        }
    }

    get filteredRoles() {
        const query = this.state.search.trim().toLowerCase();
        let roles = this.state.roles;
        if (this.state.filter === "assigned") {
            roles = roles.filter(r => r.assigned);
        }
        if (query) {
            roles = roles.filter(
                r => (r.name && r.name.toLowerCase().includes(query)) ||
                     (r.description && r.description.toLowerCase().includes(query))
            );
        }
        return roles;
    }

    onSearch(ev) {
        this.state.search = ev.target.value;
    }

    onFilterChange(filter) {
        this.state.filter = filter;
    }

    async toggleRole(role, assign = true) {
        const method = assign ? "assign_role" : "remove_role";
        const msg = assign ? _t("assigned") : _t("removed");
        const type = assign ? "success" : "warning";
        try {
            const result = await this.orm.call("res.users", method, [this.record_id], {role_id: role.id});
            if (!result) {
                this.notification.add(_t("Unexpected response from server."), {type: "danger"});
                return;
            }
            role.assigned = assign;
            this.notification.add(_t(`✓ Role "${role.name}" ${msg} successfully!`), {type});
            await this.parentComponent?.fetch_data?.();
            this.parentComponent?.render?.();
        } catch (err) {
            console.error(err);
            this.notification.add(_t(`Failed to ${msg} role "${role.name}".`), {type: "danger"});
        }
    }
}
