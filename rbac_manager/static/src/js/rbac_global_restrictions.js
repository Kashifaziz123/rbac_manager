/* @odoo-module */

import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { user, userBus } from "@web/core/user";

const FLAG_CLASSES = {
    force_readonly: "rbac-global-force-readonly",
    hide_import: "rbac-global-hide-import",
    hide_export: "rbac-global-hide-export",
    hide_spreadsheet: "rbac-global-hide-spreadsheet",
    hide_add_property: "rbac-global-hide-add-property",
    disable_dev_mode: "rbac-global-disable-dev-mode",
    hide_technical_settings: "rbac-global-hide-technical-settings",
    hide_chatter: "rbac-global-hide-chatter",
    hide_send_message: "rbac-global-hide-send-message",
    hide_log_note: "rbac-global-hide-log-note",
    hide_activity: "rbac-global-hide-activity",
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

const CHATTER_SELECTORS = {
    hide_chatter: [".o-mail-Chatter", ".oe_chatter"],
    hide_send_message: [".o-mail-Chatter-sendMessage"],
    hide_log_note: [".o-mail-Chatter-logNote"],
    hide_activity: [".o-mail-Chatter-activity"],
};

function companyKey() {
    return (user.activeCompanies || []).map((company) => company.id).join("-") || String(user.activeCompany?.id || "");
}

function applyBodyClasses(flags) {
    for (const [flag, className] of Object.entries(FLAG_CLASSES)) {
        document.body.classList.toggle(className, Boolean(flags[flag]));
    }
}

function clearRestrictedNodes() {
    for (const node of document.querySelectorAll(".rbac_global_restricted_ui")) {
        node.classList.remove("rbac_global_restricted_ui");
        node.removeAttribute("aria-hidden");
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
    for (const [flag, selectors] of Object.entries(CHATTER_SELECTORS)) {
        if (!flags[flag]) {
            continue;
        }
        for (const node of document.querySelectorAll(selectors.join(","))) {
            node.classList.add("rbac_global_restricted_ui");
            node.setAttribute("aria-hidden", "true");
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
        let observer;
        const refreshFlags = async () => {
            try {
                flags = await rpc("/rbac/access/global_flags", { company_key: companyKey() });
            } catch {
                flags = {};
            }
            clearRestrictedNodes();
            applyBodyClasses(flags);
            hideRestrictedNodes(flags);
        };
        await refreshFlags();
        observer = watchRestrictedNodes(flags);
        const onCompanyChange = async () => {
            if (observer) {
                observer.disconnect();
            }
            await refreshFlags();
            observer = watchRestrictedNodes(flags);
        };
        userBus.addEventListener("ACTIVE_COMPANIES_CHANGED", onCompanyChange);
        return {
            get flags() {
                return flags;
            },
            stop() {
                userBus.removeEventListener("ACTIVE_COMPANIES_CHANGED", onCompanyChange);
                if (observer) {
                    observer.disconnect();
                }
                clearRestrictedNodes();
                applyBodyClasses({});
            },
        };
    },
};

registry.category("services").add("rbac_global_restrictions", rbacGlobalRestrictionsService);
