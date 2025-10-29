/* @odoo-module */

import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";


export class RBACUserSelectionDialog extends ConfirmationDialog {
    static template = "rbac.UserSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        clone_users: {type: Array, optional: false},
         target_user: { type: Object, optional: false },
    };

    setup() {
        super.setup();
        this.clone_users = this.props.clone_users;
        this.selectedUser = 0;
        this.targetUser = this.props.target_user || { name: "Unknown User" };
    }

    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

apply_search() {
    const body = $('.rbac_dialog.user_selection_dialog');
    const search_val = (body.find('.search-input').val() || '').toLowerCase();

    // Filter the user list
    this.clone_users = this.props.clone_users.filter(user =>
        user.name.toLowerCase().includes(search_val)
    );

    // Re-render the user list
    this.render();

    // Show or hide "No results" message
    const $noResults = body.find('#noResults');
    const $rolesPreview = body.find('#rolesPreview');
    if (this.clone_users.length === 0 && search_val.trim() !== '') {
        $noResults.show();
        $rolesPreview.html('');
    } else {
        $noResults.hide();
    }
}

    user_selected(ev) {
        let user_item_div = $(ev.closest('.user-item'))
        this.selectedUser = user_item_div.attr('data-id');
        let categories = JSON.parse(user_item_div.attr('data-categories'))
        let body = $('.rbac_dialog.user_selection_dialog');
        body.find('.user-item').removeClass('selected')
        $(ev.closest('.user-item')).addClass('selected');
        const rolesHTML = categories.length
        ? categories.map(role => `
            <span class="preview-tag">
                ${role}
            </span>
        `).join('')
        : `<span class="preview-tag empty">No roles or permissions found</span>`;

    body.find('#rolesPreview')[0].innerHTML = `
        <div class="preview-tags">${rolesHTML}</div>
    `;

        this.render();
    }
}

export class RBACRoleSelectionDialog extends ConfirmationDialog {
    static template = "rbac.RoleSelectionDialog";
    static props = {
        ...ConfirmationDialog.props,
        roles: {type: Array, optional: false},
        target_user: { type: Object, optional: false },
    };

    setup() {
        super.setup();
        this.selectedRoles = [];
        this.roles = [];
        this.props.roles.forEach(item => {
            this.roles[item.id] = item.name;
        });
        this.targetUser = this.props.target_user || { name: "Unknown User" };
    }

    role_selected(ev) {
        let role_item_div = $(ev.closest('.user-item'))
        let role_id = role_item_div.attr('data-id');
        role_id = parseInt(role_id);
        if (this.selectedRoles.includes(role_id))
            this.selectedRoles.splice(this.selectedRoles.indexOf(role_id), 1);
        else
            this.selectedRoles.push(role_id);

        this.render();
    }
    getInitials(text) {
        const words = text?.trim().split(/\s+/) || ['', ''];
        return words[1] ? words[0][0] + words[1][0] : words[0].slice(0, 2);
    }

}
