/* @odoo-module */

import {RBACUserSelectionDialog, RBACRoleSelectionDialog} from "@rbac_manager/js/selection_dialog";
import {Component, markup, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {download} from "@web/core/network/download";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";
import {RBACGrantAllPermissions, RBACRevokeAllPermissions} from "./warning_permissions_dialog";


export class RBACSuperAdmin extends Component {
    static template = "rbac.SuperAdmin";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.dialogService = useService("dialog");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.action?.context?.active_id;
        this.user = [];
        this.data = useState({});
        this.custom_props = {
            'original_data': {},
            'changed_data': useState({}),
        }

        useEffect(
            () => {
                this.enabled_inputs_length();
            },
            () => [this.data, this.custom_props.changed_data]
        );

        onWillStart(async () => {
            await Promise.all([
                this.fetch_data(),
                ensureJQuery(),
            ]);
        });

        onMounted(() => {
            this.enabled_inputs_length();
            this.data.recent_changes = [];
            this.loadAuditLogs();
        });
    }

    enabled_inputs_length() {
        $('.permission-category').each(function () {
            const $inputs = $(this).find('input');
            // Count inputs that are both checked AND enabled
            $(this).find('.enabled_count').text($inputs.filter(':checked:not(:disabled)').length);
        });
    }

    //
    // view models
    //
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
        this.notification.add("Failed to open change password wizard ❌", { type: "danger" });
    }
}
    async resetPassword() {
    const userId = this.user?.[0]?.id;
    if (!userId) return;

    try {
        await this.orm.call("res.users", "action_reset_password", [[userId]]);
        this.notification.add("Password reset instructions sent successfully 📩", {
            type: "success",
        });
    } catch (error) {
        console.error(error);
        this.notification.add("Failed to send password reset instructions ❌", {
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
                    this.notification.add("Two-factor authentication disabled ✅", { type: "success" });
                } else {
                    this.notification.add("Failed to disable 2FA ❌", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error disabling 2FA ❌", { type: "danger" });
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
            this.notification.add("No linked partner found for this user ⚠️", { type: "warning" });
            return;
        }

        // Call res.partner method to get the action dict
        const action = await this.orm.call("res.partner", "action_privacy_lookup", [[partnerId]]);
        // Execute returned action (opens the wizard)
        await this.action.doAction(action);

    } catch (error) {
        console.error(error);
        this.notification.add("Failed to open Privacy Lookup ❌", { type: "danger" });
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
                    this.notification.add("User archived successfully ✅", { type: "success" });
                    window.location.href = "/odoo/super_admin/";
                } else {
                    this.notification.add("Failed to archive user ❌", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error archiving user ❌", { type: "danger" });
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
                    this.notification.add("User deleted successfully 🗑️", { type: "success" });
                    window.location.href = "/odoo/super_admin/";
                } else {
                    this.notification.add("Failed to delete user ❌", { type: "danger" });
                }
            } catch (error) {
                console.error(error);
                this.notification.add("Error deleting user ❌", { type: "danger" });
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
            this.notification.add("User duplicated successfully ✅", { type: "success" });
            window.location.href = `/odoo/super_admin/${newUserId}`;
        } else {
            this.notification.add("Failed to duplicate user ❌", { type: "danger" });
        }
    } catch (error) {
        console.error(error);
        this.notification.add("Error duplicating user ❌", { type: "danger" });
    }
}
    async view_user_role(user_role_id) {
        var view = await this.orm.call("res.users", "client_action_view_user_role", [this.record_id]);
        view['target'] = 'new';
        view['context'] = {'active_id': user_role_id, 'is_wizard': true};
        this.action.doAction(view);
    }

    async clone_from_another_user() {
        let clone_users = await this.orm.call("rbac.model", "clone_users_list", [], {'user_id': this.record_id});
        // let users = await this.orm.searchRead("res.users", [['is_user_role', '=', false]], ["id", "name"]);
        await this.dialogService.add(RBACUserSelectionDialog, {
        clone_users: clone_users,
        title: _t('Clone User'),
        cancelLabel: _t("Close"),
        confirmLabel: _t("Apply Permissions"),
        // 🔹 Add this line ↓
        target_user: { id: this.record_id, name: this.user[0]?.name || "Unknown User" },
        confirm: async () => {
            let clone_user = $('.rbac_dialog.user_selection_dialog').find('.user-item.selected').attr('data-id');
            let res = await this.orm.call("rbac.model", "clone_groups_from_user", [], {
                'user_id': this.record_id,
                'clone_user_id': parseInt(clone_user)
            });
            if (res.error)
                this.notification.add(res.error, {sticky: false, type: "danger"});
            else
                this.notification.add(res.message, {sticky: false, type: "info"});
            await this.fetch_data();
            this.reset_data();
        },
        cancel: () => {},
    });
 }

    async export_permissions() {
        await download({
            data: {
                data: JSON.stringify(await this.orm.call("rbac.model", "export_permissions_csv", [], {'user_id': this.record_id}))
            },
            url: "/web/export/csv",
        });
    }

    async multi_apply_roles() {
        await this.dialogService.add(RBACRoleSelectionDialog, {
            roles: this.data.available_roles,
            title: _t('Bulk Role Assignment'),
            cancelLabel: _t("Close"),
            target_user: {
            id: this.record_id,
            name: this.user[0]?.name || "Unknown User"
        },
            confirmLabel: _t("Apply"),
            confirm: async () => {
                let role_ids = $('.rbac_dialog.user_selection_dialog .user-item.selected')
                    .map((i, el) => $(el).attr('data-id'))
                    .get();
                for (const el of role_ids) {
                    await this.orm.call("res.users", 'assign_role', [this.record_id], {'role_id': parseInt(el)});
                }
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    assign_role(role) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to assign role  ${role.name} ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Assign"),
            confirm: async () => {
                await this.orm.call("res.users", 'assign_role', [this.record_id], {'role_id': role.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    remove_role(role) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to remove role  ${role.name} ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Remove"),
            confirm: async () => {
                await this.orm.call("res.users", 'remove_role', [this.record_id], {'role_id': role.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    assign_extra(permission) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to add ${permission.name} as extra permission ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Add"),
            confirm: async () => {
                await this.orm.call("res.users", 'add_direct_group_additions', [this.record_id], {'group_id': permission.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    remove_extra(permission) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to remove ${permission.name} as extra permission ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Remove"),
            confirm: async () => {
                await this.orm.call("res.users", 'remove_direct_group_additions', [this.record_id], {'group_id': permission.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    assign_exclude(permission) {
        var self = this;

        async function assign() {
            await self.orm.call("res.users", 'add_direct_group_exclusions', [self.record_id], {'group_id': permission.id});
            await self.fetch_data();
            self.reset_data();
        }

        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to add ${permission.name} as exclude permission ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Add"),
            confirm: async () => {
                if (this.data?.inverse_implied_ids[permission.id].length > 0) {
                    const ids = this.data?.inverse_implied_ids?.[permission.id];
                    const permissions = ids?.length
                        ? ids.map(x => `<div class="text-danger">${x}</div>`).join('')
                        : '';
                    this.dialogService.add(ConfirmationDialog, {
                        title: _t('Are you sure ?'),
                        body: markup(
                            `<div>This will also remove all these permissions and any future implied permissons of it</div>
                         <br/>${permissions}`
                        ),
                        cancelLabel: _t("Cancel"),
                        confirmLabel: _t("Remove"),
                        confirm: async () => {
                            await assign();
                        },
                        cancel: () => {
                        },
                    });
                } else {
                    await assign();
                }
            },
            cancel: () => {
            },
        });
    }

    remove_exclude(permission) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to remove ${permission.name} as exclude permission ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Remove"),
            confirm: async () => {
                await this.orm.call("res.users", 'remove_direct_group_exclusions', [this.record_id], {'group_id': permission.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    remove_initial(permission) {
        this.dialogService.add(ConfirmationDialog, {
            body: _t(`Are you sure that you want to remove ${permission.name} as base permission ?`),
            cancelLabel: _t("No"),
            confirmLabel: _t("Remove"),
            confirm: async () => {
                await this.orm.call("res.users", 'remove_initial_group', [this.record_id], {'group_id': permission.id});
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    //
    // toggle functions
    //
    toggle_filters(ev) {
        var risk_filter = $('.permissions-filters');
        risk_filter.find('.filter-tab').removeClass('active');
        $(ev).addClass('active');
        this.apply_search();
    }

    toggle_category_section(ev) {
        if ($(ev).closest('button').length) return;
        $(ev).closest('.category-header').toggleClass('closed');
    }

    grant_all_permissions() {
        this.dialogService.add(RBACGrantAllPermissions, {
            user_type: this.data?.user_type,
            user_name: this.user[0]?.name,
            cancelLabel: _t("Cancel"),
            confirmLabel: _t("Grant All Permissions"),
            confirm: async () => {
                await this.orm.call("res.users", 'grant_all_permissions', [this.record_id]);
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    revoke_all_permissions() {
        this.dialogService.add(RBACRevokeAllPermissions, {
            total_granted: this.data?.is_granted,
            assigned_roles: this.data?.assigned_roles,
            custom_permissions: Object.values(this.data.group_sources).filter(v => v.includes('direct_add')).length,
            user_name: this.user[0]?.name,
            cancelLabel: _t("Cancel"),
            confirmLabel: _t("Revoke All Permissions"),
            confirm: async () => {
                await this.orm.call("res.users", 'revoke_all_permissions', [this.record_id]);
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    toggle_category_all_checked_enabled(check, ev) {
        this.toggle_all_checked_enabled(check, $(ev).closest('.permission-category'));
    }

    toggle_all_checked_enabled(check, section = false) {
        if (!section) {
            section = $('.permission-category');
        }
        section.find('input[type="checkbox"]').prop({checked: check, indeterminate: false});
        const $radios = section.find('input[type="radio"]');
        if (check) {
            const names = [...new Set($radios.map((_, el) => el.name).get().filter(Boolean))];
            names.forEach((name) => {
                section.find(`input[type="radio"][name="${name}"]`).last().prop('checked', true);
            });
        } else {
            $radios.prop('checked', false);
        }

        const all_inputs = section.find('input[type="checkbox"], input[type="radio"]');
        all_inputs.each((_, el) => {
            this.update_values(el);
        });
    }

    //
    // onchange functions
    //
    update_values(ev) {
        const fieldName = $(ev).attr('name');
        var newValue = false;
        if ($(ev).filter(':checked:not(:disabled)').length) {
            newValue = $(ev).val();
        }

        newValue = newValue === 'on' ? true : parseInt(newValue);

        // Search through all categories
        for (let category in this.custom_props.original_data.all_categories) {
            if (this.custom_props.original_data.all_categories[category][fieldName]) {
                this.custom_props.changed_data.all_categories[category][fieldName].value = newValue;
                break;
            }
        }

        this.enabled_inputs_length();
    }

    apply_search(mode = false) {
        var src = this.custom_props.original_data.all_categories;
        let no_save = true;

        if (!mode) {
            const $rf = $('.permissions-filters');
            const is_all = $rf.find('.all.active').length;
            const is_granted = $rf.find('.granted.active').length;
            const is_denied = $rf.find('.denied.active').length;
            const is_high_risk = $rf.find('.high_risk.active').length;
            const is_overrides = $rf.find('.overrides.active').length;
            mode = is_all ? 'all' : is_granted ? 'granted' : is_denied ? 'denied' : is_high_risk ? 'high' : is_overrides ? 'overrides' : null;
            no_save = false;
        }

        if (!no_save && (!mode || mode === 'all')) {
            this.data.all_categories = src;
        } else {
            const out = {};

            const pick = (sv) => {
                const hasMulti = sv.values !== false;

                if (mode === 'high') {
                    if (sv.group?.risk_level === 'high') return sv;
                    if (sv.groups?.length) {
                        const hi = sv.groups.filter(g => g.risk_level === 'high');
                        return hi.length ? {...sv, groups: hi} : null;
                    }
                    return null;
                } else if (mode === 'granted' || mode === 'denied') {
                    const wantIncluded = (mode === 'granted')
                    if (hasMulti && sv.groups?.length) {
                        const allow = new Set(sv.values);
                        const keep = sv.groups.filter(g => (allow.has(g.id)) === wantIncluded);
                        return keep.length ? {...sv, groups: keep} : null;
                    }
                    const isGrantedSingle = sv.value !== false;
                    return (isGrantedSingle === wantIncluded) ? sv : null;
                } else if (mode === 'overrides') {
                    if (hasMulti && sv.groups?.length) {
                        const keep = sv.groups.filter(g => {
                            const src = this.data?.group_sources?.[g.id];
                            return src?.includes('direct_add') || src?.includes('excluded');
                        });
                        return keep.length ? {...sv, groups: keep} : null;
                    }
                    // For single values, check if overridden
                    const src = this.data?.group_sources?.[sv.group?.id];
                    return (src?.includes('direct_add') || src?.includes('excluded')) ? sv : null;
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

            if (no_save)
                return out;
            this.data.all_categories = out;
        }
        this.total_counts();
        this.render();
    }

    //
    // widget reset
    //
    total_counts() {
        function get_filtered_count(obj) {
            return Object.values(obj).reduce((total, main) =>
                total + Object.values(main).reduce((sum, item) =>
                    sum + (item.groups?.length || 1), 0), 0);
        }

        const all = this.custom_props.original_data.all_categories || {};
        this.data.all_groups_count = get_filtered_count(all);
        this.data.is_granted = get_filtered_count(this.apply_search('granted'));
        this.data.is_denied = get_filtered_count(this.apply_search('denied'));
        this.data.is_high_risk = get_filtered_count(this.apply_search('high'));
        this.data.is_overrides = get_filtered_count(this.apply_search('overrides'));
    }

    //
    // widget reset
    //
    reset_data() {
        $('.category-header').removeClass('closed');
        var risk_filter = $('.permissions-filters');
        risk_filter.find('.filter-tab').removeClass('active');
        risk_filter.find('.filter-tab.all').addClass('active');
        this.render();
    }

    //
    //  model CRUD functions
    //
    async loadAuditLogs(showAll = false) {
    try {
        // decide limit dynamically
        const limit = showAll ? 1000 : 10;
        const offset = 0;
        const resp = await this.orm.call(
            "rbac.model",
            "get_recent_audit_changes",
            [this.record_id, limit, offset]
        );

        const records = resp.records || [];
        this.data.recent_changes = records;

        const container = $("#audit_logs_container");
        const renderChanges = (items) => items.map(change => `
            <div class="change-item ${change.indicator}">
                <div class="change-indicator ${change.indicator}">
                    ${change.indicator === 'added' ? '✓'
                      : change.indicator === 'removed' ? '✕'
                      : change.indicator === 'modified' ? '✎'
                      : '•'}
                </div>
                <div class="change-content">
                    <div class="change-title">
                        <span class="change-badge badge-${change.indicator}">
                            ${change.action}
                        </span>
                        ${change.details || ''}
                    </div>
                    <div class="change-meta">
                        🕐 ${change.timestamp} • ${change.ago} • by ${change.performed_by}
                    </div>
                </div>
            </div>
        `).join('');

        let html = renderChanges(records);
        if (resp.total_count > 10) {
            // always show toggle if more than 10 total logs
            const label = showAll
                ? `← Show less (10 of ${resp.total_count})`
                : `Show all (${resp.total_count}) →`;
            html += `
                <div class="view-all-link">
                    <a id="toggle_audit_logs" href="#">${label}</a>
                </div>`;
        } else {
            html += `<div class="view-all-link text-muted">All records loaded.</div>`;
        }
        container.html(html || '<div class="no-data">No permission changes in the last 30 days.</div>');

        $("#toggle_audit_logs").on("click", (ev) => {
            ev.preventDefault();
            this.loadAuditLogs(!showAll);
        });

    } catch (err) {
        console.error("Audit log fetch failed:", err);
        $("#audit_logs_container").html('<div class="text-danger">Failed to load changes.</div>');
    }
}
    async fetch_data() {
    this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', false]], ["name", 'email']);
    this.data = await this.orm.call("rbac.model", "get_rbac_super_admin_json", [this.record_id]);
    // 🟢 Set initial display settings
    this.limit = 10;
    this.showAll = false;
    this.displayedChanges = (this.data.recent_changes || []).slice(0, this.limit);
    if (this.user[0]?.name === undefined) {
        var message = _t("It seems the records with IDs %s cannot be found. They might have been deleted.", this.record_id)
        this.notification.add(message, {sticky: true, type: "danger"});
        this.action.doAction('rbac_manager.act_window_res_users_list_super_admin', {clearBreadcrumbs: true});
    }

    this.data.json_group_sources = this.data.group_sources;
    this.data.group_sources = JSON.parse(this.data.group_sources);
    this.custom_props.original_data = JSON.parse(JSON.stringify(this.data || {}));
    this.custom_props.changed_data = JSON.parse(JSON.stringify(this.custom_props.original_data));
    this.total_counts();
}
    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
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
    async writeRecord() {
        function getChangedValues(original_js_dict, new_js_dict) {
            const result = {};

            // Build a flat map of original values
            const originalValues = {};
            for (let categoryName in original_js_dict) {
                const category = original_js_dict[categoryName];
                for (let fieldName in category) {
                    originalValues[fieldName] = category[fieldName].value;
                }
            }

            // Check new_js_dict for changes
            for (let categoryName in new_js_dict) {
                const category = new_js_dict[categoryName];

                for (let fieldName in category) {
                    const newValue = category[fieldName].value;

                    // Only add if field existed in original AND value changed
                    if (fieldName in originalValues && originalValues[fieldName] !== newValue) {
                        result[fieldName] = newValue;
                    }
                }
            }

            return result;
        }

        this.dialogService.add(ConfirmationDialog, {
            body: _t("Are you sure that you save the changes ?"),
            cancelLabel: _t("No"),
            confirmLabel: _t("Yes"),
            confirm: async () => {
                const changedValues = getChangedValues(this.custom_props.original_data.all_categories, this.custom_props.changed_data.all_categories);
                await this.orm.write("res.users", [this.record_id], changedValues);
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }
}

registry.category("actions").add("rbac.super_admin", RBACSuperAdmin);
