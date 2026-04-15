# -*- coding: utf-8 -*-
import uuid
from odoo import api, fields, models, exceptions, _


class ResUsers(models.Model):
    _inherit = 'res.users'

    # NOTE: group_ids (formerly groups_id) is already defined in Odoo 19 core.
    # We do NOT redefine it here to avoid conflicts with the same relation table.

    is_user_role = fields.Boolean(string='User Role', default=False)
    description = fields.Char(string='Description')

    def client_action_view_user_role(self):
        return {
            'type': 'ir.actions.client',
            'name': 'User Roles',
            'tag': 'rbac.user_role',
            'target': 'self',
        }

    @api.model
    def action_create_new_user_role(self):
        """Create a blank role template and open the OWL permission editor directly.

        Odoo 19 base res_users.create() syncs user.partner_id.active = user.active,
        which triggers res.partner's archive constraint (res_partner.py:843-860).
        We pass ``creating_role_template=True`` in context so our res.partner override
        writes active=False directly via SQL, bypassing the constraint check.
        """
        unique_login = 'role_template_%s' % uuid.uuid4().hex[:10]
        new_role = self.with_context(
            active_test=False,
            default_name='',            # prevent the create() override from firing
            default_active=False,
            default_is_user_role=True,
            creating_role_template=True,  # bypass res.partner archive constraint
        ).sudo().create([{
            'name': 'New User Role',
            'login': unique_login,
            'active': False,
            'is_user_role': True,
        }])
        return {
            'type': 'ir.actions.client',
            'name': 'New User Role',
            'tag': 'rbac.user_role',
            'target': 'self',
            'context': {'active_id': new_role.id, 'is_new_role': True},
        }

    @api.model
    def discard_new_user_role(self, user_id):
        """Delete a freshly-created, still-blank role template (active=False)."""
        role = self.with_context(active_test=False).sudo().browse(user_id)
        if role.exists() and role.is_user_role and not role.active:
            partner = role.partner_id
            role.sudo().unlink()
            if partner.exists() and not partner.user_ids:
                partner.sudo().unlink()
        return True

    def client_action_view_user_permission(self):
        return {
            'type': 'ir.actions.client',
            'name': 'User Permissions',
            'tag': 'rbac.user_permission',
            'path': 'view_user_permission',
            'target': 'self',
        }

    def client_action_view_super_admin(self):
        return {
            'type': 'ir.actions.client',
            'name': 'Super Admin',
            'tag': 'rbac.super_admin',
            'path': 'view_super_admin',
            'target': 'self',
        }

    @api.model_create_multi
    def create(self, vals_list):
        default_user = self.env.ref('base.default_user', raise_if_not_found=False)
        if self._context.get('default_name', '') == 'New User Role':
            for vals in vals_list:
                vals.update({'login': vals['name']})
        records = super().create(vals_list)
        if self._context.get('default_name', '') == 'New User Role':
            for record in records:
                record.group_ids = default_user.sudo().group_ids if default_user else [(5, 0, 0)]
        return records
