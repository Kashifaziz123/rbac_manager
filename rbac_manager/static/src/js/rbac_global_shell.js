/* @odoo-module */

import {Component, onMounted, onWillUnmount, useState} from "@odoo/owl";
import {browser} from "@web/core/browser/browser";
import {router} from "@web/core/browser/router";
import {patch} from "@web/core/utils/patch";
import {user} from "@web/core/user";
import {useService} from "@web/core/utils/hooks";
import {session} from "@web/session";
import {Breadcrumbs} from "@web/search/breadcrumbs/breadcrumbs";
import {WebClient} from "@web/webclient/webclient";
import {UserMenu} from "@web/webclient/user_menu/user_menu";

function getInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
        return "?";
    }
    if (parts.length > 1) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
}

function visibleRootApp(app) {
    const xmlid = String(app.xmlid || "").toLowerCase();
    return xmlid !== "menu_root" && xmlid !== "base.menu_root";
}

function activeCompanyCacheKey() {
    return (user.activeCompanies || []).map((company) => company.id).join("-") || String(user.activeCompany?.id || "");
}

function clearStoredMenusForCompanyChange() {
    const key = activeCompanyCacheKey();
    const storedKey = browser.localStorage.getItem("rbac_webclient_menus_company_key");
    if (storedKey !== key) {
        browser.localStorage.removeItem("webclient_menus");
        browser.localStorage.removeItem("webclient_menus_version");
        browser.localStorage.setItem("rbac_webclient_menus_company_key", key);
    }
}

clearStoredMenusForCompanyChange();

patch(Breadcrumbs.prototype, {
    setup() {
        this.menuService = useService("menu");
    },

    get rbacRootBreadcrumb() {
        const currentApp = this.menuService.getCurrentApp();
        if (!currentApp || !visibleRootApp(currentApp)) {
            return null;
        }
        const currentBreadcrumb = this.props.breadcrumbs.at(-1);
        if (currentBreadcrumb?.name === currentApp.name) {
            return null;
        }
        return currentApp;
    },

    openRbacRootBreadcrumb() {
        const app = this.rbacRootBreadcrumb;
        if (!app) {
            return;
        }
        window.dispatchEvent(new CustomEvent("RBAC:OPEN-NAVIGATION", {
            detail: {appId: app.id},
        }));
    },
});

export class RBACGlobalSidebar extends Component {
    static template = "rbac.GlobalSidebar";

    setup() {
        this.menuService = useService("menu");
        this.actionService = useService("action");
        this.state = useState({
            expandedAppId: null,
            activeMenuId: null,
            panelOpen: true,
            expandedSections: {},
        });
        this._onMenuChange = () => this.syncFromMenuService();
        this._onRouteChange = () => this.syncFromMenuService();
        this._onOpenNavigation = (ev) => this.openNavigation(ev.detail || {});

        onMounted(() => {
            this.env.bus.addEventListener("MENUS:APP-CHANGED", this._onMenuChange);
            this.env.bus.addEventListener("ROUTE_CHANGE", this._onRouteChange);
            window.addEventListener("RBAC:OPEN-NAVIGATION", this._onOpenNavigation);
            this.syncFromMenuService();
        });
        onWillUnmount(() => {
            this.env.bus.removeEventListener("MENUS:APP-CHANGED", this._onMenuChange);
            this.env.bus.removeEventListener("ROUTE_CHANGE", this._onRouteChange);
            window.removeEventListener("RBAC:OPEN-NAVIGATION", this._onOpenNavigation);
        });
    }

    get apps() {
        return this.menuService.getApps().filter(visibleRootApp);
    }

    get activeApp() {
        const currentApp = this.menuService.getCurrentApp();
        const id = this.state.expandedAppId || currentApp?.id;
        return this.apps.find((app) => app.id === id) || currentApp || this.apps[0];
    }

    get activeAppChildren() {
        if (!this.activeApp) {
            return [];
        }
        return this.getPanelSections();
    }

    get isActiveAppRbac() {
        return this.isRbacMenu(this.activeApp);
    }

    get userInitials() {
        return getInitials(user.name);
    }

    get userName() {
        return user.name || "";
    }

    getMenuInitials(menu) {
        return getInitials(menu?.name || "");
    }

    getDisplayMenuName(menu) {
        const name = String(menu?.name || "").trim();
        return name === "User Roles" ? "Roles" : name;
    }

