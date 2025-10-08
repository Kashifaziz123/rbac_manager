/* @odoo-module */

import {RBACUserSelectionDialog, RBACRoleSelectionDialog} from "@rbac_manager/js/selection_dialog";
import {Component, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {download} from "@web/core/network/download";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";


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
            await this.fetch_data();
            await ensureJQuery();
            // loadCSS('/rbac_manager/static/src/css/rbac_super_admin.css');
        });

        onMounted(() => {
            this.enabled_inputs_length();
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
            cancel: () => {
            },
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
            confirmLabel: _t("Apply"),
            confirm: async () => {
                let roles_assign = $('.rbac_super_admin.rbac_dialog').find('input:checked');
                for (const el of roles_assign) {
                    await this.orm.call("res.users", 'assign_role', [this.record_id], {'role_id': parseInt(el.value)});
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
            mode = is_all ? 'all' : is_granted ? 'granted' : is_denied ? 'denied' : is_high_risk ? 'high' : null;
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
                }
                // else if (mode === 'granted') {
                //     if (hasMulti && sv.groups?.length) {
                //         const allow = new Set(sv.values);
                //         const keep = sv.groups.filter(g => allow.has(g.id));
                //         return keep.length ? {...sv, groups: keep} : null;
                //     }
                //     return sv.value !== false ? sv : null;
                // } else if (mode === 'denied') {
                //     if (hasMulti && sv.groups?.length) {
                //         const allow = new Set(sv.values);
                //         const keep = sv.groups.filter(g => !allow.has(g.id));
                //         return keep.length ? {...sv, groups: keep} : null;
                //     }
                //     return sv.value === false ? sv : null;
                // }

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
    async fetch_data() {
        this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', false]], ["name", 'email']);
        this.data = await this.orm.call("rbac.model", "get_rbac_super_admin_json", [this.record_id]);

        if (this.user[0]?.name === undefined) {
            var message = _t("It seems the records with IDs %s cannot be found. They might have been deleted.", this.record_id)
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_super_admin', {clearBreadcrumbs: true});
        }

        this.custom_props.original_data = JSON.parse(JSON.stringify(this.data || {}));
        this.custom_props.changed_data = JSON.parse(JSON.stringify(this.custom_props.original_data));
        this.total_counts();
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
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
