/* @odoo-module */

import {Component, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";


export class RBACUserRoles extends Component {
    static template = "rbac.UserRoles";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.dialogService = useService("dialog");
        this.action = useService("action");
        this.orm = useService("orm");
        this.searchInput = useRef("searchInput");
        this.categories = useState({});
        this.record_id = this.props?.action?.context?.active_id;
        this.is_wizard = this.props?.action?.context?.is_wizard;
        this.user = [];
        this.custom_props = useState({
            'original_data': {},
            'changed_data': {},
        })

        useEffect(
            () => {
                this.enabled_inputs_length();
            },
            () => [this.categories, this.custom_props.changed_data]
        );

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
            // loadCSS('/rbac_manager/static/src/css/user_roles.css');
        });

        onMounted(() => {
            this.enabled_inputs_length();
        });
    }

    enabled_inputs_length() {
        $('.category-section').each(function () {
            const $inputs = $(this).find('input');
            // Count inputs that are both checked AND enabled
            $(this).find('.enabled_count').text($inputs.filter(':checked:not(:disabled)').length);
        });
    }

    //
    // toggle functions
    //
    toggle_risk_level(ev) {
        $(ev).toggleClass('active');
        this.apply_search();
    }

    toggle_category_section(ev) {
        if ($(ev).closest('button').length) return;
        $(ev).closest('.category-header').toggleClass('closed');
    }

    toggle_category_all_checked_enabled(check, ev) {
        this.toggle_all_checked_enabled(check, $(ev).closest('.category-section'));
    }

    toggle_all_checked_enabled(check, section = false) {
        if (!section) {
            section = $('.permissions-grid');
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
        for (let category in this.custom_props.original_data) {
            if (this.custom_props.original_data[category][fieldName]) {
                this.custom_props.changed_data[category][fieldName].value = newValue;
                break;
            }
        }
    }

    apply_search() {
        var searchStr = this.searchInput.el.value;
        var risk_filter = $('.risk-filter')
        var is_low = risk_filter.find('.low.active').length
        var is_medium = risk_filter.find('.medium.active').length
        var is_high = risk_filter.find('.high.active').length

        function filterByGroupName(js_dict) {
            let filteredDict = JSON.parse(JSON.stringify(js_dict)); // Deep copy
            const result = {};

            // Step 1: Filter by risk levels if any are specified
            if (is_low || is_medium || is_high) {
                const allowedRiskLevels = [];
                if (is_low) allowedRiskLevels.push('low');
                if (is_medium) allowedRiskLevels.push('medium');
                if (is_high) allowedRiskLevels.push('high');

                for (let categoryName in filteredDict) {
                    const category = filteredDict[categoryName];

                    for (let fieldName in category) {
                        const field = category[fieldName];

                        if (field.group) {
                            if (!allowedRiskLevels.includes(field.group.risk_level)) {
                                delete category[fieldName];
                                continue;
                            }
                        } else if (field.groups && Array.isArray(field.groups)) {
                            field.groups = field.groups.filter(g =>
                                allowedRiskLevels.includes(g.risk_level)
                            );
                            if (field.groups.length === 0) {
                                delete category[fieldName];
                            }
                        }
                    }
                    if (Object.keys(category).length === 0) {
                        delete filteredDict[categoryName];
                    }
                }
            }

            for (let categoryName in filteredDict) {
                const category = filteredDict[categoryName];

                for (let fieldName in category) {
                    const field = category[fieldName];
                    let matchFound = false;

                    if (field.group && field.group.name) {
                        if (field.group.name.toLowerCase().includes(searchStr.toLowerCase())) {
                            matchFound = true;
                        }
                    } else if (field.groups && Array.isArray(field.groups)) {
                        const hasMatch = field.groups.some(g =>
                            g.name && g.name.toLowerCase().includes(searchStr.toLowerCase())
                        );
                        if (hasMatch) {
                            matchFound = true;
                        }
                    }

                    if (matchFound) {
                        if (!result[categoryName]) {
                            result[categoryName] = {};
                        }
                        result[categoryName][fieldName] = field;
                    }
                }
            }

            return result;
        }

        this.categories = filterByGroupName(this.custom_props.changed_data);
        this.render();
    }

    //
    // widget reset
    //
    reset_data() {
        $('.risk-filter').find('.risk-badge').removeClass('active');
        $('.category-header').removeClass('closed');
        this.searchInput.el.value = '';
        this.render();
    }

    //
    //  model CRUD functions
    //
    async fetch_data() {
        this.user = await this.orm.searchRead("res.users", [['id', '=', this.record_id], ['is_user_role', '=', true], ['active', '=', false]], ["name"]);
        if (this.user[0]?.name === undefined) {
            var message = _t("It seems the records with IDs %s cannot be found. They might have been deleted.", this.record_id)
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_user_role', {clearBreadcrumbs: true});
        }
        this.categories = await this.orm.call("rbac.model", "get_role_templates", [], {'user_id': this.record_id});

        this.custom_props.original_data = JSON.parse(JSON.stringify(this.categories));
        this.custom_props.changed_data = JSON.parse(JSON.stringify(this.custom_props.original_data));
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
                const changedValues = getChangedValues(this.custom_props.original_data, this.custom_props.changed_data);
                await this.orm.write("res.users", [this.record_id], changedValues);
                await this.fetch_data();
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }

    discardRecord() {
        this.dialogService.add(ConfirmationDialog, {
            body: _t("Are you sure that you discard the changes ?"),
            cancelLabel: _t("No"),
            confirmLabel: _t("Yes"),
            confirm: () => {
                this.categories = JSON.parse(JSON.stringify(this.custom_props.original_data));
                this.custom_props.changed_data = JSON.parse(JSON.stringify(this.categories));
                this.reset_data();
            },
            cancel: () => {
            },
        });
    }
}

registry.category("actions").add("rbac.user_role", RBACUserRoles);