    getSidebarItemIcon(menu) {
        const name = String(menu?.name || "").trim().toLowerCase();
        const xmlid = String(menu?.xmlid || "").trim().toLowerCase();
        if (name === "dashboard" || xmlid.includes("menu_dashboard")) return "fa-th-large";
        if (name === "users" || xmlid.includes("menu_users_directory")) return "fa-user-o";
        if (name === "user roles" || name === "roles" || xmlid.includes("menu_user_roles")) return "fa-star-o";
        if (name === "access studio" || xmlid.includes("access_studio")) return "fa-pencil-square-o";
        if (name === "requests" || xmlid.includes("request")) return "fa-clock-o";
        if (name.includes("audit") || xmlid.includes("audit")) return "fa-file-o";
        if (name.includes("settings") || xmlid.includes("settings")) return "fa-circle-o";
        if (name.includes("permission")) return "fa-key";
        if (name.includes("admin")) return "fa-shield";
        return "";
    }

    isRbacMenu(menu) {
        const name = String(menu?.name || "").trim().toLowerCase();
        const xmlid = String(menu?.xmlid || "").trim().toLowerCase();
        return name === "rbac" || xmlid.includes("rbac");
    }

    hasMenuIconData(menu) {
        return Boolean(menu?.webIconData || menu?.web_icon_data);
    }

    getMenuIconDataSrc(menu) {
        const data = menu?.webIconData || menu?.web_icon_data;
        if (!data) {
            return "";
        }
        if (data.startsWith("data:image")) {
            return data;
        }
        const prefix = data.startsWith("P") ? "data:image/svg+xml;base64," : "data:image/png;base64,";
        return prefix + data.replace(/\s/g, "");
    }

    syncFromMenuService() {
        const currentApp = this.menuService.getCurrentApp();
        if (currentApp) {
            this.state.expandedAppId = currentApp.id;
            if (currentApp.children?.length) {
                this.state.panelOpen = true;
            }
        }
        const menuId = Number(router.current.menu_id || browser.sessionStorage.getItem("menu_id") || 0);
        let activeMenu = menuId ? this.menuService.getMenu(menuId) : null;
        if (!activeMenu) {
            const actionId = this.actionService.currentController?.action?.id;
            activeMenu = actionId ? this.findMenuByActionId(currentApp, actionId) : null;
        }
        if (activeMenu) {
            this.state.activeMenuId = activeMenu.id;
            const rootApp = this.findRootApp(activeMenu) || currentApp;
            if (rootApp) {
                this.state.expandedAppId = rootApp.id;
            }
            this.expandForActiveMenu(rootApp || currentApp, activeMenu.id);
        } else {
            this.state.activeMenuId = currentApp?.id || null;
        }
        this.syncPanelBodyClass();
    }

    isActiveApp(app) {
        const currentApp = this.menuService.getCurrentApp();
        return currentApp?.id === app.id;
    }

    isActiveMenu(menu) {
        if (this.state.activeMenuId === menu.id) {
            return true;
        }
        return this.getMenuChildren(menu).some((child) => this.isActiveMenu(child));
    }

    async selectApp(app) {
        this.state.expandedAppId = app.id;
        this.state.activeMenuId = null;
        this.state.expandedSections = {};
        if (app.children?.length) {
            this.state.panelOpen = true;
            this.syncPanelBodyClass();
            return;
        }
        this.state.panelOpen = Boolean(app.children?.length);
        this.syncPanelBodyClass();
        if (app.actionID) {
            this.state.activeMenuId = app.id;
            await this.menuService.selectMenu(app);
        }
    }

    openNavigation({appId, menuId}) {
        const menu = menuId ? this.menuService.getMenu(menuId) : null;
        const app = (
            appId ? this.apps.find((item) => item.id === appId) : null
        ) || this.findRootApp(menu) || menu || this.apps[0];
        if (!app) {
            return;
        }
        this.state.expandedAppId = app.id;
        this.state.panelOpen = Boolean(app.children?.length);
        this.state.activeMenuId = menu?.id || null;
        this.state.expandedSections = {};
        if (menu) {
            this.expandForActiveMenu(app, menu.id);
        }
        this.syncPanelBodyClass();
    }

    async selectMenu(menu) {
        if (menu.actionID) {
            this.state.activeMenuId = menu.id;
            await this.menuService.selectMenu(menu);
            return;
        }
        if (menu.children?.length) {
            this.toggleSection(menu.id);
        }
    }

    togglePanel() {
        this.state.panelOpen = !this.state.panelOpen;
    }

    syncPanelBodyClass() {
        // The global sidebar now lives inside the Odoo action area. Keep this
        // hook for older callers without toggling full-shell body classes.
    }

    toggleSection(sectionId) {
        this.state.expandedSections = {
            ...this.state.expandedSections,
            [sectionId]: !this.state.expandedSections[sectionId],
        };
    }

