/* @odoo-module */

import {ensureJQuery} from '@web/core/ensure_jquery';
import {Component, onWillStart} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";
import {RBACPermissionsDialog} from "@rbac_manager/js/permission_dialog";


export class RBACUserPermissions extends Component {
    static template = "rbac.UserPermissions";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.action = useService("action");
        this.orm = useService("orm");
        this.record_id = this.props?.action?.context?.active_id || this.props?.resId;
        this.custom_props = {'original_data': {}}
        this.data = {}
        this.dialogService = useService("dialog");

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
            // loadCSS('/rbac_manager/static/src/css/user_permissions.css');
        });
    }
    //
    // toggle functions
    //
    toggle_filters(ev) {
        var risk_filter = $('.table-filters');
        risk_filter.find('.filter-tab').removeClass('active');
        $(ev).addClass('active');
        this.apply_search();
    }

    //
    // onchange functions
    //
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

    //
    //  model CRUD functions
    //
    async fetch_data() {
        this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', false]], ["name", 'email']);
        this.data = await this.orm.call("rbac.model", "get_user_permissions_json", [], {'user_id': this.record_id});

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

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }
}

registry.category("actions").add("rbac.user_permission", RBACUserPermissions);
