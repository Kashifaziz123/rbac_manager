# -*- coding: utf-8 -*-
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
