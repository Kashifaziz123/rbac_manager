/* @odoo-module */

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

const CATEGORY_CLASSES = {
    request: "request",
    permission: "permission",
    role: "role",
    rule: "rule",
};

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function parseDate(date, time = "00:00:00") {
    return new Date(`${date}T${time}`);
}

function parseLogDate(log) {
    if (log?.create_datetime_utc) {
        return new Date(`${String(log.create_datetime_utc).replace(" ", "T")}Z`);
    }
    return parseDate(log?.create_date?.[0], log?.create_date?.[1]);
}

export class RBACAudit extends Component {
    static template = "rbac.Audit";

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            loading: true,
            logs: [],
            users: [],
            admins: [],
            actions: [],
            query: "",
            category: "",
            adminId: "",
            range: "90",
            activeLog: null,
        });
        onWillStart(async () => this.loadData());
    }

    async loadData() {
        this.state.loading = true;
        try {
            const data = await this.orm.call("rbac.model", "get_initial_rbac_audit", []);
            if (data.error) {
                this.notification.add(_t("Audit logs could not be loaded."), {type: "danger"});
                return;
            }
            this.state.logs = data.logs || [];
            this.state.users = data.users || [];
            this.state.admins = data.admins || [];
            this.state.actions = data.actions_list || [];
        } finally {
            this.state.loading = false;
        }
    }

    get filteredLogs() {
        const query = this.state.query.trim().toLowerCase();
        const adminId = Number(this.state.adminId || 0);
        const now = new Date();
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - Number(this.state.range || 90));

        return this.state.logs.filter((log) => {
            const category = this.getCategory(log);
            const logDate = parseLogDate(log);
            const text = [
                log.method,
                log.action,
                log.create_uid?.[0],
                log.create_uid?.[1],
                log.user_uid?.[0],
                log.user_uid?.[1],
                log.ip_address,
            ].join(" ").toLowerCase();
            return (
                (!query || text.includes(query)) &&
                (!this.state.category || category === this.state.category) &&
                (!adminId || log.create_uid?.[2] === adminId) &&
                (!this.state.range || logDate >= cutoff)
            );
        });
    }

    get categories() {
        const categories = [...new Set(this.state.logs.map((log) => this.getCategory(log)))];
        return categories.sort();
    }

    initials(name) {
        return initials(name);
    }

    displayDate(log) {
        const dt = parseLogDate(log);
        if (Number.isNaN(dt.getTime())) return log.create_date?.[0] || "";
        return dt.toLocaleDateString(undefined, {year: "numeric", month: "2-digit", day: "2-digit"});
    }

    displayTime(log) {
        const dt = parseLogDate(log);
        if (Number.isNaN(dt.getTime())) return log.create_date?.[1] || "";
        return dt.toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
    }

    onSearch(ev) {
        this.state.query = ev.target.value || "";
    }

    onCategory(ev) {
        this.state.category = ev.target.value || "";
    }

    onAdmin(ev) {
        this.state.adminId = ev.target.value || "";
    }

    onRange(ev) {
        this.state.range = ev.target.value || "";
    }

    getCategory(log) {
        const action = String(log.action || log.method || "").toLowerCase();
        if (action.includes("request")) return "request";
        if (action.includes("role")) return "role";
        if (action.includes("rule")) return "rule";
        return "permission";
    }

    categoryLabel(log) {
        return this.getCategory(log).toUpperCase();
    }

    categoryClass(log) {
        return CATEGORY_CLASSES[this.getCategory(log)] || "permission";
    }

    eventDotClass(log) {
        const action = String(log.action || "").toLowerCase();
        if (action.includes("remove") || action.includes("revoke") || action.includes("deny")) return "removed";
        if (action.includes("role")) return "role";
        if (action.includes("add") || action.includes("grant") || action.includes("initialize")) return "added";
        return "modified";
    }

    eventTitle(log) {
        const target = log.user_uid?.[0] || "";
        return target ? `${log.method || log.action || "Audit event"} -> ${target}` : (log.method || log.action || "Audit event");
    }

    eventDescription(log) {
        const lines = this.getLines(log);
        if (!lines.length) {
            return "No field-level changes recorded.";
        }
        const names = lines.map((line) => this.fieldLabel(line.field_name)).filter(Boolean);
        return `${names.join(", ")} changed.`;
    }

    fieldLabel(fieldName) {
        return {
            role_user_ids: "Roles",
            direct_group_additions: "+ Extra",
            direct_group_exclusions: "- Excluded",
            group_ids: "Permissions",
        }[fieldName] || fieldName || "Field";
    }

    getLines(log) {
        try {
            const data = typeof log.data_json === "string" ? JSON.parse(log.data_json) : log.data_json;
            return data?.line_ids || [];
        } catch {
            return [];
        }
    }

    openDetails(log) {
        this.state.activeLog = log;
    }

    closeDetails() {
        this.state.activeLog = null;
    }

    exportCSV() {
        const header = ["Date", "Time", "Event", "Performed By", "Target", "Category", "IP Address"];
        const rows = this.filteredLogs.map((log) => [
            log.create_date?.[0] || "",
            log.create_date?.[1] || "",
            log.method || "",
            log.create_uid?.[0] || "",
            log.user_uid?.[0] || "",
            this.categoryLabel(log),
            log.ip_address || "",
        ]);
        const escapeCell = (cell) => `"${String(cell).replace(/"/g, '""')}"`;
        const csv = [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
        const blob = new Blob([csv], {type: "text/csv;charset=utf-8;"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "rbac-audit-log.csv";
        link.click();
        URL.revokeObjectURL(url);
    }
}

registry.category("actions").add("rbac.audit", RBACAudit);
