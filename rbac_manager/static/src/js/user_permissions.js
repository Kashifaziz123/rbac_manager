/* @odoo-module */

import {ensureJQuery} from '@web/core/ensure_jquery';
import {Component, onMounted, onWillStart} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";
import {RBACPermissionsDialog,RBACRolesDialog} from "@rbac_manager/js/permission_dialog";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACUserPermissions extends Component {
    static template = "rbac.UserPermissions";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.action?.context?.active_id || this.props?.resId;
        this.custom_props = {'original_data': {}}
        this.data = { recent_changes: [], total_count: 0 };
        this.dialogService = useService("dialog");
        this.limit = 10;
        onMounted(() => {
            this.loadAuditLogs();
        });
        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
        });
    }
    toggle_filters(ev) {
        var risk_filter = $('.table-filters');
        risk_filter.find('.filter-tab').removeClass('active');
        $(ev).addClass('active');
        this.apply_search();
    }
    async changePassword() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    try {
        this.action.doAction({
          type: "ir.actions.act_window",
          name: "Change Password",
          res_model: "change.password.wizard",
          views: [[false, "form"]],
          target: "new",
          context: {
            active_model: "res.users",
            active_ids: [userId],
          },
});

    } catch (error) {
        console.error(error);
        this.notification.add("Failed to open change password wizard", { type: "danger" });
    }
}
    async resetPassword() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    try {
        await this.orm.call("res.users", "action_reset_password", [[userId]]);
        this.notification.add("Password reset instructions sent successfully", {
            type: "success",
        });
    } catch (error) {
        console.error(error);
        this.notification.add("Failed to send password reset instructions", {
            type: "danger",
        });
    }
}
    async disable2FA() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;
    this.dialogService.add(ConfirmationDialog, {
        title: "Disable Two-Factor Authentication",
        body: "Are you sure you want to disable 2FA for this user?",
        confirmLabel: "Disable",
        cancelLabel: "Cancel",
        confirmClass: "btn-danger",
        confirm: async () => {
            try {
                // ✅ Direct ORM call to res.users
                const result = await this.orm.call("res.users", "action_totp_disable", [[userId]]);

                if (result !== false) {
                    this.notification.add("Two-factor authentication disabled", { type: "success" });
                } else {
                    this.notification.add("Failed to disable 2FA", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error disabling 2FA", { type: "danger" });
            }
        },
    });
}
    async privacyLookup() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    try {
        // First, fetch the partner_id linked to this user
        const result = await this.orm.read("res.users", [userId], ["partner_id"]);
        const partnerId = result?.[0]?.partner_id?.[0];
        if (!partnerId) {
            this.notification.add("No linked partner found for this user️", { type: "warning" });
            return;
        }

        // Call res.partner method to get the action dict
        const action = await this.orm.call("res.partner", "action_privacy_lookup", [[partnerId]]);
        // Execute returned action (opens the wizard)
        await this.action.doAction(action);

    } catch (error) {
        console.error(error);
        this.notification.add("Failed to open Privacy Lookup", { type: "danger" });
    }
}
    async archiveUser() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    this.dialogService.add(ConfirmationDialog, {
        title: "Archive User",
        body: "Are you sure you want to archive this user?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        confirm: async () => {
            try {
                const result = await this.orm.call("res.users", "write", [[userId], { active: false }]);
                if (result) {
                    this.notification.add("User archived successfully", { type: "success" });
                    window.location.href = "/odoo/user_permission/";
                } else {
                    this.notification.add("Failed to archive user", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error archiving user", { type: "danger" });
            }
        },
        cancel: () => {},
    });
}
    async deleteUser() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    this.dialogService.add(ConfirmationDialog, {
        title: "Delete User",
        body: "This action will permanently delete the user. Are you sure you want to continue?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        confirmClass: "btn-danger",
        confirm: async () => {
            try {
                const result = await this.orm.call("res.users", "unlink", [[userId]]);
                if (result) {
                    this.notification.add("User deleted successfully️", { type: "success" });
                    window.location.href = "/odoo/user_permission/";
                } else {
                    this.notification.add("Failed to delete user", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error deleting user", { type: "danger" });
            }
        },
        cancel: () => {},
    });
}
    async duplicateUser() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    try {
        const newUserId = await this.orm.call("res.users", "copy", [[userId]]);
        if (newUserId) {
            this.notification.add("User duplicated successfully", { type: "success" });
            window.location.href = `/odoo/user_permission/${newUserId}`;
        } else {
            this.notification.add("Failed to duplicate user", { type: "danger" });
        }
    } catch (error) {
        console.error(error);
        this.notification.add("Error duplicating user", { type: "danger" });
    }
}
    async request_permissions(){
    await this.dialogService.add(RBACPermissionsDialog, {
        title: _t('Request Additional Permission'),
        resId: this.record_id,
        parentComponent: this,
        cancelLabel: _t("Close"),
        confirmLabel: _t("Submit Request"),
        confirm: async () => {
        },
        cancel: () => {},
    });
    }
    async requestRoles(){
    await this.dialogService.add(RBACRolesDialog, {
        title: _t('Manage Roles'),
        resId: this.record_id,
        parentComponent: this,
        cancelLabel: _t("Close"),
        confirm: async () => {
        },
        cancel: () => {},
    });
    }
    async loadAuditLogs(showAll = false) {
    try {
        const offset = this.data.recent_changes.length;
        const total = this.data.total_count;
        const limit = showAll && (!total || offset < total) ? 100 : 10;

        const resp = await this.orm.call("rbac.model", "get_recent_audit_changes", [
            this.record_id,
            limit,
            showAll ? offset : 0,
        ]);

        // Merge or reset
        this.data.total_count = resp.total_count || total || 0;
        this.data.recent_changes = showAll
            ? [...this.data.recent_changes, ...(resp.records || [])]
            : resp.records || [];

        const records = this.data.recent_changes;
        const container = $("#audit_logs_container");

        if (!records.length) {
            container.html('<div class="no-data">No permission changes in the last 30 days.</div>');
            return;
        }

        const renderChange = (c) => `
            <div class="change-item ${c.indicator}">
                <div class="change-indicator ${c.indicator}">
                    ${c.indicator === "added" ? "✓" :
                      c.indicator === "removed" ? "✕" :
                      c.indicator === "modified" ? "✎" : "•"}
                </div>
                <div class="change-content">
                    <div class="change-title">
                        <span class="change-badge badge-${c.indicator}">${c.action}</span>
                        ${c.details || ""}
                    </div>
                    <div class="change-meta">
                        🕐 ${c.timestamp} • ${c.ago} • by ${c.performed_by}
                    </div>
                </div>
            </div>`;

        let html = records.map(renderChange).join("");

        // Footer logic
        if (records.length < this.data.total_count) {
            html += `<div class="view-all-link"><a id="toggle_audit_logs" href="#">Show more (${records.length}/${this.data.total_count}) →</a></div>`;
        } else if (records.length > 10) {
            html += `<div class="view-all-link"><a id="toggle_audit_logs" href="#">← Show less</a></div>`;
        } else {
            html += `<div class="view-all-link text-muted">All records loaded.</div>`;
        }

        container.html(html);

        // Event binding (delegated to avoid stacking listeners)
        container.off("click", "#toggle_audit_logs");
        container.on("click", "#toggle_audit_logs", (ev) => {
            ev.preventDefault();
            const reset = records.length >= this.data.total_count && this.data.total_count > 10;
            if (reset) {
                this.data.recent_changes = records.slice(0, 10);
            }
            this.loadAuditLogs(!reset);
        });
    } catch (err) {
        console.error("Audit log fetch failed:", err);
        $("#audit_logs_container").html('<div class="text-danger">Failed to load changes.</div>');
    }
}
    async deleteImage() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    this.dialogService.add(ConfirmationDialog, {
        title: "Remove Profile Image",
        body: "Are you sure you want to delete this user's profile image?",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        confirmClass: "btn-primary",
        confirm: async () => {
            try {
                await this.orm.write("res.users", [userId], { image_1920: false });
                this.notification.add("Profile image removed", { type: "success" });
                await this.fetch_data();
                this.render();
            } catch (error) {
                console.error(error);
                this.notification.add("Failed to remove image", { type: "danger" });
            }
        },
        cancel: () => {},
    });
}
    async openPreferences() {
    try {
        const userId = this.user?.[0]?.id;
        await this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "res.users",
            res_id: userId,
            views: [[false, "form"]],
            target: "new",
            context: {
                form_view_ref: "base.view_users_form_simple_modif",
            },
        });
    } catch (error) {
        console.error("Error opening preferences:", error);
        this.notification.add("Failed to open preferences.", { type: "danger" });
    }
}

    async uploadImage() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    // Create hidden file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target.result.split(",")[1];
            try {
                await this.orm.write("res.users", [userId], { image_1920: base64Data });
                this.notification.add("Profile image updated successfully", { type: "success" });
                await this.fetch_data();
                this.render();
            } catch (error) {
                console.error(error);
                this.notification.add("Failed to upload image ❌", { type: "danger" });
            }
        };
        reader.readAsDataURL(file);
    };

    input.click();
}
    apply_search() {
        const $rf = $('.table-filters');
        const is_all = $rf.find('.all.active').length;
        const is_granted = $rf.find('.granted.active').length;
        const is_denied = $rf.find('.denied.active').length;
        const is_high_risk = $rf.find('.high_risk.active').length;

        const mode = is_all ? 'all' : is_granted ? 'granted' : is_denied ? 'denied' : is_high_risk ? 'high' : null;

        const src = this.custom_props.original_data;

        if (!mode || mode === 'all') {
            this.data.all_categories = src;
        } else {
            const out = {};

            const pick = (sv) => {
                const hasMulti = sv.values != false;

                if (mode === 'high') {
                    if (sv.group?.risk_level === 'high') return sv;
                    if (sv.groups?.length) {
                        const hi = sv.groups.filter(g => g.risk_level === 'high');
                        return hi.length ? {...sv, groups: hi} : null;
                    }
                    return null;
                }

                if (mode === 'granted') {
                    if (hasMulti && sv.groups?.length) {
                        const allow = new Set(sv.values);
                        const keep = sv.groups.filter(g => allow.has(g.id));
                        return keep.length ? {...sv, groups: keep} : null;
                    }
                    return sv.value !== false ? sv : null;
                }

                if (mode === 'denied') {
                    if (hasMulti && sv.groups?.length) {
                        const allow = new Set(sv.values);
                        const keep = sv.groups.filter(g => !allow.has(g.id));
                        return keep.length ? {...sv, groups: keep} : null;
                    }
                    return sv.value === false ? sv : null;
                }

                return null;
            };

            for (const mainKey in src) {
                const bucket = src[mainKey];
                for (const subKey in bucket) {
                    const sv = bucket[subKey];
                    const filtered = pick(sv);
                    if (!filtered) continue;
                    (out[mainKey] ||= {})[subKey] = filtered;
                }
            }

            this.data.all_categories = out;
        }
        this.data.all_groups_count = Object.values(this.data?.all_categories || {})
            .reduce((total, main) => total + Object.values(main)
                .reduce((sub, item) => sub + (item.groups?.length || 1), 0), 0);
        this.render();
    }
    async fetch_data() {
        this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', false]], ["name", 'email', 'image_1920']);
        this.data = await this.orm.call("rbac.model", "get_user_permissions_json", [], {'user_id': this.record_id});
        this.data.recent_changes = this.data.recent_changes || [];
        this.showAll = false;
        this.displayedChanges = this.data.recent_changes.slice(0, this.limit);

        if (this.data.error) {
            var message = _t("It seems the records with IDs %s cannot be found. They might have been deleted.", this.record_id)
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_user_permission', {clearBreadcrumbs: true});
        }
        this.data.group_sources = JSON.parse(this.data.group_sources);
        this.custom_props.original_data = JSON.parse(JSON.stringify(this.data?.all_categories || {}));
        this.data.all_groups_count = Object.values(this.data?.all_categories || {})
            .reduce((total, main) => total + Object.values(main)
                .reduce((sub, item) => sub + (item.groups?.length || 1), 0), 0);
    }
        showAllChanges(ev) {
    ev.preventDefault();
    this.showAll = true;
    this.displayedChanges = this.data.recent_changes;
    this.render();
}
    showLessChanges(ev) {
    ev.preventDefault();
    this.showAll = false;
    this.displayedChanges = this.data.recent_changes.slice(0, this.limit);
    this.render();
}
    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }
}

registry.category("actions").add("rbac.user_permission", RBACUserPermissions);