    isSectionExpanded(sectionId) {
        return Boolean(this.state.expandedSections[sectionId]);
    }

    getPanelSections() {
        const app = this.activeApp;
        if (!app) {
            return [];
        }
        const sections = this.getMenuChildren(app);
        const appName = String(app.name || "").trim().toLowerCase();
        return sections.flatMap((section) => {
            const sectionName = String(section.name || "").trim().toLowerCase();
            if (sectionName === appName && section.children?.length) {
                return this.getMenuChildren(section);
            }
            return [section];
        });
    }

    getRbacSidebarGroups() {
        const items = this.activeAppChildren;
        const groups = [
            {label: "Overview", keys: ["dashboard"], items: []},
            {label: "People", keys: ["users", "roles"], items: []},
            {label: "Policy", keys: ["policy"], items: []},
            {label: "System", keys: ["settings"], items: []},
        ];
        const byLabel = Object.fromEntries(groups.map((group) => [group.label, group]));
        const hiddenNames = new Set(["user permissions", "super admin view", "audit"]);
        const hiddenXmlids = ["menu_user_permissions", "menu_super_admin", "menu_audit_parent", "menu_rbac_audit", "menu_rbac_line_audit"];

        for (const item of items) {
            const name = String(item.name || "").trim().toLowerCase();
            const xmlid = String(item.xmlid || "").trim().toLowerCase();
            if (hiddenNames.has(name) || hiddenXmlids.some((x) => xmlid.includes(x))) {
                continue;
            }
            if (name === "dashboard" || xmlid.includes("menu_dashboard")) {
                byLabel.Overview.items.push(item);
            } else if (name === "users" || xmlid.includes("menu_users_directory")) {
                byLabel.People.items.push(item);
            } else if (name === "user roles" || name === "roles" || xmlid.includes("menu_user_roles")) {
                byLabel.People.items.push(item);
            } else if (name === "settings" || xmlid.includes("rbac_settings") || xmlid.includes("menu_rbac_settings")) {
                byLabel.System.items.push(item);
            } else {
                byLabel.Policy.items.push(item);
            }
        }
        return groups.filter((group) => group.items.length);
    }

    getMenuChildren(menu) {
        return (menu?.children || [])
            .map((id) => this.menuService.getMenu(id))
            .filter(Boolean);
    }

    shouldFlattenSection(section) {
        const app = this.activeApp;
        if (!app || !section) {
            return false;
        }
        if (section.xmlid === "base.menu_apps") {
            return true;
        }
        return (
            String(section.name || "").trim().toLowerCase() ===
                String(app.name || "").trim().toLowerCase() &&
            Boolean(section.children?.length)
        );
    }

    isLeafMenu(menu) {
        return !menu.children?.length || Boolean(menu.actionID);
    }

    findMenuByActionId(menu, actionId) {
        if (!menu || !actionId) {
            return null;
        }
        if (String(menu.actionID) === String(actionId)) {
            return menu;
        }
        for (const child of this.getMenuChildren(menu)) {
            const found = this.findMenuByActionId(child, actionId);
            if (found) {
                return found;
            }
        }
        return null;
    }

    findRootApp(menu) {
        if (!menu) {
            return null;
        }
        for (const app of this.apps) {
            if (app.id === menu.id || this.menuContains(app, menu.id)) {
                return app;
            }
        }
        return null;
    }

    menuContains(menu, targetId) {
        for (const child of this.getMenuChildren(menu)) {
            if (child.id === targetId || this.menuContains(child, targetId)) {
                return true;
            }
        }
        return false;
    }

    findSectionAncestors(menu, targetId, sectionPath = []) {
        for (const child of this.getMenuChildren(menu)) {
            if (child.id === targetId) {
                return sectionPath;
            }
            const childIsSection = Boolean(child.children?.length);
            const result = this.findSectionAncestors(
                child,
                targetId,
                childIsSection ? [...sectionPath, child.id] : sectionPath
            );
            if (result !== null) {
                return result;
            }
        }
        return null;
    }

    expandForActiveMenu(app, menuId) {
        if (!app || !menuId) {
            return;
        }
        const ancestors = this.findSectionAncestors(app, menuId);
        if (ancestors?.length) {
            const expanded = {};
            for (const id of ancestors) {
                expanded[id] = true;
            }
            this.state.expandedSections = expanded;
        }
    }
}

export class RBACGlobalTopbar extends Component {
    static template = "rbac.GlobalTopbar";
    static components = {UserMenu};

