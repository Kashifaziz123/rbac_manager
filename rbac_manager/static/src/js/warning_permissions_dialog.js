/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACRevokeAllPermissions extends ConfirmationDialog {
    static template = "rbac.revokeAllPermissions";
    static props = {
        ...ConfirmationDialog.props,
        total_granted: { type: Number},
        custom_permissions: { type: Number},
        assigned_roles: { type: Object},
    };
    setup() {
        super.setup();
        this.accepted = 0;
    }
    accept_toggle(){
        this.accepted = !this.accepted;
        this.render();
    }
}
