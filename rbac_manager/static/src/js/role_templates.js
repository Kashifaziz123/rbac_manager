/* @odoo-module */

import {Component, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";
import {loadCSS} from "@web/core/assets";


export class RBACRoleTemplates extends Component {
    static template = "rbac.RoleTemplates";

    setup() {
        super.setup();
        this.dialogService = useService("dialog");
        this.orm = useService("orm");
        this.form = useRef("RoleTemplatesForm");
        this.searchInput = useRef("searchInput");
        this.categories = useState({});
        this.record_id = this.props?.action?.context?.self_id;
        this.custom_props = {
            'original_data': {},
            'changed_data': {},
        }

        useEffect(
            () => {
                this.enabled_inputs_length();
            },
            () => [this.categories]  // Dependency function - runs when this.form.el changes
        );

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
            loadCSS('/rbac_manager/static/src/js/role_templates.css');
        });

        onMounted(() => {
            this.enabled_inputs_length();
        });

    }

    enabled_inputs_length() {
        $('.category-section').each(function () {
            const $inputs = $(this).find('input');

            // Count inputs that are both checked AND enabled
            const checkedAndEnabledCount = $inputs.filter(':checked:not(:disabled)').length;
            $(this).find('.enabled_count').text(checkedAndEnabledCount);
        });
    }
    //
    // toggle functions
    //
    toggle_risk_level(ev) {
        $(ev).toggleClass('active');
        this.apply_search();
    }
    toggle_category_section(ev){
        $(ev).toggleClass('closed');
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

                // Iterate through categories
                for (let categoryName in filteredDict) {
                    const category = filteredDict[categoryName];

                    // Iterate through fields in each category
                    for (let fieldName in category) {
                        const field = category[fieldName];

                        // Handle single 'group'
                        if (field.group) {
                            // Remove field if group's risk_level not in allowed levels
                            if (!allowedRiskLevels.includes(field.group.risk_level)) {
                                delete category[fieldName];
                                continue; // Skip to next field
                            }
                        }

                        // Handle 'groups' array
                        if (field.groups && Array.isArray(field.groups)) {
                            // Filter groups by risk level
                            field.groups = field.groups.filter(g =>
                                allowedRiskLevels.includes(g.risk_level)
                            );

                            // If no groups left after filtering, remove the field
                            if (field.groups.length === 0) {
                                delete category[fieldName];
                            }
                        }
                    }

                    // Remove empty categories
                    if (Object.keys(category).length === 0) {
                        delete filteredDict[categoryName];
                    }
                }
            }

            // Iterate through categories
            for (let categoryName in filteredDict) {
                const category = filteredDict[categoryName];

                // Iterate through fields in each category
                for (let fieldName in category) {
                    const field = category[fieldName];
                    let matchFound = false;

                    // Check if field has 'group' (single object)
                    if (field.group && field.group.name) {
                        if (field.group.name.toLowerCase().includes(searchStr.toLowerCase())) {
                            matchFound = true;
                        }
                    }
                    // Check if field has 'groups' (array of objects)
                    else if (field.groups && Array.isArray(field.groups)) {
                        const hasMatch = field.groups.some(g =>
                            g.name && g.name.toLowerCase().includes(searchStr.toLowerCase())
                        );
                        if (hasMatch) {
                            matchFound = true;
                        }
                    }

                    // If match found, add the whole chain to result
                    if (matchFound) {
                        // Initialize category if it doesn't exist
                        if (!result[categoryName]) {
                            result[categoryName] = {};
                        }
                        // Add the entire field object
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
        this.categories = await this.orm.call("res.groups", "get_categories_groups_json", [], {'user_id': this.record_id});

        this.custom_props.original_data = JSON.parse(JSON.stringify(this.categories));
        this.custom_props.changed_data = JSON.parse(JSON.stringify(this.custom_props.original_data));
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

registry.category("actions").add("rbac.role_templates", RBACRoleTemplates);
