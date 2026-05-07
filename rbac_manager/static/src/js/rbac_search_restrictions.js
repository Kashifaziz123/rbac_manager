/* @odoo-module */

import { DomainSelectorDialog } from "@web/core/domain_selector_dialog/domain_selector_dialog";
import { getDefaultDomain } from "@web/core/domain_selector/utils";
import { DomainSelector } from "@web/core/domain_selector/domain_selector";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { patch } from "@web/core/utils/patch";
import { sortBy } from "@web/core/utils/arrays";
import { user as webUser } from "@web/core/user";
import { useBus } from "@web/core/utils/hooks";
import { SearchBarMenu } from "@web/search/search_bar_menu/search_bar_menu";
import { SearchModel } from "@web/search/search_model";

const rbacSearchRestrictions = window.__rbacSearchRestrictions || {};
window.__rbacSearchRestrictions = rbacSearchRestrictions;
const pendingRestrictionRequests = {};

function restrictionKey(resModel) {
    if (!resModel) {
        return "";
    }
    const companyIds = (webUser.activeCompanies || []).map((company) => company.id).join("-");
    const activeCompanyId = webUser.activeCompany?.id || "";
    return `${resModel}::${activeCompanyId}::${companyIds}`;
}

function restrictionSet(resModel, key) {
    const restrictions = rbacSearchRestrictions[restrictionKey(resModel)] || {};
    return new Set(restrictions[key] || []);
}

async function ensureRestrictions(resModel) {
    const key = restrictionKey(resModel);
    if (!resModel || rbacSearchRestrictions[key]) {
        return rbacSearchRestrictions[key] || {};
    }
    if (!pendingRestrictionRequests[key]) {
        pendingRestrictionRequests[key] = rpc("/rbac/access/search_restrictions", {
            res_model: resModel,
            company_key: key,
        }).then((restrictions) => {
            rbacSearchRestrictions[key] = restrictions || {};
            delete pendingRestrictionRequests[key];
            return rbacSearchRestrictions[key];
        }).catch(() => {
            rbacSearchRestrictions[key] = {};
            delete pendingRestrictionRequests[key];
            return rbacSearchRestrictions[key];
        });
    }
    return pendingRestrictionRequests[key];
}

function filteredFields(fields, hiddenNames) {
    const entries = Object.entries(fields || {}).filter(([name]) => !hiddenNames.has(name));
    return Object.fromEntries(entries);
}

function isSearchableDomainField(fieldDef) {
    return Boolean(fieldDef?.searchable) && fieldDef.type !== "json" && fieldDef.type !== "separator";
}

patch(SearchModel.prototype, {
    async load(config) {
        const result = await super.load(...arguments);
        this.rbacSearchRestrictions = rbacSearchRestrictions[restrictionKey(this.resModel)] || {};
        if (config?.resModel) {
            ensureRestrictions(config.resModel).then((restrictions) => {
                this.rbacSearchRestrictions = restrictions || {};
                this.trigger("rbac-search-restrictions-updated");
            });
        }
        return result;
    },

    async spawnCustomFilterDialog() {
        let domain;
        try {
            await ensureRestrictions(this.resModel);
            const hiddenFilterFields = restrictionSet(this.resModel, "filter_fields");
            let searchViewFields = hiddenFilterFields.size
                ? filteredFields(this.searchViewFields, hiddenFilterFields)
                : this.searchViewFields;
            if (!Object.keys(searchViewFields || {}).length) {
                searchViewFields = this.searchViewFields;
            }
            domain = getDefaultDomain(searchViewFields);
        } catch {
            return super.spawnCustomFilterDialog(...arguments);
        }
        this.dialog.add(DomainSelectorDialog, {
            resModel: this.resModel,
            defaultConnector: "|",
            domain,
            context: this.globalContext,
            onConfirm: (domain) => this.splitAndAddDomain(domain),
            disableConfirmButton: (domain) => domain === `[]`,
            title: _t("Custom Filter"),
            confirmButtonText: _t("Search"),
            discardButtonText: _t("Discard"),
            isDebugMode: this.isDebugMode,
        });
    },
});

patch(SearchBarMenu.prototype, {
    setup() {
        super.setup(...arguments);
        this.refreshRbacGroupFields();
        useBus(this.env.searchModel, "rbac-search-restrictions-updated", () => {
            this.refreshRbacGroupFields();
            this.render();
        });
    },

    refreshRbacGroupFields() {
        const fields = [];
        const searchViewFields = this.env?.searchModel?.searchViewFields || {};
        for (const [fieldName, field] of Object.entries(searchViewFields)) {
            if (this.validateField(fieldName, field)) {
                fields.push(Object.assign({ name: fieldName }, field));
            }
        }
        this.fields = sortBy(fields, "string");
    },

    validateField(fieldName, field) {
        const resModel = this.env?.searchModel?.resModel;
        const hiddenGroupFields = restrictionSet(resModel, "group_fields");
        if (hiddenGroupFields.has(fieldName)) {
            return false;
        }
        return super.validateField(...arguments);
    },
});

patch(DomainSelector.prototype, {
    getPathEditorInfo(resModel, defaultCondition) {
        const info = super.getPathEditorInfo(...arguments);
        const extractProps = info.extractProps;
        info.extractProps = (params) => {
            const props = extractProps(params);
            const hiddenFilterFields = restrictionSet(resModel, "filter_fields");
            if (!hiddenFilterFields.size) {
                return props;
            }
            return {
                ...props,
                filter: (fieldDef, path, currentModel) => {
                    const rootPath = !path;
                    const sameModel = currentModel === resModel;
                    const hidden = rootPath && sameModel && hiddenFilterFields.has(fieldDef?.name);
                    return !hidden && isSearchableDomainField(fieldDef);
                },
            };
        };
        return info;
    },
});