    setup() {
        this.menuService = useService("menu");
        this.actionService = useService("action");
        this.state = useState({
            query: "",
            open: false,
            companyOpen: false,
            activeIndex: 0,
            activeMenuId: null,
        });
        this._onMenuChange = () => this.syncCurrentMenu();
        this._onRouteChange = () => this.syncCurrentMenu();
        this._onDocumentClick = () => this.closeFloatingMenus();
        onMounted(() => {
            this.env.bus.addEventListener("MENUS:APP-CHANGED", this._onMenuChange);
            this.env.bus.addEventListener("ROUTE_CHANGE", this._onRouteChange);
            document.addEventListener("click", this._onDocumentClick);
            this.syncCurrentMenu();
        });
        onWillUnmount(() => {
            this.env.bus.removeEventListener("MENUS:APP-CHANGED", this._onMenuChange);
            this.env.bus.removeEventListener("ROUTE_CHANGE", this._onRouteChange);
            document.removeEventListener("click", this._onDocumentClick);
        });
    }

    get apps() {
        return this.menuService.getApps().filter(visibleRootApp);
    }

    get currentAppName() {
        return this.currentMenuPath[0]?.name || this.menuService.getCurrentApp()?.name || "Odoo";
    }

    get currentPageName() {
        const path = this.currentMenuPath;
        return path.length > 1 ? path.slice(1).map((item) => item.name).join(" / ") : this.currentAppName;
    }

    get currentMenuPath() {
        const menu = this.getCurrentMenu();
        if (!menu) {
            const currentApp = this.menuService.getCurrentApp();
            return currentApp ? [currentApp] : [];
        }
        return this.findMenuPath(menu.id) || [menu];
    }

    get userInitials() {
        return getInitials(user.name);
    }

    get userName() {
        return user.name || "";
    }

    get dbName() {
        return session.db || "";
    }

    get isDebugMode() {
        return Boolean(this.env.debug);
    }

    get allowedCompanies() {
        return (user.allowedCompanies || []).slice().sort((a, b) => {
            const sequenceDiff = (a.sequence || 0) - (b.sequence || 0);
            return sequenceDiff || String(a.name || "").localeCompare(String(b.name || ""));
        });
    }

    get activeCompany() {
        return user.activeCompany || user.activeCompanies?.[0] || this.allowedCompanies[0] || null;
    }

    get activeCompanyName() {
        return this.activeCompany?.name || "";
    }

    get hasMultipleCompanies() {
        return this.allowedCompanies.length > 1;
    }

    get searchResults() {
        const q = this.state.query.trim().toLowerCase();
        if (!q) {
            return [];
        }
        const results = [];
        const menus = this.collectAllMenus();
        const resultKeys = new Set();

        for (const app of this.apps) {
            if (String(app.name || "").toLowerCase().includes(q)) {
                resultKeys.add(`menu:${app.id}`);
                results.push({
                    type: "app",
                    title: app.name,
                    sub: "Application",
                    item: app,
                });
            }
            if (results.length >= 12) {
                return results;
            }
        }

        for (const menu of menus) {
            const key = `menu:${menu.id}`;
            if (resultKeys.has(key)) {
                continue;
            }
            const haystack = [
                menu.name,
                menu.path.join(" "),
                menu.actionModel,
                menu.actionPath,
            ].filter(Boolean).join(" ").toLowerCase();
            if (haystack.includes(q)) {
                resultKeys.add(key);
                results.push({
                    type: menu.children?.length ? "menu" : "action",
                    title: menu.name,
                    sub: menu.path.join(" / "),
                    item: menu,
                });
            }
            if (results.length >= 12) {
                return results;
            }
        }
        return results;
    }

    onSearchInput(ev) {
        this.state.query = ev.target.value;
        this.state.open = Boolean(this.state.query.trim());
        this.state.activeIndex = 0;
    }

    openSearch() {
        this.state.open = Boolean(this.state.query.trim());
    }

