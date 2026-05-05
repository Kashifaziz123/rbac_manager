/* @odoo-module */

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {_t} from "@web/core/l10n/translation";
import {registry} from "@web/core/registry";

export class RBACSettings extends Component {
    static template = "rbac.Settings";

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            loading: true,
            saving: false,
            values: {
                default_approval_timeout: "48",
                auto_expire_temporary_extras: true,
                timeout_options: [],
            },
        });
        onWillStart(async () => this.loadData());
    }

    async loadData() {
        this.state.loading = true;
        try {
            this.state.values = await this.orm.call("rbac.model", "get_rbac_settings", [], {});
        } finally {
            this.state.loading = false;
        }
    }

    async save(values = {}) {
        this.state.saving = true;
        try {
            this.state.values = await this.orm.call("rbac.model", "set_rbac_settings", [], {
                values: {
                    default_approval_timeout: this.state.values.default_approval_timeout,
                    auto_expire_temporary_extras: this.state.values.auto_expire_temporary_extras,
                    ...values,
                },
            });
            this.notification.add(_t("Settings saved."), {type: "success"});
        } finally {
            this.state.saving = false;
        }
    }

    async onTimeoutChange(ev) {
        this.state.values.default_approval_timeout = ev.target.value;
        await this.save({default_approval_timeout: ev.target.value});
    }

    async toggleAutoExpire() {
        const value = !this.state.values.auto_expire_temporary_extras;
        this.state.values.auto_expire_temporary_extras = value;
        await this.save({auto_expire_temporary_extras: value});
    }
}

registry.category("actions").add("rbac.settings", RBACSettings);
