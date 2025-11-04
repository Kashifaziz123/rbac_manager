/* @odoo-module */

import {Component, markup, onMounted, onWillStart, useEffect, useRef, useState} from "@odoo/owl";
import {ensureJQuery} from '@web/core/ensure_jquery';
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

export class RBACAudit extends Component {
    static template = "rbac.Audit";

    setup() {
        super.setup();
        this.notification = useService("notification");
        this.dialogService = useService("dialog");
        this.action = useService("action");
        this.orm = useService("orm");
        this.user = [];
        this.searchQuery = useState({ value: "" });
        this.filters = useState({
            user_id: "",
            admin_id: "",
            action: "",
            from: "",
            to: ""
        });
        this.data = useState({});
        const today = new Date();
        const firstDayLocal = new Date(today.getFullYear(), today.getMonth(), 1);
        const firstDay = firstDayLocal.toLocaleDateString('en-CA');
        const todayStr = today.toISOString().split('T')[0];
        this.from_date = useState({ value: firstDay });
        this.to_date = useState({ value: todayStr });
        onWillStart(async () => {
            await this.fetch_data();
            this.filters.from = this.from_date.value;
            this.filters.to = this.to_date.value;
            await this.applyFilters();
            await ensureJQuery();
        });
    }
    async fetch_data() {
        this.data = await this.orm.call("rbac.model", "get_initial_rbac_audit", []);
        if (this.data.error) {
            var message = _t("It seems the logs view has errors.")
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_super_admin', {clearBreadcrumbs: true});
        }
    }
    debounceTimer = null;
    async onSearchChange(ev) {
    clearTimeout(this.debounceTimer);
    const query = ev.target.value.trim().toLowerCase();
    this.debounceTimer = setTimeout(async () => {
        this.searchQuery.value = query;
        await this.applyFilters();
    }, 300);
}
    onDateChange() {
    const from = new Date(this.from_date.value);
    const to = new Date(this.to_date.value);

    if (to < from) {
        this.notification.add("⚠️ 'Date To' cannot be earlier than 'Date From'.", { type: "danger" });
        this.to_date.value = this.from_date.value;
        return;
    }

    this.filters.from = this.from_date.value;
    this.filters.to = this.to_date.value;
    this.applyFilters();
}
    async applyFilters() {
    await this.fetch_data();

    let logs = this.data.logs;

    // Target User
    if (this.filters.user_id) {
        const uid = parseInt(this.filters.user_id);
        logs = logs.filter(l => l.user_uid[2] === uid);
    }

    // Performed By (Admin)
    if (this.filters.admin_id) {
        const aid = parseInt(this.filters.admin_id);
        logs = logs.filter(l => l.create_uid[2] === aid);
    }

    // Action Type
    if (this.filters.action) {
        logs = logs.filter(l => l.action === this.filters.action);
    }

    // Date Range
    if (this.filters.from && this.filters.to) {
        const fromDate = new Date(this.filters.from);
        const toDate = new Date(this.filters.to);
        logs = logs.filter(l => {
            const logDate = new Date(l.create_date[0]);
            return logDate >= fromDate && logDate <= toDate;
        });
    }

    // 🔍 Search filter
    if (this.searchQuery.value) {
    const query = this.searchQuery.value;
    logs = logs.filter(l =>
    (l.user_uid[0] && l.user_uid[0].toLowerCase().includes(query)) ||
    (l.method && l.method.toLowerCase().includes(query))
    );

}

    this.data.logs = logs;
    this.render();
}
    async onExport(format) {
    const params = new URLSearchParams({
        format,
        user_id: this.filters.user_id || '',
        admin_id: this.filters.admin_id || '',
        from: this.filters.from || '',
        to: this.filters.to || '',
        search: this.searchQuery.value || '',
    }).toString();

    window.open(`/rbac/audit/export?${params}`, '_blank');
}

