/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACUserSelectionDialog extends ConfirmationDialog {
    static template = "rbac.UserSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        clone_users: {type: Array, optional: false},
    };

    setup() {
        super.setup();
        this.clone_users = this.props.clone_users;
        this.selectedUser = 0;
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

    apply_search() {
        let body = $('.rbac_dialog.user_selection_dialog');
        let search_val = body.find('.search-input').val().toLowerCase();
        this.clone_users = this.props.clone_users.filter(user =>
            user.name.toLowerCase().includes(search_val)
        );
        this.render();
    }

    user_selected(ev) {
        let user_item_div = $(ev.closest('.user-item'))
        this.selectedUser = user_item_div.attr('data-id');
        let categories = JSON.parse(user_item_div.attr('data-categories'))

        let body = $('.rbac_dialog.user_selection_dialog');
        body.find('.user-item').removeClass('selected')
        $(ev).addClass('selected');

        body.find('#rolesPreview')[0].innerHTML = categories
            .map(role => `<span class="role-tag">${role}</span>`).join('');

        this.render();
    }
}

export class RBACRoleSelectionDialog extends ConfirmationDialog {
    static template = "rbac.RoleSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        roles: {type: Array, optional: false},
    };
}
