# -*- coding: utf-8 -*-
from odoo import api, fields, models, exceptions, _
from dateutil.relativedelta import relativedelta
from datetime import datetime
import json


# ----------------------------------------------------------
# Basic res.users
# ----------------------------------------------------------

class ResUsers(models.Model):
    _inherit = 'res.users'

    perm_groups_id = fields.Many2many('res.groups', 'res_groups_users_rel', 'uid', 'gid',
                                      string='Groups ', default=lambda s: s._default_groups())
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

    #  Name must end with 'User Template'
    #
    @api.model_create_multi
    def create(self, vals_list):
        default_user = self.env.ref('base.default_user', raise_if_not_found=False)
        if self._context.get('default_name', '') == 'New User Role':
            for vals in vals_list:
                vals.update({'login': vals['name']})
        records = super().create(vals_list)
        if self._context.get('default_name', '') == 'New User Role':
            for record in records:
                record.groups_id = default_user.sudo().groups_id if default_user else [(5, 0, 0)]
        return records
