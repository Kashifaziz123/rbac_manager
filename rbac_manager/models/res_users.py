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

    def open_permission_window(self):
        is_admin = self.env.user.has_group('base.group_system')
        if is_admin:
            domain = [(1, '=', 1)]
        else:
            domain = [('groups_id', 'not in', [self.env.ref('base.group_system').id]),
                      ('company_id', 'in', self.env.user.company_ids.ids)]

        return {
            'name': _('User Permission'),
            'view_mode': 'list,form',
            'res_model': 'res.users',
            'views': [
                [self.env.ref('base.view_users_tree').id, 'list'],
                [self.env.ref('rbac_manager.view_users_form_custom').id, 'form']],
            'type': 'ir.actions.act_window',
            'target': 'current',
            'domain': domain,
        }

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

    # def client_action_view_manage_permission(self):
    #     return {
    #         'type': 'ir.actions.client',
    #         'name': 'Manage Permissions',
    #         'tag': 'rbac.manage_permission',
    #         'path': 'manage_permission',
    #         'target': 'self',
    #     }

    def client_action_view_super_admin(self):
        return {
            'type': 'ir.actions.client',
            'name': 'Super Admin',
            'tag': 'rbac.super_admin',
            'path': 'view_super_admin',
            'target': 'self',
        }

    # def open_user_role_window(self):
    #     return {
    #         'type': 'ir.actions.act_window',
    #         'name': 'User Roles',
    #         'res_model': 'res.users',
    #         'view_mode': 'list',
    #         'domain': [('active', '=', False), ('is_user_role', '=', True)],
    #         'context': {'default_active': False, 'default_name': 'New User Role'},
    #     }

    def open_template_wizard(self):
        return {
            'type': 'ir.actions.act_window',
            'name': 'Map from User Templates',
            'res_model': 'user.template.wizard',
            'view_mode': 'form',
            'target': 'new',
        }

    @api.model
    def get_views(self, views, options=None):
        result = super().get_views(views, options)
        custom_view_ref = self.env.ref('rbac_manager.view_users_form_custom',
                                       raise_if_not_found=False)
        view_id = None
        if 'form' in result.get('views', {}):
            if result['views']['form']['id']:
                view_id = result['views']['form']['id']
            if result['views']['form'] and 'arch' in result['views']['form'] \
                    and view_id and view_id == custom_view_ref.id:
                arch = result['views']['form']['arch']
                new_view, fields = self.env['res.groups'].update_custom_user_groups_view()
                per_index = arch.find('''<group string="Permissions">''')
                x = arch[per_index:-1]
                if arch.find('''<group string="Permissions">''') > 0:
                    result['views']['form']['arch'] = (
                            arch[0:per_index] +
                            new_view.replace(
                                '<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '') +
                            arch[per_index + x.find('''</group>''') + 8:])
                    models = {}
                    models.setdefault('res.users', set()).update(fields)

                    result.setdefault('models', {})

                    for model, model_fields in models.items():
                        custom_fields = self.env[model].fields_get(
                            allfields=model_fields, attributes=self._get_view_field_attributes())

                        model_dict = result['models'].setdefault(model, {'fields': {}})
                        model_dict['fields'].update(custom_fields)

        return result

    #  Name must end with 'User Template'
    #
    # def write(self, vals):
    #     result = super().write(vals)
    #     if (self._context.get('default_name', '') == 'New User Role' and
    #             vals.get('name') and not self.name.endswith("User Template")):
    #         raise exceptions.AccessDenied(_("Name must end with 'User Template'"))
    #     return result

    @api.model_create_multi
    def create(self, vals_list):
        default_user = self.env.ref('base.default_user', raise_if_not_found=False)
        if self._context.get('default_name', '') == 'New User Role':
            for vals in vals_list:
                # if vals.get('name') and not vals['name'].endswith("User Template"):
                #     vals.update({'name': vals['name'] + ' User Template'})
                vals.update({'login': vals['name']})
        records = super().create(vals_list)
        if self._context.get('default_name', '') == 'New User Role':
            for record in records:
                record.groups_id = default_user.sudo().groups_id if default_user else [(5, 0, 0)]
        return records
