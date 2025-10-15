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
        this.data = useState({});

        onWillStart(async () => {
            await this.fetch_data();
            await ensureJQuery();
        });

    }

    //
    //  model CRUD functions
    //
    async fetch_data() {
        this.data = await this.orm.call("rbac.model", "get_initial_rbac_audit", []);

        if (this.data.error) {
            var message = _t("It seems the logs view has errors.")
            this.notification.add(message, {sticky: true, type: "danger"});
            this.action.doAction('rbac_manager.act_window_res_users_list_super_admin', {clearBreadcrumbs: true});
        }
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

}

registry.category("actions").add("rbac.audit", RBACAudit);
