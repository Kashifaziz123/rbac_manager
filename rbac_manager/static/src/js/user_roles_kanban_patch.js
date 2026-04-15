/* @odoo-module */

/**
 * Intercept the "New" button on the User Roles kanban view so it bypasses
 * the intermediate form and opens the OWL permission editor directly.
 */

import { KanbanController } from "@web/views/kanban/kanban_controller";
import { patch } from "@web/core/utils/patch";

patch(KanbanController.prototype, {
    /**
     * Override createRecord only for the User Roles kanban.
     * For all other kanbans, fall through to the original behaviour.
     */
    async createRecord(params) {
        const isUserRolesKanban =
            this.props.resModel === "res.users" &&
            !!this.props.context?.default_is_user_role;

        if (isUserRolesKanban) {
            const action = await this.env.services.orm.call(
                "res.users",
                "action_create_new_user_role",
                []
            );
            await this.env.services.action.doAction(action);
            return;
        }

        return super.createRecord(params);
    },
});
