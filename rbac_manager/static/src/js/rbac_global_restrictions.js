/* @odoo-module */

import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

const FLAG_CLASSES = {
    force_readonly: "rbac-global-force-readonly",
    hide_import: "rbac-global-hide-import",
    hide_export: "rbac-global-hide-export",
    hide_spreadsheet: "rbac-global-hide-spreadsheet",
    hide_add_property: "rbac-global-hide-add-property",
    disable_dev_mode: "rbac-global-disable-dev-mode",
    hide_technical_settings: "rbac-global-hide-technical-settings",
};

const TEXT_RESTRICTIONS = [
    {
        flag: "hide_spreadsheet",
        terms: ["spreadsheet"],
        selectors: [
            ".dropdown-item",
            ".o-dropdown-item",
            ".o_menu_item",
            ".o_command",
            "button",
            "a",
        ],
    },
    {
        flag: "hide_add_property",
        terms: ["add property"],
        selectors: [
            ".dropdown-item",
            ".o-dropdown-item",
            ".o_field_property_add",
            "button",
        ],
    },
];

function applyBodyClasses(flags) {
    for (const [flag, className] of Object.entries(FLAG_CLASSES)) {
        document.body.classList.toggle(className, Boolean(flags[flag]));
    }
}

function textMatches(node, terms) {
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return text && terms.some((term) => text.includes(term));
}

function hideRestrictedNodes(flags) {
    for (const restriction of TEXT_RESTRICTIONS) {
        if (!flags[restriction.flag]) {
            continue;
        }
        const selector = restriction.selectors.join(",");
        for (const node of document.querySelectorAll(selector)) {
            if (textMatches(node, restriction.terms)) {
                node.classList.add("rbac_global_restricted_ui");
                node.setAttribute("aria-hidden", "true");
            }
        }
    }
}

function watchRestrictedNodes(flags) {
    const observer = new MutationObserver(() => hideRestrictedNodes(flags));
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
    hideRestrictedNodes(flags);
    return observer;
}

export const rbacGlobalRestrictionsService = {
    async start() {
        let flags = {};
        try {
            flags = await rpc("/rbac/access/global_flags", {});
        } catch {
            return {};
        }
        applyBodyClasses(flags);
        const observer = watchRestrictedNodes(flags);
        return {
            flags,
            stop() {
                observer.disconnect();
            },
        };
    },
};

registry.category("services").add("rbac_global_restrictions", rbacGlobalRestrictionsService);
