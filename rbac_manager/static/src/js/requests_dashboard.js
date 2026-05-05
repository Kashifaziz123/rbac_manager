/* @odoo-module */

import {Component, onWillStart, useRef, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

const AVATAR_COLORS = ["#3a5bd9", "#7c3aed", "#16a34a", "#ea580c", "#0891b2", "#dc2626"];

function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

function avatarColor(seed) {
    let h = 0;
    for (const char of String(seed || "")) h = (h * 31 + char.charCodeAt(0)) & 0xfffffff;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export class RBACRequestsDashboard extends Component {
    static template = "rbac.RequestsDashboard";

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.userRef = useRef("requestUser");
        this.categoryRef = useRef("requestCategory");
        this.groupRef = useRef("requestGroup");
        this.durationRef = useRef("requestDuration");
        this.durationValueRef = useRef("requestDurationValue");
        this.durationUnitRef = useRef("requestDurationUnit");
        this.descRef = useRef("requestReason");

        this.state = useState({
            loading: true,
            saving: false,
            tab: "pending",
            requests: [],
            counts: {pending: 0, approved: 0, denied: 0},
            users: [],
            groups: [],
            modalOpen: false,
            requestType: "grant",
            requestCategory: "",
            durationType: "permanent",
        });

        onWillStart(async () => this.loadData());
    }

    async loadData() {
        this.state.loading = true;
        try {
            const data = await this.orm.call("request.rbac.permission", "get_requests_dashboard", [], {});
            this.state.requests = data.requests || [];
            this.state.counts = data.counts || {pending: 0, approved: 0, denied: 0};
            this.state.users = data.users || [];
            this.state.groups = data.groups || [];
        } finally {
            this.state.loading = false;
        }
    }

    get filteredRequests() {
        return this.state.requests.filter((request) => request.state === this.state.tab);
    }

    get categories() {
        return [...new Set((this.state.groups || []).map((group) => group.category || "Other"))].sort();
    }

    get modalGroups() {
        if (!this.state.requestCategory) {
            return this.state.groups;
        }
        return this.state.groups.filter((group) => group.category === this.state.requestCategory);
    }

    markInvalid(el) {
        if (!el) return;
        el.classList.add('rq_input_error');
        el.scrollIntoView({behavior: 'smooth', block: 'center'});
        el.focus();
        const clear = () => {
            el.classList.remove('rq_input_error');
            el.removeEventListener('input', clear);
            el.removeEventListener('change', clear);
        };
        el.addEventListener('input', clear);
        el.addEventListener('change', clear);
    }

    setTab(tab) {
        this.state.tab = tab;
    }

    initials(name) {
        return initials(name);
    }

    avatarStyle(request) {
        return `background:${avatarColor(request.user_name)};`;
    }

    requestTypeLabel(type) {
        return type === "deny" ? "Remove Exclusion" : "+ Extra";
    }

    openModal() {
        this.state.requestType = "grant";
        this.state.requestCategory = "";
        this.state.durationType = "permanent";
        this.state.modalOpen = true;
    }

    closeModal() {
        this.state.modalOpen = false;
    }

    setRequestType(type) {
        this.state.requestType = type;
    }

    onCategoryChange(ev) {
        this.state.requestCategory = ev.target.value;
    }

    onDurationTypeChange(ev) {
        this.state.durationType = ev.target.value;
    }

    async approveRequest(request) {
        await this.orm.call("request.rbac.permission", "state_approved", [[request.id]], {});
        this.notification.add(_t("Request approved."), {type: "success"});
        await this.loadData();
    }

    async denyRequest(request) {
        await this.orm.call("request.rbac.permission", "state_denied", [[request.id]], {});
        this.notification.add(_t("Request denied."), {type: "warning"});
        await this.loadData();
    }

    async submitRequest() {
        const userId = Number(this.userRef.el?.value || 0);
        const groupId = Number(this.groupRef.el?.value || 0);
        const category = this.categoryRef.el?.value || "";
        const reason = (this.descRef.el?.value || "").trim();

        if (!userId) { this.markInvalid(this.userRef.el); return; }
        if (!category) { this.markInvalid(this.categoryRef.el); return; }
        if (!groupId) { this.markInvalid(this.groupRef.el); return; }
        if (!reason) { this.markInvalid(this.descRef.el); return; }

        const duration = this.durationRef.el?.value || "permanent";
        const durationValue = this.durationValueRef.el?.value || "";
        const durationUnit = this.durationUnitRef.el?.value || "";
        const durationLabel = duration === "temporary"
            ? `Temporary: ${durationValue || 1} ${durationUnit || "days"}`
            : "Permanent";
        const description = [
            reason,
            `Duration: ${durationLabel}`,
        ].filter(Boolean).join("\n");
        this.state.saving = true;
        try {
            const result = await this.orm.call("request.rbac.permission", "create_request_from_dashboard", [], {
                values: {
                    user_id: userId,
                    group_id: groupId,
                    type: this.state.requestType,
                    description,
                },
            });
            if (result.error) {
                this.notification.add(result.message || _t("Unable to submit request."), {type: "danger"});
                return;
            }
            this.notification.add(result.message || _t("Request submitted."), {type: "success"});
            this.closeModal();
            await this.loadData();
            this.state.tab = "pending";
        } finally {
            this.state.saving = false;
        }
    }
}

registry.category("actions").add("rbac.requests_dashboard", RBACRequestsDashboard);