    getInitials(text) {
    if (!text || typeof text !== "string") {
        return "--"; // default placeholder if name not yet loaded
    }
    const words = text.trim().split(/\s+/);
    return words.length > 1
        ? (words[0][0] + words[1][0]).toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
}
    async onAdminFilterChange(ev) {
    this.filters.admin_id = ev.target.value;
    await this.applyFilters();
}
    async onUserFilterChange(ev) {
        this.filters.user_id = ev.target.value;
        await this.applyFilters();
    }
    async onActionFilterChange(ev) {
        this.filters.action = ev.target.value;
        await this.applyFilters();
    }
    open_details(ev) {
        let data_json = JSON.parse($(ev.srcElement).attr('data-json'))
        const modal = $('.rbac_audit').find('#detailModal');
        const modalContent = $('.rbac_audit').find('#modalContent');

        // Different content based on action type
        let content = '';

        content = `
                    <div class="detail-section">
                        <div class="detail-section-title">Action Information</div>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <div class="detail-label">Action Type</div>
                                <div class="detail-value"><span class="action-badge">${data_json['method']}</span></div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Timestamp</div>
                                <div class="detail-value">${data_json['create_date'][0]} at ${data_json['create_date'][1]}</div>
                            </div>
                        </div>
                    </div>

                    <div class="detail-section">
                        <div class="detail-section-title">Performed By (Administrator)</div>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <div class="detail-label">Name</div>
                                <div class="detail-value highlight">${data_json['create_uid'][0]}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Email</div>
                                <div class="detail-value">${data_json['create_uid'][1]}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">IP Address</div>
                                <div class="detail-value">${data_json['ip_address']}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Location</div>
                                <div class="detail-value">${data_json['location']}</div>
                            </div>
                            <div class="detail-item full-width">
                                <div class="detail-label">User Agent</div>
                                <div class="detail-value">${data_json['user_agent']}</div>
                            </div>
                        </div>
                    </div>

                    <div class="detail-section">
                        <div class="detail-section-title">Target User (Affected)</div>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <div class="detail-label">Name</div>
                                <div class="detail-value highlight">${data_json['create_uid'][0]}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Email</div>
                                <div class="detail-value">${data_json['create_uid'][1]}</div>
                            </div>
                        </div>
                    </div>`

        function state_comparison(name, data) {
            let changes = ''
            changes += '<div class="state-comparison"><div class="state-box before"><div class="state-title">Before</div>'
            changes += `<div class="state-content"><strong>${name}:</strong><br>`
            for (let x of JSON.parse(data['old_value'].replace(/'/g, '"'))) {
                changes += '• ' + x.name + '</br>';
            }
            changes += '</div></div><div class="arrow">→</div>'
            changes += '<div class="state-box after"><div class="state-title">After</div>'
            changes += `<div class="state-content"><strong>${name}:</strong><br>`
            for (let x of JSON.parse(data['new_value'].replace(/'/g, '"'))) {
                changes += '• ' + x.name + '</br>';
            }
            changes += '</div></div></div>'
            return changes
        }

        let changes_content = ''
        for (let data of data_json['line_ids']) {
            if (data['field_name'] == 'role_user_ids') {
                changes_content += state_comparison('Roles', data);
            } else if (data['field_name'] == 'direct_group_additions') {
                changes_content += state_comparison('Direct Assignment', data);
            } else if (data['field_name'] == 'direct_group_exclusions') {
                changes_content += state_comparison('Direct Exclusion', data);
            }
        }

        content += `
                    <div class="detail-section">
                        <div class="detail-section-title">Permission Changes</div>
                        ${changes_content}
                    </div>

                    <div class="detail-section">
                        <div class="detail-section-title">Impact Analysis</div>
                        <div class="detail-grid">
                            <div class="detail-item">
                                <div class="detail-label">Remaining Permissions</div>
                                <div class="detail-value">${data_json['len_groups_id'] == 'N/A' ? 'no changes': data_json['len_groups_id'] + ' permissions'}</div>
                            </div>`

        const groups_id = data_json.line_ids
            .filter(c => c.field_name === 'groups_id')
            .filter((item, index, self) =>
                index === self.findIndex(t => JSON.stringify(t) === JSON.stringify(item))
            );
        if (groups_id.length) {
            const permissions = {
                field_name: 'groups_id',
                old_value: JSON.parse(groups_id[0]['old_value'].replace(/'/g, '"')),
                new_value: JSON.parse(groups_id[groups_id.length - 1]['new_value'].replace(/'/g, '"')),
            };

            const aIds = new Set(permissions['old_value'].map(item => item.id));
            const bIds = new Set(permissions['new_value'].map(item => item.id));

            const newInB = permissions['new_value'].filter(item => !aIds.has(item.id));
            const missingInB = permissions['old_value'].filter(item => !bIds.has(item.id));

            if (newInB.length > 0) {
                content += `<div class="detail-item full-width">
                                <div class="detail-label">New Permissions Added</div>
                                <div class="permission-list added">
                                    <ul>`
                for (let newinb of newInB) {
                    content += `<li>${newinb['name']}</li>`
                }
                content += `      </ul>
                                </div>
                             </div>`
            }
            if (missingInB.length > 0) {
                content += `<div class="detail-item full-width">
                                <div class="detail-label">Permissions Removed</div>
                                <div class="permission-list removed">
                                    <ul>`
                for (let missingInb of missingInB) {
                    content += `<li>${missingInb['name']}</li>`
                }
                content += `      </ul>
                                </div>
                             </div>`
            }
        }
        content += `
                        </div>
                    </div>`;

        modalContent.html(content + `
                <div class="modal-footer">
                    <div>
                        <span class="info-badge">🔒 Logged and immutable</span>
                    </div>
                    <div class="action-buttons">
                        <button class="btn btn-secondary" onclick="$('.rbac_audit').find('#detailModal').removeClass('active');">Close</button>
                    </div>
                </div>`);
        const htmlContent = `
    <button class="btn btn-secondary" onclick="$('.rbac_audit').find('#detailModal').removeClass('active');">Close</button>
`;

        modal.addClass('active');
    }

    closeModal() {
        $('.rbac_audit').find('#detailModal').removeClass('active');
    }

    closeModalOnOverlay(event) {
        if (event.target.id === 'detailModal') {
            this.closeModal();
        }
    }

}

registry.category("actions").add("rbac.audit", RBACAudit);
