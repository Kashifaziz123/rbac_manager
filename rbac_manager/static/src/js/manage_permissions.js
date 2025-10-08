/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {Component, onWillStart} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";


export class RBACManagePermissions extends Component {
    static template = "rbac.ManagePermissions";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.dialogService = useService("dialog");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.resId;
        this.custom_props = {
            'original_data': {},
            'changed_data': {},
        }

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
            // loadCSS('/rbac_manager/static/src/css/manage_permissions.css');
        });
    }

    //
    // view models
    //
    async view_user_role(user_role_id) {
        var view = await this.orm.call("res.users", "client_action_view_user_role", [this.record_id]);
        view['target'] = 'new';
        view['context'] = {'active_id': user_role_id, 'is_wizard': true};
        this.action.doAction(view);
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

    //
    // onchange functions
    //
    update_values(ev) {
    }

    search_permissions() {
        var permissions = this.custom_props.original_data.permissions[$('select').val()]

        const $search = $('#permissionSearch');
        const $suggestions = $('#suggestions');
        const $selected = $('#selectedPermission');
        const $chosenIdInput = $('#permissionId');

        const val = $search.val().toLowerCase().trim();
        if (!val) {
            $suggestions.hide();
            return;
        }

        const filtered = permissions.filter(p => p.name.toLowerCase().includes(val));

        if (filtered.length) {
            $suggestions.html(
                filtered.map(p => `
                    <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">
                        ${p.name}
                    </div>`).join('')
            ).show();
        } else {
            $suggestions.html('<div class="no-results">No matches</div>').show();
        }

        $suggestions.on('click', '.suggestion-item', function () {
            const name = $(this).data('name');
            const id = $(this).data('id');

            $selected.html(`
                <div class="selected-item" data-id="${id}">
                    <strong>${name}</strong>
                    <span class="remove">❌</span>
                </div>`).show();

            $search.val('');
            $suggestions.hide();
            $chosenIdInput.val(id);
        });

        $selected.on('click', '.remove', function () {
            $selected.hide().empty();
            $search.val('').focus();
            $chosenIdInput.val('');
        });

        $(document).on('click', function (e) {
            if (!$(e.target).closest('.permission-search').length) {
                $suggestions.hide();
            }
        });
    }

    //
    // widget reset
    //
    reset_data() {
        const $suggestions = $('#suggestions');
        const $selected = $('#selectedPermission');

        $selected.hide().empty();
        $suggestions.hide();
        $('form').find('input, textarea').val('');
        this.render();
    }

    //
    //  model CRUD functions
    //
    async fetch_data() {
        this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', false]], ["name", 'email']);
        this.data = await this.orm.call("rbac.model", "get_manage_permissions_json", [this.record_id]);

        if (this.data.error) {
            var message = _t("It seems the records with IDs %s cannot be found. They might have been deleted.", this.record_id)
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_user_permission', {clearBreadcrumbs: true});
        }

        this.custom_props.original_data = JSON.parse(JSON.stringify(this.data || {}));
        this.custom_props.changed_data = JSON.parse(JSON.stringify(this.custom_props.original_data));
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

    async submitRecord() {
        let values = Object.fromEntries(new FormData($('form')[0]));
        values['user_id'] = this.record_id;
        values = JSON.stringify(values);
        let record = await this.orm.call("request.rbac.permission", 'submit_manage_permission_record', [], {values});
        if (record.error) {
            this.notification.add(record.message, {sticky: false, type: "danger"});
            await this.fetch_data();
            this.reset_data();
        } else
            this.notification.add(record.message, {sticky: false, type: "info"});
    }

}

registry.category("actions").add("rbac.manage_permission", RBACManagePermissions);
