/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACRevokeAllPermissions extends ConfirmationDialog {
    static template = "rbac.revokeAllPermissions";
    static props = {
        ...ConfirmationDialog.props,
        total_granted: { type: Number},
        custom_permissions: { type: Number},
        assigned_roles: { type: Object},
        user_name: { type: String},
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

export class RBACGrantAllPermissions extends ConfirmationDialog {
    static template = "rbac.grantAllPermissions";
    static props = {
        ...ConfirmationDialog.props,
        user_type: { type: String},
        user_name: { type: String},
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