    onSearchKeydown(ev) {
        const results = this.searchResults;
        if (ev.key === "Escape") {
            ev.preventDefault();
            this.closeSearch();
        } else if (ev.key === "ArrowDown") {
            ev.preventDefault();
            this.state.activeIndex = Math.min(this.state.activeIndex + 1, Math.max(results.length - 1, 0));
        } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            this.state.activeIndex = Math.max(this.state.activeIndex - 1, 0);
        } else if (ev.key === "Enter") {
            ev.preventDefault();
            const result = results[this.state.activeIndex] || results[0];
            if (result) {
                this.selectSearchResult(result);
            }
        }
    }

    closeSearch() {
        this.state.open = false;
    }

    closeFloatingMenus() {
        this.state.open = false;
        this.state.companyOpen = false;
    }

    toggleCompanySelector() {
        if (!this.hasMultipleCompanies) {
            return;
        }
        this.state.companyOpen = !this.state.companyOpen;
        this.state.open = false;
    }

    isActiveCompany(company) {
        return this.activeCompany?.id === company?.id;
    }

    async switchCompany(company) {
        if (!company || this.isActiveCompany(company)) {
            this.state.companyOpen = false;
            return;
        }
        this.state.companyOpen = false;
        browser.localStorage.removeItem("webclient_menus");
        browser.localStorage.removeItem("webclient_menus_version");
        browser.localStorage.setItem("rbac_webclient_menus_company_key", String(company.id));
        await user.activateCompanies([company.id], {
            includeChildCompanies: false,
            reload: true,
        });
    }

    syncCurrentMenu() {
        const menu = this.getCurrentMenu();
        this.state.activeMenuId = menu?.id || null;
    }

    async selectSearchResult(result) {
        this.state.query = "";
        this.state.open = false;
        this.state.activeIndex = 0;
        const item = result.item;
        if (!item) {
            return;
        }
        const rootApp = this.findRootApp(item) || (result.type === "app" ? item : null);
        this.openNavigation(rootApp?.id, item.id);
        this.state.activeMenuId = item.id;
        if ((result.type === "app" || result.type === "menu") && item.children?.length && !item.actionID) {
            return;
        }
        await this.menuService.selectMenu(item);
        this.syncCurrentMenu();
    }

    onBreadcrumbClick(crumb, isLast) {
        if (!crumb) {
            return;
        }
        const rootApp = this.findRootApp(crumb) || crumb;
        this.openNavigation(rootApp?.id, crumb.id);
        this.state.activeMenuId = crumb.id;
        if (!isLast && crumb.actionID) {
            this.menuService.selectMenu(crumb);
        }
    }

    openNavigation(appId, menuId = null) {
        window.dispatchEvent(new CustomEvent("RBAC:OPEN-NAVIGATION", {
            detail: {appId, menuId},
        }));
    }

    getCurrentMenu() {
        const routeMenuId = router.current.menu_id || browser.sessionStorage.getItem("menu_id");
        const menuId = Number(routeMenuId || this.state.activeMenuId || 0);
        let menu = menuId ? this.menuService.getMenu(menuId) : null;
        if (!menu) {
            const actionId = this.actionService.currentController?.action?.id || router.current.action;
            menu = actionId ? this.findMenuByActionId(actionId) : null;
        }
        return menu;
    }

    collectAllMenus() {
        const items = [];
        const seen = new Set();
        for (const app of this.apps) {
            this.walkMenu(app, [app.name], items, seen, true);
        }
        return items;
    }

    walkMenu(node, path, out, seen, skipRoot = false) {
        if (!skipRoot && !seen.has(node.id)) {
            seen.add(node.id);
            out.push({
                ...node,
                path,
                actionModel: node.actionModel,
                actionPath: node.actionPath,
            });
        }
        const children = (node.children || [])
            .map((id) => this.menuService.getMenu(id))
            .filter(Boolean);
        for (const child of children) {
            this.walkMenu(child, [...path, child.name], out, seen);
        }
    }

    findMenuPath(targetId) {
        for (const app of this.apps) {
            const path = this.findMenuPathFrom(app, targetId, [app]);
            if (path) {
                return path;
            }
        }
        return null;
    }

    findRootApp(item) {
        if (!item) {
            return null;
        }
        for (const app of this.apps) {
            if (app.id === item.id || this.menuContains(app, item.id)) {
                return app;
            }
        }
        return null;
    }

    menuContains(menu, targetId) {
        for (const childId of menu.children || []) {
            const child = this.menuService.getMenu(childId);
            if (!child) {
                continue;
            }
            if (child.id === targetId || this.menuContains(child, targetId)) {
                return true;
            }
        }
        return false;
    }

    findMenuPathFrom(menu, targetId, path) {
        if (menu.id === targetId) {
            return path;
        }
        for (const childId of menu.children || []) {
            const child = this.menuService.getMenu(childId);
            if (!child) {
                continue;
            }
            const found = this.findMenuPathFrom(child, targetId, [...path, child]);
            if (found) {
                return found;
            }
        }
        return null;
    }

    findMenuByActionId(actionId) {
        for (const menu of this.collectAllMenus()) {
            if (String(menu.actionID) === String(actionId)) {
                return menu;
            }
        }
        return null;
    }
}

WebClient.components = {
    ...WebClient.components,
    RBACGlobalSidebar,
    RBACGlobalTopbar,
};
