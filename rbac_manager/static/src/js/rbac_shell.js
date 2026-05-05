/* @odoo-module */

import {Component, onMounted, onWillUnmount, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {registry} from "@web/core/registry";
import {session} from "@web/session";
import {RBACRolesDirectory} from "./roles_directory";
import {RBACAccessStudio} from "./access_studio";

export class RBACShell extends Component {
    static template = "rbac.Shell";
    static components = {RBACRolesDirectory, RBACAccessStudio};

    setup() {
        super.setup();
        this.action = useService("action");
        this.session = session;

        this.state = useState({
            activeSection: 'people',
            activePage:    'roles',
            sidebarOpen:   true,
            leaving:       false,   // true while doAction in flight (hides shell)
        });

        // Icon strip sections + secondary sidebar items
        this.navSections = [
            {
                id: 'overview',
                icon: 'fa-th-large',
                label: 'Overview',
                sectionLabel: 'OVERVIEW',
                items: [
                    {id: 'dashboard', label: 'Dashboard', icon: 'fa-th-large',
                     action: 'rbac_manager.view_audit_client_rbac_audit'},
                ],
            },
            {
                id: 'people',
                icon: 'fa-users',
                label: 'People',
                sectionLabel: 'PEOPLE',
                items: [
                    {id: 'users', label: 'Users', icon: 'fa-user',
                     action: 'rbac_manager.act_window_res_users_list_user_permission'},
                    {id: 'roles', label: 'Roles', icon: 'fa-star', inline: true},
                ],
            },
            {
                id: 'policy',
                icon: 'fa-lock',
                label: 'Policy',
                sectionLabel: 'POLICY',
                items: [
                    {id: 'access_studio', label: 'Access Studio', icon: 'fa-pencil-square-o', inline: true},
                    {id: 'requests', label: 'Requests', icon: 'fa-info-circle',
                     action: 'rbac_manager.request_rbac_permission_act_window'},
                ],
            },
            {
                id: 'system',
                icon: 'fa-cog',
                label: 'System',
                sectionLabel: 'SYSTEM',
                items: [
                    {id: 'audit', label: 'Audit Log', icon: 'fa-file-text-o',
                     action: 'rbac_manager.rbac_audit_act_window'},
                    {id: 'settings', label: 'Settings', icon: 'fa-cog',
                     action: 'base_setup.action_general_configuration'},
                ],
            },
        ];

        onMounted(() => {
            document.body.classList.add('rbac-shell-active');
            // Hide Odoo's native navbar
            const nav = document.querySelector('.o_main_navbar');
            if (nav) { nav.dataset.rshHidden = '1'; nav.style.display = 'none'; }
        });

        onWillUnmount(() => {
            document.body.classList.remove('rbac-shell-active');
            const nav = document.querySelector('.o_main_navbar');
            if (nav && nav.dataset.rshHidden) { nav.style.display = ''; delete nav.dataset.rshHidden; }
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    get userInitials() {
        const name = this.session.name || '';
        const words = name.trim().split(/\s+/);
        return words[1] ? (words[0][0] + words[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    }

    get currentPageLabel() {
        for (const s of this.navSections) {
            for (const item of s.items) {
                if (item.id === this.state.activePage) return item.label;
            }
        }
        return 'RBAC';
    }

    isSectionActive(sectionId) {
        return this.state.activeSection === sectionId;
    }

    isPageActive(pageId) {
        return this.state.activePage === pageId;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    selectSection(sectionId) {
        if (this.state.activeSection === sectionId) {
            this.state.sidebarOpen = !this.state.sidebarOpen;
        } else {
            this.state.activeSection = sectionId;
            this.state.sidebarOpen = true;
        }
    }

    async selectPage(item) {
        if (item.inline) {
            this.state.activePage = item.id;
        } else if (item.action) {
            this.state.leaving = true;
            // Restore native nav before navigating away so it shows for the new view
            document.body.classList.remove('rbac-shell-active');
            const nav = document.querySelector('.o_main_navbar');
            if (nav && nav.dataset.rshHidden) { nav.style.display = ''; delete nav.dataset.rshHidden; }
            await this.action.doAction(item.action, {clearBreadcrumbs: true});
        }
    }

    goHome() {
        this.state.leaving = true;
        document.body.classList.remove('rbac-shell-active');
        const nav = document.querySelector('.o_main_navbar');
        if (nav && nav.dataset.rshHidden) { nav.style.display = ''; delete nav.dataset.rshHidden; }
        this.action.doAction('menu');
    }
}

registry.category("actions").add("rbac.shell", RBACShell);
