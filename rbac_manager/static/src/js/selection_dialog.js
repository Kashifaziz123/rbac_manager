/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACUserSelectionDialog extends ConfirmationDialog {
    static template = "rbac.UserSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        users: {type: Array, optional: false},
    };
}

export class RBACRoleSelectionDialog extends ConfirmationDialog {
    static template = "rbac.RoleSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        roles: {type: Array, optional: false},
    };
}
